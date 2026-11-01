import { Injectable } from '@nestjs/common';
import { AuditLogEntry, HistoryEntry, Prisma } from '@prisma/client';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { orgWhere } from '../entities/org-where';
import {
  FIELDS_FR,
  HIDDEN_FIELDS,
  MODEL_NOUNS,
  Noun,
  NOUNS,
  VALUES_FR,
  VERBS,
} from './audit-vocabulary';

type Lang = 'fr' | 'en';
type Row = Record<string, unknown>;

/** A display value: plain text, or a date the browser formats in its own time zone. */
export type Val = { t: string } | { d: string; time: boolean };

export interface ReadableEntry {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  /** performed by platform support while impersonating the actor */
  viaSupport: boolean;
  category: 'create' | 'update' | 'delete' | 'workflow' | 'export' | 'access' | 'compliance' | 'other';
  summary: string;
  /** what was created / deleted / submitted — every meaningful field */
  details: { label: string; value: Val }[];
  /** field-level before → after for modifications */
  changes: { label: string; from: Val; to: Val }[];
  /** other records affected by the same operation */
  related: string[];
  technical: { method: string; route: string; ip: string | null; device: string | null };
  /** tamper evidence: position in the chain, its hash, whether the body was erased */
  integrity: { seq: number | null; hash: string | null; redacted: boolean };
}

export type AuditCategory = ReadableEntry['category'];

const CUID_RE = /^c[a-z0-9]{20,}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ENUM_RE = /^[A-Z][A-Z0-9_]{1,}$/;
const SENSITIVE = /password|secret|token|otp|recovery|challenge/i;
/** Inbox content is private between its members — the log says *that* it happened, not *what* was said. */
const PRIVATE_ROUTE = /^inbox\//;
/** attachment / by-target / by-entity slugs → noun key */
const SLUG_NOUN: Record<string, string> = {
  employee: 'hr/employees', 'hr-training': 'hr/trainings', 'competency-evaluation': 'hr/evaluations',
  'job-description': 'hr/job-descriptions', skill: 'hr/skills', 'employee-journey': 'hr/journeys', 'hr-survey': 'hr/surveys',
};

/** Hand-written routes that always create something. */
const CREATE_ROUTES = new Set(['organizations', 'users', 'attachments/presign']);

/** Registers probed to name a bare id found in a change or a request. */
const PROBE_MODELS = [
  'Employee', 'HrTraining', 'Skill', 'JobDescription', 'EmployeeJourney', 'HrSurvey', 'Role',
];

const lcfirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const humanizeKey = (k: string) =>
  cap(k.replace(/Ids?$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim());
const humanizeEnum = (v: string) => cap(v.replace(/_/g, ' ').toLowerCase());
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s: string, max = 400) => (s.length > max ? `${s.slice(0, max)}…` : s);

