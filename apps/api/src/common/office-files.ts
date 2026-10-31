import { BadRequestException } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import * as XLSX from 'xlsx';
import { workbookParser, type WorkbookParserKey } from './workbook-parsers';

/**
 * Office file hardening shared by the workbook imports (environment, SST,
 * HACCP) and the HACCP document uploads:
 *  - content sniffing from magic bytes + the zip central directory (part
 *    names, uncompressed sizes, macros) — never from the extension alone;
 *  - bounded workbook reading: the declared `<dimension>` is ignored, every
 *    sheet range is clamped to the cells that really exist and rejected
 *    above MAX_SHEET_ROWS × MAX_SHEET_COLS;
 *  - parsing off the event loop, in a worker thread with a hard timeout.
 */

export const MAX_SHEET_ROWS = 5000;
export const MAX_SHEET_COLS = 64;
/** Total uncompressed size accepted for an OOXML container (deflate bombs). */
export const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
export const PARSE_TIMEOUT_MS = 20_000;
/** Rows SheetJS materialises at most (memory bound); data past MAX_SHEET_ROWS is rejected below. */
const PARSE_ROWS_CAP = MAX_SHEET_ROWS * 4;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const startsWith = (buf: Buffer, sig: number[]) => buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

export interface ZipInfo {
  entries: string[];
  uncompressed: number;
}

/** Reads the zip central directory. Returns null when it is missing, truncated or zip64. */
export function readZipDirectory(buf: Buffer): ZipInfo | null {
  const EOCD = 0x06054b50;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const size = buf.readUInt32LE(eocd + 12);
  const offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null; // zip64
  if (offset + size > buf.length) return null;
  const entries: string[] = [];
  let uncompressed = 0;
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const usize = buf.readUInt32LE(p + 24);
    if (usize === 0xffffffff) return null;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen > buf.length) return null;
    entries.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    uncompressed += usize;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, uncompressed };
}

export type OfficeKind = 'pdf' | 'docx' | 'xlsx' | 'zip' | 'ole';

export interface OfficeSniff {
  kind: OfficeKind | null;
  /** OOXML container carrying a VBA project (macro-enabled content). */
  macro?: boolean;
  /** Container is malformed or decompresses beyond MAX_UNCOMPRESSED_BYTES. */
  unsafe?: boolean;
}

export function sniffOffice(buf: Buffer): OfficeSniff {
  if (startsWith(buf, PDF)) return { kind: 'pdf' };
  if (startsWith(buf, OLE)) return { kind: 'ole' };
  if (!startsWith(buf, ZIP)) return { kind: null };
  const dir = readZipDirectory(buf);
  if (!dir) return { kind: 'zip', unsafe: true };
  const has = (name: string) => dir.entries.includes(name);
  const macro = dir.entries.some((e) => /vbaProject\.bin$|vbaData\.xml$/i.test(e));
  const unsafe = dir.uncompressed > MAX_UNCOMPRESSED_BYTES;
  if (!has('[Content_Types].xml')) return { kind: 'zip', macro, unsafe };
  if (has('word/document.xml')) return { kind: 'docx', macro, unsafe };
  if (has('xl/workbook.xml')) return { kind: 'xlsx', macro, unsafe };
  return { kind: 'zip', macro, unsafe };
}

/**
 * Display name of an uploaded file as stored/shown: multer's latin1 decoding
 * repaired (« corrigé » not « corrigÃ© »), any client path dropped, control /
 * bidi characters removed, length capped.
 */
export function uploadName(name: string, max = 255): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  const decoded = /\uFFFD/.test(utf8) ? name : utf8;
  const base = decoded.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return (clean || 'fichier').slice(0, max);
}

export interface UploadedWorkbookFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** Extension, size and content checks for an imported .xls / .xlsx workbook. */
export function assertWorkbookUpload(file: UploadedWorkbookFile | undefined, maxBytes = 10 * 1024 * 1024): asserts file is UploadedWorkbookFile {
  if (!file?.buffer?.length) throw new BadRequestException('Fichier manquant');
  if (file.size > maxBytes || file.buffer.length > maxBytes) {
    throw new BadRequestException(`Fichier trop volumineux (${Math.round(maxBytes / 1024 / 1024)} Mo max.)`);
  }
  const ext = /\.([a-z0-9]+)$/i.exec(file.originalname.trim())?.[1]?.toLowerCase();
  if (ext !== 'xls' && ext !== 'xlsx') throw new BadRequestException('Format attendu : .xls ou .xlsx');
  const sniff = sniffOffice(file.buffer);
  const ok = ext === 'xlsx' ? sniff.kind === 'xlsx' : sniff.kind === 'ole' || sniff.kind === 'xlsx';
  if (!ok) throw new BadRequestException(`Le contenu du fichier ne correspond pas à un classeur .${ext}`);
  if (sniff.unsafe) throw new BadRequestException({ code: 'import.tooLarge', message: 'Classeur trop volumineux une fois décompressé' });
  if (sniff.macro) throw new BadRequestException('Les classeurs contenant des macros ne sont pas acceptés');
}

