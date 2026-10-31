/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Workbook parsers runnable off-thread (parseWorkbookInWorker), by key.
 * Static requires — not file paths — so a bundled build (scripts/build-protected.mjs)
 * still finds them inside the worker bundle. Lazy, so a process only loads the
 * parsers it actually uses.
 */
export const WORKBOOK_PARSERS = {
  hr: () => require('../modules/hr/hr-import.parser').parseHrWorkbook,
} satisfies Record<string, () => (...args: never[]) => unknown>;

export type WorkbookParserKey = keyof typeof WORKBOOK_PARSERS;

export function workbookParser(key: WorkbookParserKey): (...args: unknown[]) => unknown {
  const load = WORKBOOK_PARSERS[key];
  if (!load) throw new Error(`Unknown workbook parser ${key}`);
  return load() as (...args: unknown[]) => unknown;
}