// ── French grammar helpers ────────────────────────────────────────────────
const vowel = (w: string) => /^[aeiouyhàâéèêëîïôûœ]/i.test(w);
const frDef = (x: Noun) => (vowel(x.fr) ? `l'${x.fr}` : `${x.g === 'm' ? 'le' : 'la'} ${x.fr}`);
const frIndef = (x: Noun) => `${x.g === 'm' ? 'un' : 'une'} ${x.fr}`;
const frOf = (x: Noun) => (vowel(x.fr) ? `de l'${x.fr}` : `${x.g === 'm' ? 'du' : 'de la'} ${x.fr}`);
const frTo = (x: Noun) => (vowel(x.fr) ? `à l'${x.fr}` : `${x.g === 'm' ? 'au' : 'à la'} ${x.fr}`);
const frPlural = (w: string) => w.split(' ').map((p, i) => (i === 0 && !/[sx]$/.test(p) ? `${p}s` : p)).join(' ');
/** "de une action" → "d'une action", "de le" → "du", "à le" → "au"… */
const frElide = (s: string) =>
  s
    .replace(/\bde (un|une|l')\b/g, (_m, w) => `d'${w}`.replace("d'l'", "de l'"))
    .replace(/\bde (?=[aeiouyhàâéèêëîïôûœ])/gi, "d'")
    .replace(/\bde le /g, 'du ')
    .replace(/\bde les /g, 'des ')
    .replace(/\bà le /g, 'au ')
    .replace(/\bà les /g, 'aux ');
const enIndef = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;

interface Parsed {
  method: string;
  route: string; // pattern without /api/v1/
  statics: { seg: string; idx: number }[];
  tokens: string[];
}

function parseAction(action: string): Parsed {
  const [method, ...rest] = action.split(' ');
  const route = rest.join(' ').replace(/^\/?api\/(v1\/)?/, '').replace(/^\//, '');
  const tokens = route.split('/').filter(Boolean);
  const statics = tokens.map((seg, idx) => ({ seg, idx })).filter((t) => !t.seg.startsWith(':'));
  return { method, route, statics, tokens };
}

/** Noun key for the static segment at `pos` in `statics` (prefers `prev/seg`). */
function nounKeyAt(p: Parsed, pos: number): string | null {
  const seg = p.statics[pos]?.seg;
  if (!seg) return null;
  for (let back = pos - 1; back >= 0; back--) {
    const key = `${p.statics[back].seg}/${seg}`;
    if (NOUNS[key]) return key;
  }
  return NOUNS[seg] ? seg : null;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  // ── query ───────────────────────────────────────────────────────────────
  async list(
    orgId: string,
    q: PaginationQuery & { actorId?: string; category?: AuditCategory; locale?: string },
  ) {
    const lang: Lang = q.locale === 'en' ? 'en' : 'fr';
    const and: Prisma.AuditLogEntryWhereInput[] = [{ organizationId: orgId }];
    if (q.actorId) and.push({ actorId: q.actorId });
    if (q.category) and.push(this.categoryWhere(q.category));
    if (q.search?.trim()) and.push(await this.searchWhere(orgId, q.search.trim()));
    const where: Prisma.AuditLogEntryWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
      this.prisma.auditLogEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.auditLogEntry.count({ where }),
    ]);
    return paginate(await this.humanize(orgId, rows, lang), total, q);
  }

  private categoryWhere(category: AuditCategory): Prisma.AuditLogEntryWhereInput {
    const workflow = Object.keys(VERBS).map((v) => ({ action: { endsWith: `/${v}` } }));
    switch (category) {
      case 'create':
        return { action: { startsWith: 'POST ' }, NOT: { OR: workflow } };
      case 'update':
        return { OR: [{ action: { startsWith: 'PATCH ' } }, { action: { startsWith: 'PUT ' } }], NOT: { OR: workflow } };
      case 'delete':
        return { action: { startsWith: 'DELETE ' } };
      case 'export':
        return { action: { startsWith: 'EXPORT ' } };
      case 'access':
        return { action: { startsWith: 'ACCESS ' } };
      case 'compliance':
        return { action: { startsWith: 'COMPLIANCE ' } };
      case 'workflow':
        return { OR: workflow, NOT: { action: { startsWith: 'DELETE ' } } };
      default:
        return {};
    }
  }

  /** Plain-language search: item names ("risque", "fournisseur"), people, or raw text. */
  private async searchWhere(orgId: string, term: string): Promise<Prisma.AuditLogEntryWhereInput> {
    const t = term.toLowerCase();
    const segments = new Set<string>();
    const models = new Set<string>();
    for (const [key, noun] of Object.entries(NOUNS)) {
      if (noun.fr.toLowerCase().includes(t) || noun.en.toLowerCase().includes(t)) {
        segments.add(key.split('/').pop()!);
        if (noun.model) models.add(noun.model);
      }
    }
    const users = await this.prisma.user.findMany({
      where: {
        memberships: { some: { organizationId: orgId } },
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    return {
      OR: [
        { action: { contains: term, mode: 'insensitive' } },
        ...[...segments].map((s) => ({ action: { contains: `/${s}` } })),
        ...(models.size ? [{ entityType: { in: [...models] } }] : []),
        ...(users.length ? [{ actorId: { in: users.map((u) => u.id) } }] : []),
      ],
    };
  }

  // ── humanisation ────────────────────────────────────────────────────────
  private async humanize(orgId: string, rows: AuditLogEntry[], lang: Lang): Promise<ReadableEntry[]> {
    if (!rows.length) return [];
    const historyByEntry = await this.correlateHistory(orgId, rows);

    // everything that needs a display label: records touched, parents, bodies, refs
    const idsByModel = new Map<string, Set<string>>();
    const want = (model: string | undefined, id: unknown) => {
      if (!model || typeof id !== 'string' || !id) return;
      if (!idsByModel.has(model)) idsByModel.set(model, new Set());
      idsByModel.get(model)!.add(id);
    };
    const refIds = new Set<string>();
    const scan = (v: unknown) => {
      if (typeof v === 'string') {
        if (CUID_RE.test(v)) refIds.add(v);
      } else if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v === 'object') Object.values(v).forEach(scan);
    };
    for (const row of rows) {
      if (row.entityType && row.entityId) want(row.entityType, row.entityId);
      const hist = historyByEntry.get(row.id) ?? [];
      for (const h of hist) {
        want(h.entityType, h.entityId);
        scan(h.changes);
        scan(h.snapshot);
      }
      scan(row.after);
      const body = (row.after ?? {}) as Row;
      const slugNoun = typeof body.entityType === 'string' ? NOUNS[SLUG_NOUN[body.entityType] ?? ''] : undefined;
      if (slugNoun) want(slugNoun.model, body.entityId);
    }
    const labels = await this.fetchLabels(orgId, idsByModel, refIds, lang);

    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const actorName = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`.trim()]));

    return rows.map((row) =>
      this.describe(row, historyByEntry.get(row.id) ?? [], labels, lang, row.actorId ? (actorName.get(row.actorId) ?? null) : null),
    );
  }

  /**
   * History rows written by each request. New entries carry their primary
   * record (entityType/entityId); older ones are matched by actor + time — the
   * audit row is written right after the response, the history rows during it.
   */
  private async correlateHistory(orgId: string, rows: AuditLogEntry[]) {
    const result = new Map<string, HistoryEntry[]>();
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])];
    if (!actorIds.length) return result;
    const times = rows.map((r) => r.createdAt.getTime());
    const history = await this.prisma.historyEntry.findMany({
      where: {
        organizationId: orgId,
        actorId: { in: actorIds },
        createdAt: { gte: new Date(Math.min(...times) - 10_000), lte: new Date(Math.max(...times) + 3_000) },
      },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    const byActor = new Map<string, AuditLogEntry[]>();
    for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (!r.actorId || /^(EXPORT|ACCESS|COMPLIANCE) /.test(r.action)) continue;
      if (!byActor.has(r.actorId)) byActor.set(r.actorId, []);
      byActor.get(r.actorId)!.push(r);
    }
    for (const h of history) {
      const candidates = byActor.get(h.actorId!) ?? [];
      const ht = h.createdAt.getTime();
      // requests logged for this very record win (new rows); among them / otherwise,
      // the one that finished soonest after the write
      const exact = candidates.filter((c) => c.entityId === h.entityId);
      let owner: AuditLogEntry | undefined;
      let best = Infinity;
      for (const c of exact.length ? exact : candidates) {
        const delta = c.createdAt.getTime() - ht;
        // a request logged slightly *before* the write only wins when nothing ended after it
        const cost = delta >= 0 ? delta : 1_000_000 - delta;
        if (delta >= -250 && delta <= 8_000 && cost < best) {
          best = cost;
          owner = c;
        }
      }
      if (!owner) continue;
      if (!result.has(owner.id)) result.set(owner.id, []);
      result.get(owner.id)!.push(h);
    }
    return result;
  }

  /**
   * id → human label, for records by model and loose references (people, sites…). Every lookup is
   * tied to `orgId` (orgWhere): an id of another organization written into a body never resolves.
   */
  private async fetchLabels(orgId: string, idsByModel: Map<string, Set<string>>, refIds: Set<string>, lang: Lang) {
    const inOrg = (model: string, ids: string[]) => {
      const scope = orgWhere(model, orgId);
      return scope ? { AND: [{ id: { in: ids } }, scope] } : null;
    };
    const labels = new Map<string, string>();
    const records = new Map<string, Row>();
    await Promise.all(
      [...idsByModel].map(async ([model, ids]) => {
        const delegate = (this.prisma as unknown as Record<string, { findMany?: (a: unknown) => Promise<Row[]> }>)[lcfirst(model)];
        const where = inOrg(model, [...ids]);
        if (!delegate?.findMany || !where) return;
        try {
          const found = await delegate.findMany({ where });
          for (const r of found) records.set(r.id as string, { ...r, __model: model });
        } catch {
          // composite-key models etc. — label falls back to the noun alone
        }
      }),
    );
    const ids = [...new Set([...refIds, ...[...records.values()].flatMap((r) => [r.userId, r.assigneeId].filter(Boolean) as string[])])];
    if (ids.length) {
      const [users, employees, departments, sites, roles] = await Promise.all([
        this.prisma.user.findMany({ where: inOrg('User', ids)!, select: { id: true, firstName: true, lastName: true } }),
        this.prisma.employee.findMany({ where: inOrg('Employee', ids)!, select: { id: true, firstName: true, lastName: true } }),
        this.prisma.department.findMany({ where: inOrg('Department', ids)!, select: { id: true, name: true } }),
        this.prisma.site.findMany({ where: inOrg('Site', ids)!, select: { id: true, name: true } }),
        this.prisma.role.findMany({ where: inOrg('Role', ids)!, select: { id: true, name: true } }),
      ]);
      for (const p of [...users, ...employees]) labels.set(p.id, `${p.firstName} ${p.lastName}`.trim());
      for (const x of [...departments, ...sites, ...roles]) labels.set(x.id, x.name);
    }
    // ids still unnamed (templateId, riskId…) — probe the common registers
    const unresolved = [...refIds].filter((id) => !labels.has(id) && !records.has(id));
    if (unresolved.length) {
      await Promise.all(
        PROBE_MODELS.map(async (model) => {
          const delegate = (this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Row[]> }>)[lcfirst(model)];
          const where = inOrg(model, unresolved);
          if (!where) return;
          const found = await delegate.findMany({ where }).catch(() => [] as Row[]);
          for (const r of found) records.set(r.id as string, { ...r, __model: model });
        }),
      );
    }
    for (const [id, r] of records) {
      const label = this.recordLabel(r, labels, lang);
      if (label) labels.set(id, label);
    }
    return { labels, records };
  }

  /** "ACT-000014 « Test »" — reference + name of any record, whatever its model. */
  private recordLabel(r: Row, labels: Map<string, string>, lang: Lang): string | null {
    const q = (s: string) => (lang === 'fr' ? `« ${s} »` : `“${s}”`);
    const model = r.__model as string | undefined;
    if (model === 'Message' || model === 'Conversation' || model === 'ConversationMember') return null;
    if (model === 'Membership') {
      const who = labels.get(r.userId as string);
      return who ? q(who) : null;
    }
    const clean = (v: unknown) => (typeof v === 'string' && v !== '[redacted]' ? v : null);
    const ref = clean(r.reference) ?? clean(r.code);
    const person = r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null;
    const rawName = (r.title ?? r.name ?? person ?? r.fullName ?? r.subjectLabel ?? r.fileName ?? r.theme ?? r.label ?? r.subject ?? r.decision ??
      r.statement ?? r.description ?? r.body ?? null) as unknown;
    const name = typeof rawName === 'string' && rawName.trim() ? clip(stripHtml(rawName), 90) : null;
    if (ref && name) return `${ref} ${q(name)}`;
    return ref ?? (name ? q(name) : null);
  }

  // ── one entry ─────────────────────────────────────────────────────────────
  private describe(
    row: AuditLogEntry,
    history: HistoryEntry[],
    ctx: { labels: Map<string, string>; records: Map<string, Row> },
    lang: Lang,
    actorName: string | null,
  ): ReadableEntry {
    const p = parseAction(row.action);
    const body = (row.after && typeof row.after === 'object' && !Array.isArray(row.after) ? row.after : {}) as Row;
    const isPrivate = PRIVATE_ROUTE.test(p.route);
    const fr = lang === 'fr';
    if (['ACCESS', 'EXPORT', 'COMPLIANCE', 'GALAXY'].includes(p.method) || /^compliance\/retention\/(preview|run)$/.test(p.route)) {
      return this.describeCompliance(row, p, body, ctx, lang, actorName);
    }

    // what the route is about
    const lastStatic = p.statics.length - 1;
    const lastIsParam = p.tokens.length > 0 && p.tokens[p.tokens.length - 1].startsWith(':');
    const lastSeg = p.statics[lastStatic]?.seg ?? '';
    const verb = !lastIsParam && VERBS[lastSeg] ? VERBS[lastSeg] : null;
    let objectPos = lastStatic;
    if (verb) objectPos = lastStatic - 1;
    while (objectPos >= 0 && !nounKeyAt(p, objectPos)) objectPos--;
    const objectKey = objectPos >= 0 ? nounKeyAt(p, objectPos) : null;
    const object = objectKey ? NOUNS[objectKey] : null;
    // parent: a noun before a param that precedes the object (…/audits/:id/findings)
    let parent: Noun | null = null;
    if (objectPos > 0 && p.statics[objectPos].idx - 1 > p.statics[objectPos - 1].idx) {
      const pk = nounKeyAt(p, objectPos - 1);
      parent = pk ? NOUNS[pk] : null;
    }

    // records this request wrote
    const primaryModel = object?.model;
    const primaryOp = p.method === 'DELETE' ? 'delete' : p.method === 'POST' && !verb ? 'create' : null;
    let primary = history.filter(
      (h) => (primaryModel ? h.entityType === primaryModel : true) && (!primaryOp || h.operation === primaryOp),
    );
    if (!primary.length && row.entityType) primary = history.filter((h) => h.entityType === row.entityType && h.entityId === row.entityId);
    if (!primary.length && primaryModel) primary = history.filter((h) => h.entityType === primaryModel);
    if (!primary.length && history.length && !object) primary = [history[0]];
    const related = history.filter((h) => !primary.includes(h));

    const labelOf = (h: { entityId: string; snapshot?: unknown }) =>
      ctx.labels.get(h.entityId) ??
      (h.snapshot && typeof h.snapshot === 'object' ? this.recordLabel(h.snapshot as Row, ctx.labels, lang) : null);
    const primaryIds = [...new Set(primary.map((h) => h.entityId))];
    const primaryLabels = primaryIds.map((id) => labelOf(primary.find((h) => h.entityId === id)!)).filter(Boolean) as string[];
    const fallbackLabel = !primaryLabels.length && row.entityId ? (ctx.labels.get(row.entityId) ?? null) : null;
    // older entries (before history capture): name a *created* item from what was submitted
    const bodyLabel = p.method === 'POST' && !verb && !isPrivate ? this.recordLabel(body, ctx.labels, lang) : null;
    const mainLabel = primaryLabels[0] ?? fallbackLabel ?? bodyLabel;

    // parent label (…to the action ACT-…): FK on the created child, or a written parent row
    let parentLabel: string | null = null;
    if (parent?.model) {
      const snap = (primary.find((h) => h.snapshot)?.snapshot ?? {}) as Row;
      const fk = (snap[`${lcfirst(parent.model)}Id`] ?? snap.entityId ?? snap.targetId) as string | undefined;
      const parentRow = history.find((h) => h.entityType === parent!.model);
      parentLabel = (fk && ctx.labels.get(fk)) || (parentRow ? labelOf(parentRow) : null);
    }

    const phrase = (x: Noun, label: string | null, count = 1) => {
      if (count > 1) return fr ? `${count} ${frPlural(x.fr)}` : `${count} ${x.en}s`;
      if (fr) return label ? `${frDef(x)} ${label}` : frIndef(x);
      return label ? `the ${x.en} ${label}` : enIndef(x.en);
    };
    const parentPhrase = (to: boolean) => {
      if (!parent) return '';
      if (fr) {
        if (!parentLabel) return ` ${to ? 'à' : 'de'} ${frIndef(parent)}`;
        return ` ${to ? frTo(parent) : frOf(parent)} ${parentLabel}`;
      }
      return ` ${to ? 'to' : 'of'} ${parentLabel ? `the ${parent.en} ${parentLabel}` : enIndef(parent.en)}`;
    };

    let category: AuditCategory = 'other';
    let summary = this.special(p, body, history, ctx, lang, labelOf);
    if (summary) {
      category =
        p.method === 'EXPORT' ? 'export'
        : p.method === 'DELETE' ? 'delete'
        : p.method === 'POST' && (history.some((h) => h.operation === 'create') || CREATE_ROUTES.has(p.route)) ? 'create'
        : 'other';
    } else if (verb && object) {
      category = 'workflow';
      summary = `${fr ? verb.fr : verb.en} ${phrase(object, mainLabel, primaryIds.length)}${parentPhrase(false)}`;
    } else if (object) {
      const count = primaryIds.length;
      if (p.method === 'POST') {
        category = 'create';
        summary = parent
          ? `${fr ? 'a ajouté' : 'added'} ${phrase(object, mainLabel, count)}${parentPhrase(true)}`
          : `${fr ? 'a créé' : 'created'} ${phrase(object, mainLabel, count)}`;
      } else if (p.method === 'DELETE') {
        category = 'delete';
        summary = `${fr ? 'a supprimé' : 'deleted'} ${phrase(object, mainLabel, count)}${parentPhrase(false)}`;
      } else {
        category = 'update';
        summary = `${fr ? 'a modifié' : 'updated'} ${phrase(object, mainLabel, count)}${parentPhrase(false)}`;
      }
    } else {
      summary = fr
        ? `a effectué l'opération « ${humanizeKey(lastSeg || p.route)} »`
        : `performed “${humanizeKey(lastSeg || p.route)}”`;
    }
    if (p.method === 'DELETE') category = 'delete';

    // details / changes
    const details: ReadableEntry['details'] = [];
    const changes: ReadableEntry['changes'] = [];
    if (!isPrivate) {
      for (const h of primary) {
        const prefix = primaryIds.length > 1 ? `${labelOf(h) ?? ''} — ` : '';
        if (h.operation === 'update' || h.operation === 'restore') {
          for (const [field, diff] of Object.entries((h.changes ?? {}) as Record<string, { from: unknown; to: unknown }>)) {
            if (HIDDEN_FIELDS.has(field) || SENSITIVE.test(field)) continue;
            changes.push({
              label: prefix + this.fieldLabel(field, lang),
              from: this.value(field, diff.from, ctx.labels, lang),
              to: this.value(field, diff.to, ctx.labels, lang),
            });
          }
        } else if (h.snapshot && typeof h.snapshot === 'object') {
          details.push(...this.fieldList(h.snapshot as Row, ctx.labels, lang, prefix));
        }
      }
      if (!details.length && !changes.length) details.push(...this.fieldList(body, ctx.labels, lang, ''));
    }

    const relatedLines = isPrivate
      ? []
      : related.slice(0, 15).map((h) => {
          const noun = MODEL_NOUNS[h.entityType];
          const what = noun ? phrase(noun, labelOf(h)) : h.entityType;
          const op = fr
            ? { create: 'Création', update: 'Modification', delete: 'Suppression', restore: 'Restauration' }[h.operation]
            : { create: 'Created', update: 'Updated', delete: 'Deleted', restore: 'Restored' }[h.operation];
          const fields = h.operation === 'update'
            ? Object.keys((h.changes ?? {}) as Row)
                .filter((f) => !HIDDEN_FIELDS.has(f))
                .map((f) => this.fieldLabel(f, lang))
                .join(', ')
            : '';
          const of = fr
            ? what.startsWith('le ') ? `du ${what.slice(3)}` : what.startsWith('les ') ? `des ${what.slice(4)}` : vowel(what) ? `d'${what}` : `de ${what}`
            : `of ${what}`;
          return `${op ?? h.operation} ${of}${fields ? ` (${fields})` : ''}`;
        });
    if (related.length > 15) relatedLines.push(fr ? `… et ${related.length - 15} autre(s)` : `… and ${related.length - 15} more`);

    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actorId: row.actorId,
      actorName,
      viaSupport: !!row.impersonatedById,
      category,
      summary: cap(fr ? frElide(summary) : summary),
      details,
      changes,
      related: relatedLines,
      technical: {
        method: p.method,
        route: p.route,
        ip: row.ip,
        device: this.device(row.userAgent, lang),
      },
      integrity: { seq: row.seq, hash: row.hash, redacted: !!row.redactedAt },
    };
  }

  /**
   * Reads, exports and compliance events (docs/compliance): ACCESS <route>, EXPORT <route>,
   * COMPLIANCE <event>. Written by AuditWriter, never by the generic request path.
   */
  private describeCompliance(
    row: AuditLogEntry,
    p: Parsed,
    body: Row,
    ctx: { labels: Map<string, string>; records: Map<string, Row> },
    lang: Lang,
    actorName: string | null,
  ): ReadableEntry {
    const fr = lang === 'fr';
    const noun = row.entityType ? MODEL_NOUNS[row.entityType] : undefined;
    const label = row.entityId ? (ctx.labels.get(row.entityId) ?? null) : null;
    const what = noun
      ? fr ? (label ? `${frDef(noun)} ${label}` : frIndef(noun)) : label ? `the ${noun.en} ${label}` : enIndef(noun.en)
      : fr ? 'un élément' : 'an item';
    let category: AuditCategory = 'compliance';
    let summary: string;
    const count = (k: string) => (typeof body[k] === 'number' ? (body[k] as number) : 0);
    if (p.method === 'ACCESS') {
      category = 'access';
      summary = /\/file$/.test(p.route)
        ? fr ? `a téléchargé le CV ${frOf(noun ?? NOUNS['recruiting/candidates'])} ${label ?? ''}`.trim() : `downloaded the CV of ${what}`
        : p.route === 'galaxy/employee.view'
          ? fr ? `a consulté dans la galaxie RH ${what}` : `viewed ${what} in the workforce galaxy`
          : p.route === 'galaxy/ask'
            ? fr ? 'a posé une question à la galaxie RH' : 'asked the workforce galaxy a question'
            : p.route.startsWith('galaxy/')
              ? fr ? `a consulté la galaxie RH (${p.route.slice(7)})` : `used the workforce galaxy (${p.route.slice(7)})`
          : fr ? `a consulté ${what}` : `viewed ${what}`;
    } else if (p.method === 'EXPORT') {
      category = 'export';
      summary = p.route.startsWith('compliance/audit')
        ? fr ? "a exporté le journal d'audit (avec son sceau d'intégrité)" : 'exported the audit trail (with its integrity seal)'
        : p.route.startsWith('compliance/requests')
          ? fr ? `a exporté toutes les données personnelles de la demande ${label ?? ''}`.trim() : `exported all personal data for the request ${label ?? ''}`.trim()
          : fr ? `a exporté ${what}` : `exported ${what}`;
    } else if (p.method === 'GALAXY') {
      category = 'workflow';
      const action = p.route.replace(/^galaxy\//, '');
      summary = fr ? `a agi depuis la galaxie RH (${action})` : `acted from the workforce galaxy (${action})`;
    } else {
      const event = p.route;
      const subject = typeof body.subjectLabel === 'string' ? body.subjectLabel : label;
      summary =
        event === 'compliance/retention/preview'
          ? fr ? 'a prévisualisé les durées de conservation (rien n’a été modifié)' : 'previewed retention (nothing changed)'
          : event === 'compliance/retention/run'
            ? fr ? 'a lancé l’application des durées de conservation' : 'started applying retention'
            : event === 'retention.run'
          ? fr
            ? `a appliqué les durées de conservation : ${count('anonymized')} personne(s) anonymisée(s), ${count('purged')} entrée(s) d'audit purgée(s), ${count('held')} sous gel juridique`
            : `applied retention: ${count('anonymized')} people anonymized, ${count('purged')} audit entries purged, ${count('held')} under legal hold`
          : event === 'subject.anonymized'
            ? fr ? `a anonymisé les données de ${subject ?? 'une personne'}` : `anonymized the personal data of ${subject ?? 'a person'}`
            : event === 'audit.sealed'
              ? fr ? "a scellé le journal d'audit" : 'sealed the audit trail'
              : fr ? `événement de conformité « ${event} »` : `compliance event “${event}”`;
    }
    const details: ReadableEntry['details'] = Object.entries(body)
      .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
      .map(([k, v]) => ({ label: FIELDS_FR[k] && fr ? FIELDS_FR[k] : humanizeKey(k), value: { t: String(v) } }));
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actorId: row.actorId,
      actorName: actorName ?? (row.actorId ? null : fr ? 'Système' : 'System'),
      viaSupport: !!row.impersonatedById,
      category,
      summary: cap(summary),
      details,
      changes: [],
      related: [],
      technical: { method: p.method, route: p.route, ip: row.ip, device: this.device(row.userAgent, lang) },
      integrity: { seq: row.seq, hash: row.hash, redacted: !!row.redactedAt },
    };
  }

  /** Routes whose meaning is not "verb + item" — sentences written by hand. */
  private special(
    p: Parsed,
    body: Row,
    history: HistoryEntry[],
    ctx: { labels: Map<string, string> },
    lang: Lang,
    labelOf: (h: HistoryEntry) => string | null,
  ): string | null {
    const fr = lang === 'fr';
    const r = p.route;
    const q = (s: unknown) => (fr ? `« ${String(s)} »` : `“${String(s)}”`);
    const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    const slug = (s: unknown) => (typeof s === 'string' ? NOUNS[SLUG_NOUN[s] ?? ''] : undefined);
    const target = (type: unknown, id: unknown) => {
      const x = slug(type);
      const label = typeof id === 'string' ? ctx.labels.get(id) : undefined;
      if (!x) return fr ? 'un élément' : 'an item';
      return fr ? `${label ? `${frDef(x)} ${label}` : frIndef(x)}` : label ? `the ${x.en} ${label}` : enIndef(x.en);
    };
    const linkRow = (model: string) => history.find((h) => h.entityType === model);

    if (r === 'attachments/presign') {
      return fr
        ? `a joint le fichier ${q(body.fileName)} à ${target(body.entityType, body.entityId)}`
        : `attached the file ${q(body.fileName)} to ${target(body.entityType, body.entityId)}`;
    }
    if (r === 'attachments/:id' && p.method === 'DELETE') {
      const h = linkRow('Attachment');
      const snap = (h?.snapshot ?? {}) as Row;
      const name = snap.fileName ? ` ${q(snap.fileName)}` : '';
      const on = snap.entityType ? ` (${target(snap.entityType, snap.entityId)})` : '';
      return fr ? `a supprimé le fichier joint${name}${on}` : `deleted the attachment${name}${on}`;
    }
    const byTarget = /^(actions|documents)\/by-(target|entity)\/:(targetType|entityType)\/:(targetId|entityId)(\/link|\/:\w+)?$/.exec(r);
    if (byTarget) {
      const isDoc = byTarget[1] === 'documents';
      const link = linkRow(isDoc ? 'DocumentLink' : 'ActionLink');
      const snap = (link?.snapshot ?? {}) as Row;
      const tType = snap.targetType ?? snap.entityType;
      const tId = snap.targetId ?? snap.entityId;
      const on = tType ? target(tType, tId) : fr ? 'un élément' : 'an item';
      const created = history.find((h) => h.entityType === 'Action' && h.operation === 'create');
      const n = count(body.actionIds ?? body.documentIds) || 1;
      if (p.method === 'DELETE') {
        return fr ? `a retiré ${isDoc ? 'un document lié' : 'une action liée'} de ${on}` : `unlinked ${isDoc ? 'a document' : 'an action'} from ${on}`;
      }
      if (byTarget[5] === '/link') {
        return fr
          ? `a lié ${n} ${isDoc ? 'document(s) existant(s)' : 'action(s) existante(s)'} à ${on}`
          : `linked ${n} existing ${isDoc ? 'document(s)' : 'action(s)'} to ${on}`;
      }
      const label = (created ? labelOf(created) : null) ?? (typeof body.title === 'string' ? q(body.title) : null);
      return fr
        ? `a créé l'action${label ? ` ${label}` : ''} pour ${on}`
        : `created the action${label ? ` ${label}` : ''} for ${on}`;
    }
    const bulk = /^([\w/-]+)\/bulk\/(assign|delete|status)$/.exec(r);
    if (bulk) {
      const key = NOUNS[bulk[1]] ? bulk[1] : bulk[1].split('/').pop()!;
      const x = NOUNS[key] ?? NOUNS[bulk[1]];
      const n = count(body.ids) || new Set(history.map((h) => h.entityId)).size;
      const what = x ? (fr ? `${n} ${frPlural(x.fr)}` : `${n} ${x.en}s`) : `${n}`;
      const verbs = fr
        ? { assign: 'a assigné en une fois', delete: 'a supprimé en une fois', status: 'a changé en une fois le statut de' }
        : { assign: 'bulk-assigned', delete: 'bulk-deleted', status: 'bulk-changed the status of' };
      return `${verbs[bulk[2] as 'assign']} ${what}`;
    }
    if (r.startsWith('inbox/')) {
      const map: Record<string, [string, string]> = {
        'POST inbox/conversations/direct': ['a démarré une conversation privée', 'started a private conversation'],
        'POST inbox/conversations/group': [`a créé le groupe de discussion ${q(body.name ?? '')}`, `created the group chat ${q(body.name ?? '')}`],
        'POST inbox/conversations/:id/messages': ['a envoyé un message dans la messagerie interne', 'sent a message in the internal inbox'],
        'POST inbox/conversations/:id/members': ['a ajouté des membres à une conversation', 'added members to a conversation'],
        'PATCH inbox/conversations/:id/read': ['a lu une conversation de la messagerie', 'read an inbox conversation'],
        'PATCH inbox/conversations/:id/mute': ['a activé ou désactivé les notifications d’une conversation', 'muted / unmuted a conversation'],
        'PATCH inbox/conversations/:id/rename': [`a renommé une conversation en ${q(body.name ?? '')}`, `renamed a conversation to ${q(body.name ?? '')}`],
        'DELETE inbox/conversations/:id/leave': ['a quitté une conversation', 'left a conversation'],
        'PATCH inbox/messages/:messageId': ['a modifié un de ses messages', 'edited one of their messages'],
        'DELETE inbox/messages/:messageId': ['a supprimé un de ses messages', 'deleted one of their messages'],
      };
      const hit = map[`${p.method} ${r}`];
      return hit ? hit[fr ? 0 : 1] : fr ? 'a utilisé la messagerie interne' : 'used the internal inbox';
    }
    if (r === 'notifications/read-all') return fr ? 'a marqué toutes ses notifications comme lues' : 'marked all notifications as read';
    if (r === 'notifications/:id/read') return fr ? 'a lu une notification' : 'read a notification';
    if (r === 'ai/chat') return fr ? "a posé une question à l'assistant IA" : 'asked the AI assistant a question';
    if (r === 'ai/generate' || r === 'ai/assist' || /\/ai(\/generate|\/plan)?$/.test(r)) {
      const on = /^(\w[\w-]*)\/:id\/ai$/.exec(r);
      const x = on ? NOUNS[on[1]] : null;
      if (x) return fr ? `a demandé une proposition à l'assistant IA pour ${frIndef(x)}` : `asked the AI assistant for a proposal on ${enIndef(x.en)}`;
      return fr ? "a demandé une proposition rédigée par l'assistant IA" : 'asked the AI assistant for a drafted proposal';
    }
    if (/^forms\/instances\/:id\/signatures/.test(r)) {
      const form = linkRow('FormInstance');
      const label = form ? labelOf(form) : null;
      const what = fr ? `la fiche${label ? ` ${label}` : ''}` : `the form record${label ? ` ${label}` : ''}`;
      if (r.endsWith('/sign')) return fr ? `a signé électroniquement ${what}` : `e-signed ${what}`;
      if (r.endsWith('/revoke')) return fr ? `a annulé une signature sur ${what}` : `revoked a signature on ${what}`;
      return fr ? `a attribué les signatures à apposer sur ${what}` : `assigned who must sign ${what}`;
    }
    if (r === 'me') return fr ? 'a mis à jour son profil' : 'updated their profile';
    if (r === 'users' && p.method === 'POST') {
      return fr ? `a invité ${body.email ?? 'une personne'} à rejoindre l'organisation` : `invited ${body.email ?? 'someone'} to the organization`;
    }
    if (r === 'users/:membershipId') {
      const m = linkRow('Membership');
      const who = m ? labelOf(m) : null;
      return p.method === 'DELETE'
        ? fr ? `a retiré ${who ?? 'un membre'} de l'organisation` : `removed ${who ?? 'a member'} from the organization`
        : fr ? `a modifié le rôle ou le rattachement de ${who ?? 'un membre'}` : `changed the role or assignment of ${who ?? 'a member'}`;
    }
    if (r === 'roles/:id/permissions') return fr ? "a modifié les permissions d'un rôle" : 'changed the permissions of a role';
    if (r === 'organizations' && p.method === 'POST') return fr ? `a créé l'organisation ${q(body.name ?? '')}` : `created the organization ${q(body.name ?? '')}`;
    if (r === 'organizations/current') return fr ? "a modifié les informations de l'organisation" : 'updated the organization details';
    if (r === 'billing/request-plan') return fr ? "a demandé un changement d'offre d'abonnement" : 'requested a subscription plan change';
    if (r === 'billing/request-seats') return fr ? 'a demandé des licences utilisateurs supplémentaires' : 'requested additional user seats';
    if (/^public\/.*responses$/.test(r) || /^(culture|work-env|satisfaction)\/.*responses$/.test(r)) {
      return fr ? 'une réponse à une enquête a été enregistrée' : 'a survey response was recorded';
    }
    if (r === 'public/contact') return fr ? 'message envoyé via le formulaire de contact du site' : 'message sent through the website contact form';
    if (r === 'processes/map') return fr ? 'a mis à jour la cartographie des processus (positions et liens)' : 'updated the process map (positions and links)';
    if (r === 'responsibilities/raci') return fr ? 'a mis à jour la matrice des responsabilités (RACI)' : 'updated the responsibility (RACI) matrix';
    if (r.startsWith('auth/')) return fr ? 'a effectué une opération de connexion / sécurité du compte' : 'performed an account sign-in / security operation';
    return null;
  }

  // ── value formatting ──────────────────────────────────────────────────────
  private fieldLabel(field: string, lang: Lang) {
    return (lang === 'fr' ? FIELDS_FR[field] : undefined) ?? humanizeKey(field);
  }

  private fieldList(obj: Row, labels: Map<string, string>, lang: Lang, prefix: string) {
    const out: ReadableEntry['details'] = [];
    for (const [field, raw] of Object.entries(obj)) {
      if (HIDDEN_FIELDS.has(field) || SENSITIVE.test(field) || field.startsWith('__')) continue;
      if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) continue;
      if (typeof raw === 'object' && !Array.isArray(raw) && !Object.keys(raw as Row).length) continue;
      if (field === 'deletedAt') continue;
      out.push({ label: prefix + this.fieldLabel(field, lang), value: this.value(field, raw, labels, lang) });
      if (out.length >= 40) break;
    }
    return out;
  }

  private value(field: string, v: unknown, labels: Map<string, string>, lang: Lang): Val {
    const fr = lang === 'fr';
    const none = { t: '—' };
    if (v === null || v === undefined || v === '') return none;
    if (typeof v === 'boolean') return { t: v ? (fr ? 'Oui' : 'Yes') : fr ? 'Non' : 'No' };
    if (typeof v === 'number') return { t: v.toLocaleString(fr ? 'fr-FR' : 'en-US') };
    if (typeof v === 'string') {
      if (v === '[redacted]') return { t: fr ? '(information masquée par sécurité)' : '(hidden for security)' };
      if (CUID_RE.test(v)) return { t: labels.get(v) ?? (fr ? '(élément supprimé ou introuvable)' : '(deleted or unknown item)') };
      if (ISO_RE.test(v)) return { d: v, time: !/T00:00:00(\.000)?Z$/.test(v) };
      if (ENUM_RE.test(v)) return { t: (fr ? VALUES_FR[v] : undefined) ?? humanizeEnum(v) };
      if (field === 'size' && /^\d+$/.test(v)) return { t: v };
      return { t: clip(stripHtml(v)) };
    }
    if (Array.isArray(v)) {
      if (!v.length) return none;
      if (v.every((x) => typeof x !== 'object' || x === null)) {
        return { t: v.map((x) => ('t' in this.value(field, x, labels, lang) ? (this.value(field, x, labels, lang) as { t: string }).t : String(x))).join(', ') };
      }
      const titles = v
        .map((x) => (x && typeof x === 'object' ? ((x as Row).label ?? (x as Row).title ?? (x as Row).name ?? (x as Row).formation) : null))
        .filter(Boolean);
      return {
        t: titles.length ? clip(titles.join(', ')) : fr ? `${v.length} élément(s)` : `${v.length} item(s)`,
      };
    }
    if (typeof v === 'object') {
      const o = v as Row;
      if (o.type === 'doc') return { t: clip(this.tiptapText(o)) || '—' };
      const parts = Object.entries(o)
        .filter(([k, x]) => x !== null && x !== '' && !SENSITIVE.test(k))
        .slice(0, 12)
        .map(([k, x]) => {
          const val = typeof x === 'object' ? (Array.isArray(x) ? `${x.length}` : '…') : String(x);
          return `${this.fieldLabel(k, lang)} : ${typeof x === 'boolean' ? (x ? (fr ? 'oui' : 'yes') : fr ? 'non' : 'no') : val}`;
        });
      return { t: clip(parts.join(' · ')) || '—' };
    }
    return { t: String(v) };
  }

  private tiptapText(node: Row): string {
    if (typeof node.text === 'string') return node.text;
    const children = Array.isArray(node.content) ? (node.content as Row[]) : [];
    return children.map((c) => this.tiptapText(c)).join(' ').replace(/\s+/g, ' ').trim();
  }

  /** "Chrome sur Windows" from a user-agent string. */
  private device(ua: string | null, lang: Lang): string | null {
    if (!ua) return null;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|axios|python/i.test(ua) ? (lang === 'fr' ? 'Script / outil technique' : 'Script / technical tool') : null;
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
    if (!browser && !os) return null;
    if (!os) return browser;
    return `${browser ?? '?'} ${lang === 'fr' ? 'sur' : 'on'} ${os}`;
  }
}
