/**
 * One registry for every polymorphic `entityType`/`entityId` pair the API accepts (attachments,
 * history, activity, shares, inbox tags, generic action/document links, NC/complaint relations).
 * Each entry names the Prisma model, the RBAC resource that governs it and how the row is tied to the
 * organization (its own `organizationId`, or an org-owned parent relation). Keys are the kebab-case
 * slugs used across the code; the PascalCase model names (used by /history and /shares) resolve to
 * the same entries through `entityTypeDef()`.
 */
export interface EntityTypeDef {
  /** Prisma model name (PascalCase) */
  model: string;
  /** RBAC resource: reading needs `<resource>:read`, attaching/linking `<resource>:update` */
  resource: string;
  /** relation to an org-owned parent when the row has no `organizationId` of its own (or it is nullable) */
  parent?: { relation: string; softDelete: boolean };
  /** row carries `deletedAt` */
  softDelete: boolean;
  /** fields joined (` · `) to label the record, in order */
  label: string[];
  /** web route of the detail page */
  route?: (id: string) => string;
  /** extra filter when several types share one model  */
  where?: Record<string, unknown>;
  /** rows matching `where` (e.g. drafts) are only visible to holders of `<resource>:<action>` */
  restricted?: { where: Record<string, unknown>; action: string };
}

/** Extra filter hiding a type's restricted rows (drafts…) from a caller who lacks the permission. */
export function restrictedWhere(d: EntityTypeDef, granted: Set<string>): Record<string, unknown> {
  return d.restricted && !granted.has(`${d.resource}:${d.restricted.action}`) ? { NOT: d.restricted.where } : {};
}

/** Survey drafts are only shown to those who can edit them. */
const SURVEY_DRAFTS = { where: { status: 'DRAFT' }, action: 'update' };

const def = (
  model: string,
  resource: string,
  label: string[],
  route?: (id: string) => string,
  opts: { softDelete?: boolean; parent?: EntityTypeDef['parent']; where?: Record<string, unknown>; restricted?: EntityTypeDef['restricted'] } = {},
): EntityTypeDef => ({
  model,
  resource,
  label,
  route,
  softDelete: opts.softDelete ?? true,
  parent: opts.parent,
  where: opts.where,
  restricted: opts.restricted,
});

export const ENTITY_TYPES: Record<string, EntityTypeDef> = {
  employee: def('Employee', 'employees', ['reference', 'lastName'], (id) => `/hr/employees/${id}`),
  'hr-survey': def('HrSurvey', 'hr-surveys', ['reference', 'title'], (id) => `/hr/surveys/${id}`, {
    where: { scope: 'HR' },
    restricted: SURVEY_DRAFTS,
  }),
  'employee-journey': def('EmployeeJourney', 'employees', ['reference'], (id) => `/hr/journeys/${id}`),
  'hr-training': def('HrTraining', 'hr-trainings', ['code', 'theme'], (id) => `/hr/trainings/${id}`),
  'competency-evaluation': def('CompetencyEvaluation', 'competency-evaluations', [], undefined, { softDelete: false }),
  'job-description': def('JobDescription', 'job-descriptions', ['reference', 'jobTitle'], (id) => `/hr/job-descriptions/${id}`),
  skill: def('Skill', 'skills', ['name'], (id) => `/hr/skills/${id}`),
};

/** PascalCase model name → its (first) registry entry. */
const BY_MODEL = new Map<string, { type: string; def: EntityTypeDef }>();
for (const [type, d] of Object.entries(ENTITY_TYPES)) {
  if (!BY_MODEL.has(d.model)) BY_MODEL.set(d.model, { type, def: d });
}

/** Registry entry for a slug or a PascalCase model name (null when unknown — never walks the prototype). */
export function entityTypeDef(type: string): EntityTypeDef | null {
  if (typeof type !== 'string') return null;
  if (Object.hasOwn(ENTITY_TYPES, type)) return ENTITY_TYPES[type];
  return BY_MODEL.get(type)?.def ?? null;
}

export function isEntityType(type: string): boolean {
  return entityTypeDef(type) !== null;
}

/** Display label of a row (` · `-joined label fields, falling back to the id). */
export function entityLabel(d: EntityTypeDef, row: Record<string, unknown>): string {
  const parts = d.label.map((f) => row[f]).filter((v) => (typeof v === 'string' && v) || typeof v === 'number');
  return parts.map(String).join(' · ') || String(row.id ?? '');
}

