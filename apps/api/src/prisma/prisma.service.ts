import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AUTH_MODELS, AUTH_WRITE_OPS, emitAuthWrite } from '../core/auth-cache/auth-write-bus';
import { scopeArgs } from '../core/department-scope/department-scope';
import { getHistoryContext } from '../core/history/history-context';
import { emitOrgWrite, ORG_CACHE_IGNORED_MODELS } from '../core/org-cache/org-write-bus';
import {
  HISTORY_IGNORE_FIELDS,
  HISTORY_REDACT_FIELDS,
  HISTORY_SKIP_MODELS,
} from '../core/history/history-map';

const WRITE_ACTIONS = new Set([
  'create',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

const logger = new Logger('PrismaHistory');

/** JSON-safe clone: Date/Decimal serialize via toJSON, bigint → string. */
function jsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Scalar (non-relation) field names per model — relation objects from `include` are never recorded. */
const SCALAR_FIELDS = new Map<string, Set<string>>(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.filter((f) => f.kind !== 'object').map((f) => f.name))]),
);

/** Keeps only the model's own scalar columns (drops included relations). */
export function scalarsOnly(model: string, record: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!record) return {};
  const fields = SCALAR_FIELDS.get(model);
  if (!fields) return { ...record };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) if (fields.has(k)) out[k] = v;
  return out;
}

/** History never copies a large Json value (spreadsheet / PDF annotations): a size marker stands in. */
const HISTORY_MAX_VALUE_CHARS = 16_384;
function capLarge(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const size = JSON.stringify(value).length;
  return size > HISTORY_MAX_VALUE_CHARS ? { omitted: true, kb: Math.round(size / 1024), ...summarizeJson(value) } : value;
}

/**
 * The gist of a well-known large Json value, kept in place of the omitted value so a
 * reader still sees what changed: rich text (TipTap) → words, workbook → sheets/cells,
 * annotation layer → annotations, plus a short fingerprint telling two values apart.
 */
function summarizeJson(value: unknown): Record<string, number | string> {
  const v = value as Record<string, unknown>;
  const fingerprint = createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 8);
  if (v.kind === 'spreadsheet' && Array.isArray(v.sheets)) {
    const sheets = v.sheets as { cells?: Record<string, unknown> }[];
    return { fingerprint, sheets: sheets.length, cells: sheets.reduce((n, sh) => n + Object.keys(sh.cells ?? {}).length, 0) };
  }
  if (v.kind === 'pdf' && Array.isArray(v.annotations)) return { fingerprint, annotations: v.annotations.length };
  if (v.type === 'doc') {
    const text: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const node = n as { text?: unknown; content?: unknown };
      if (typeof node.text === 'string') text.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(v);
    return { fingerprint, words: text.join(' ').split(/\s+/).filter(Boolean).length };
  }
  return { fingerprint };
}

/** Shallow field-level diff between two records → { field: { from, to } }. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (HISTORY_IGNORE_FIELDS.has(key) || HISTORY_REDACT_FIELDS.has(key)) continue;
    const from = redactDeep(jsonSafe(before?.[key]));
    const to = redactDeep(jsonSafe(after?.[key]));
    if (!equalJson(from, to)) changes[key] = { from: capLarge(from), to: capLarge(to) };
  }
  return changes;
}

/** Removes secret-bearing keys at any depth (Json columns may nest them). */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!HISTORY_REDACT_FIELDS.has(k)) out[k] = redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Snapshot copy without secret-bearing fields. */
function redact(record: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!record) return null;
  const out = redactDeep(jsonSafe(record)) as Record<string, unknown>;
  for (const k of Object.keys(out)) out[k] = capLarge(out[k]);
  return out;
}

interface HistoryRow {
  organizationId: string | null;
  entityType: string;
  entityId: string;
  actorId: string | null;
  impersonatedById: string | null;
  operation: string;
  changes: object;
  snapshot: object | null;
}

/**
 * Builds the history rows for one write and records deletions into the request
 * context. `base` is the *un-extended* client used for before-reads and the
 * history write, so it never recurses through the extension.
 */