export class WorkbookTooLargeError extends Error {
  readonly code = 'import.tooLarge';
}

/**
 * Bounded `XLSX.read`: at most PARSE_ROWS_CAP rows are materialised, the
 * declared dimension is ignored, and every sheet's `!ref` is set to the
 * bounding box of its real cells / merges, so parsers that
 * walk `!ref` only visit existing data. Throws WorkbookTooLargeError above
 * MAX_SHEET_ROWS × MAX_SHEET_COLS (any cell past row 5000 / column BL).
 */
export function readWorkbookBounded(buffer: Buffer, opts: XLSX.ParsingOptions = {}): XLSX.WorkBook {
  const wb = XLSX.read(buffer, { ...opts, type: 'buffer', sheetRows: PARSE_ROWS_CAP, nodim: true } as XLSX.ParsingOptions);
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    let sr = Infinity,
      sc = Infinity,
      er = -1,
      ec = -1;
    const grow = (r: number, c: number) => {
      if (r < sr) sr = r;
      if (c < sc) sc = c;
      if (r > er) er = r;
      if (c > ec) ec = c;
    };
    for (const key of Object.keys(ws)) {
      if (key[0] === '!') continue;
      const a = XLSX.utils.decode_cell(key);
      grow(a.r, a.c);
    }
    for (const m of ws['!merges'] ?? []) {
      grow(m.s.r, m.s.c);
      grow(m.e.r, m.e.c);
    }
    if (er < 0) {
      delete ws['!ref'];
      continue;
    }
    const range = { s: { r: sr, c: sc }, e: { r: er, c: ec } };
    if (er >= MAX_SHEET_ROWS || ec >= MAX_SHEET_COLS) {
      throw new WorkbookTooLargeError(`Feuille « ${name.trim()} » : plus de ${MAX_SHEET_ROWS} lignes × ${MAX_SHEET_COLS} colonnes`);
    }
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
  return wb;
}

// ── off-thread parsing ─────────────────────────────────────────────────────

function workerScript(): string | null {
  // compiled build: dist/common/office-files.js → dist/common/workbook-worker.js;
  // protected build: dist/main.jsc → dist/workbook-worker.js (bytecode loader)
  const js = join(__dirname, 'workbook-worker.js');
  return !__filename.endsWith('.ts') && existsSync(js) ? js : null;
}

const toBadRequest = (code: string | undefined, message: string) =>
  code === 'import.tooLarge'
    ? new BadRequestException({ code: 'import.tooLarge', message: `Classeur trop volumineux — ${message}` })
    : new BadRequestException('Classeur illisible (fichier corrompu ou protégé)');

/**
 * Runs the `parser` workbook parser (see workbook-parsers.ts) in a worker thread
 * (20 s, 512 MB heap) so a hostile workbook can never stall the API's event loop.
 * Under ts-jest / ts-node (no compiled worker) the parser runs inline.
 */
export async function parseWorkbookInWorker<T>(parser: WorkbookParserKey, args: unknown[], timeoutMs = PARSE_TIMEOUT_MS): Promise<T> {
  const script = workerScript();
  if (!script) {
    try {
      return workbookParser(parser)(...args) as T;
    } catch (e) {
      throw toBadRequest((e as { code?: string })?.code, (e as Error)?.message ?? '');
    }
  }
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(script, {
      workerData: { parser, args },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };
    const timer = setTimeout(
      () => finish(() => reject(new BadRequestException({ code: 'import.tooLarge', message: 'Classeur trop complexe — analyse interrompue après 20 s' }))),
      timeoutMs,
    );
    worker.once('message', (msg: { ok: boolean; result?: T; code?: string; message?: string }) =>
      finish(() => (msg.ok ? resolve(msg.result as T) : reject(toBadRequest(msg.code, msg.message ?? '')))),
    );
    worker.once('error', (e) => finish(() => reject(toBadRequest(undefined, e.message))));
    worker.once('exit', (code) => finish(() => reject(toBadRequest(undefined, `worker exited (${code})`))));
  });
}
