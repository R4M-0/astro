import { parentPort, workerData } from 'worker_threads';
import { workbookParser, type WorkbookParserKey } from './workbook-parsers';

/** Worker entry for `parseWorkbookInWorker` (see office-files.ts). */
const { parser, args } = workerData as { parser: WorkbookParserKey; args: unknown[] };
try {
  // structured clone turns Buffers into Uint8Arrays — restore them for SheetJS
  const restored = args.map((a) => (a instanceof Uint8Array && !Buffer.isBuffer(a) ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : a));
  const result = workbookParser(parser)(...restored);
  parentPort!.postMessage({ ok: true, result });
} catch (e) {
  parentPort!.postMessage({ ok: false, code: (e as { code?: string })?.code, message: String((e as Error)?.message ?? e) });
}
