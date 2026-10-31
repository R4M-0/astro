import { Prisma } from '@prisma/client';

type Where = Record<string, unknown>;

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const cache = new Map<string, ((orgId: string) => Where) | null>();

/**
 * The where-clause tying rows of `model` to one organization, derived from the schema: its own
 * `organizationId`, `User` through memberships, otherwise the first required to-one relation whose
 * target carries `organizationId` (Department → site, AuditFinding → audit…). Null when the model has
 * no organization path — callers must then skip it (never look it up unfiltered).
 */
export function orgWhere(model: string, orgId: string): Where | null {
  if (!cache.has(model)) cache.set(model, build(model));
  const fn = cache.get(model);
  return fn ? fn(orgId) : null;
}

function hasOrg(name: string) {
  return !!MODELS.get(name)?.fields.some((f) => f.name === 'organizationId' && f.kind === 'scalar');
}

function build(model: string): ((orgId: string) => Where) | null {
  const m = MODELS.get(model);
  if (!m) return null;
  if (model === 'User') return (orgId) => ({ memberships: { some: { organizationId: orgId } } });
  if (model === 'Organization') return (orgId) => ({ id: orgId });
  const own = m.fields.find((f) => f.name === 'organizationId' && f.kind === 'scalar');
  // a nullable organizationId (global + org rows) still filters correctly: foreign/global rows are excluded
  if (own) return (orgId) => ({ organizationId: orgId });
  const rel = m.fields.find((f) => f.kind === 'object' && !f.isList && f.isRequired && hasOrg(f.type));
  if (rel) return (orgId) => ({ [rel.name]: { organizationId: orgId } });
  return null;
}