async function captureHistory(
  base: PrismaClient,
  model: string,
  action: string,
  args: any,
  before: Record<string, unknown>[],
  result: unknown,
) {
  const ctx = getHistoryContext();
  const actorId = ctx?.actorId ?? null;
  const impersonatedById = ctx?.impersonatedById ?? null;
  const rows: HistoryRow[] = [];
  // relation objects pulled in by `include` are not part of the record
  before = before.map((b) => scalarsOnly(model, b));
  result = Array.isArray(result) ? result : result && typeof result === 'object' ? scalarsOnly(model, result as Record<string, unknown>) : result;

  const push = (
    operation: string,
    record: Record<string, unknown> | null,
    changes: Record<string, { from: unknown; to: unknown }>,
    snapshot: Record<string, unknown> | null,
  ) => {
    const entityId = String(record?.id ?? JSON.stringify(args?.where ?? {}));
    const organizationId =
      (record?.organizationId as string | undefined) ?? ctx?.organizationId ?? null;
    rows.push({
      organizationId,
      entityType: model,
      entityId,
      actorId,
      impersonatedById,
      operation,
      changes: jsonSafe(changes) as object,
      snapshot: (jsonSafe(redact(snapshot)) as object | null) ?? null,
    });
    ctx?.touched?.push({ entityType: model, entityId, operation });
    if (operation === 'delete') {
      ctx?.deleteEvents.push({
        organizationId,
        entityType: model,
        entityId,
        soft: action === 'update' || action === 'updateMany',
      });
    }
  };

  const isSoftDelete = (b: Record<string, unknown>, a: Record<string, unknown>) =>
    'deletedAt' in a && !b.deletedAt && !!a.deletedAt;
  const isRestore = (b: Record<string, unknown>, a: Record<string, unknown>) =>
    'deletedAt' in a && !!b.deletedAt && !a.deletedAt;

  switch (action) {
    case 'create': {
      const rec = result as Record<string, unknown>;
      push('create', rec, {}, rec);
      break;
    }
    case 'update':
    case 'upsert': {
      const after = result as Record<string, unknown>;
      const b = before[0];
      if (!b) {
        push('create', after, {}, after); // upsert that inserted
        break;
      }
      if (isSoftDelete(b, after)) push('delete', after, {}, b);
      else if (isRestore(b, after)) push('restore', after, diff(b, after), null);
      else {
        const changes = diff(b, after);
        if (Object.keys(changes).length) push('update', after, changes, null);
      }
      break;
    }
    case 'delete': {
      const b = before[0] ?? null;
      push('delete', b, {}, b);
      break;
    }
    case 'updateMany': {
      const data = args?.data ?? {};
      const softDeleting = 'deletedAt' in data && !!data.deletedAt;
      for (const b of before) {
        if (softDeleting && !b.deletedAt) {
          push('delete', b, {}, b);
        } else {
          const changes = diff(b, { ...b, ...data });
          if (Object.keys(changes).length) push('update', b, changes, null);
        }
      }
      break;
    }
    case 'deleteMany': {
      for (const b of before) push('delete', b, {}, b);
      break;
    }
  }

  if (!rows.length) return;
  await base.historyEntry.createMany({
    data: rows.map((r) => ({ ...r, snapshot: r.snapshot ?? Prisma.JsonNull })),
  });
}

/** Prisma `$extends` that records field-level history for every write. */
function historyExtension(base: PrismaClient) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'history',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // department-scoped visibility (no-op for unrestricted users / unscoped models)
            args = await scopeArgs(base, model, operation, args);
            const isWrite = AUTH_WRITE_OPS.has(operation);
            const result = await recordHistory(model, operation, args, query);
            if (isWrite && model && !ORG_CACHE_IGNORED_MODELS.has(model)) {
              // per-org read caches (dashboard aggregates) drop this org's entries
              const orgId = (result as { organizationId?: unknown } | null)?.organizationId;
              emitOrgWrite(typeof orgId === 'string' ? orgId : (getHistoryContext()?.organizationId ?? null));
            }
            if (isWrite && model && AUTH_MODELS.has(model)) {
              // the auth-context cache must hear about every session/role/membership change
              await emitAuthWrite({ model, operation, args });
            }
            return result;
          },
        },
      },
    }),
  );

  async function recordHistory(
    model: string | undefined,
    operation: string,
    args: unknown,
    query: (args: any) => Promise<unknown>,
  ) {
    if (
      !model ||
      HISTORY_SKIP_MODELS.has(model) ||
      !WRITE_ACTIONS.has(operation)
    ) {
      return query(args);
    }

    const delegate = (base as unknown as Record<string, any>)[
      model.charAt(0).toLowerCase() + model.slice(1)
    ];

    // snapshot the "before" state for updates/deletes
    let before: Record<string, unknown>[] = [];
    try {
      const a = args as any;
      if (operation === 'update' || operation === 'delete' || operation === 'upsert') {
        const found = await delegate?.findUnique?.({ where: a.where });
        if (found) before = [found];
      } else if (operation === 'updateMany' || operation === 'deleteMany') {
        before = (await delegate?.findMany?.({ where: a.where })) ?? [];
      }
    } catch {
      // reading before-state must never block the mutation
    }

    const result = await query(args);

    void captureHistory(base, model, operation, args, before, result).catch((err) =>
      logger.debug(`history capture failed for ${model}.${operation}: ${err}`),
    );

    return result;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // The extension returns a new client; return it so every injected
    // PrismaService routes writes through the history middleware. Reads/history
    // writes inside the extension use the original (un-extended) `this`.
    return this.$extends(historyExtension(this)) as unknown as PrismaService;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
