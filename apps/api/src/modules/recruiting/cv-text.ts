import { BadRequestException } from '@nestjs/common';
import { extractRawText } from 'mammoth';
import { sniffOffice } from '../../common/office-files';

// unpdf is ESM-only: Node ≥ 22.12 require()s it fine, but its types need moduleResolution node16+
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractText, getDocumentProxy } = require('unpdf') as {
  getDocumentProxy(data: Uint8Array): Promise<unknown>;
  extractText(pdf: unknown, options: { mergePages: true }): Promise<{ text: string }>;
};

export const CV_MAX_BYTES = 10 * 1024 * 1024;
export type CvKind = 'pdf' | 'docx' | 'txt';

/** Upload check: extension and content must agree (no macro documents, no zip bombs). */
export function cvKind(fileName: string, buf: Buffer): CvKind {
  if (!buf.length) throw new BadRequestException(`${fileName}: fichier vide`);
  if (buf.length > CV_MAX_BYTES) throw new BadRequestException(`${fileName}: 10 Mo max.`);
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  const sniff = sniffOffice(buf);
  if (ext === 'pdf' && sniff.kind === 'pdf') return 'pdf';
  if (ext === 'docx' && sniff.kind === 'docx' && !sniff.macro && !sniff.unsafe) return 'docx';
  if (ext === 'txt' && !buf.includes(0)) return 'txt';
  throw new BadRequestException(`${fileName}: format attendu .pdf, .docx ou .txt`);
}

/** CV parser (stage 1). Text layer only: photos are dropped, scanned CVs come back empty. */
export async function cvToText(kind: CvKind, buf: Buffer): Promise<string> {
  if (kind === 'txt') return buf.toString('utf8');
  if (kind === 'docx') return (await extractRawText({ buffer: buf })).value;
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  return text;
}
