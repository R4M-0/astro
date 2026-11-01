import { RESOURCES } from '@astro/shared';

/** Permission-matrix sections — mirror the navigation (people / competencies / trainings / tools). */
export const RESOURCE_SECTIONS: { id: string; resources: string[] }[] = [
  { id: 'administration', resources: ['organization', 'users', 'roles', 'audit-log', 'compliance'] },
  { id: 'people', resources: ['employees'] },
  { id: 'competencies', resources: ['skills', 'job-descriptions', 'competency-evaluations'] },
  { id: 'trainings', resources: ['hr-trainings'] },
  { id: 'recruiting', resources: ['recruiting'] },
  { id: 'tools', resources: ['dashboard', 'hr-surveys', 'notifications'] },
];

/**
 * Sections restricted to resources that really exist in the shared catalog, plus an
 * « Autres » bucket for any resource added later and not yet mapped above.
 */
export function resolvedSections(): { id: string; resources: string[] }[] {
  const known = new Set<string>(RESOURCES);
  const mapped = new Set<string>();
  const sections = RESOURCE_SECTIONS.map((s) => {
    const resources = s.resources.filter((r) => known.has(r));
    resources.forEach((r) => mapped.add(r));
    return { id: s.id, resources };
  }).filter((s) => s.resources.length > 0);
  const rest = RESOURCES.filter((r) => !mapped.has(r));
  if (rest.length) sections.push({ id: 'other', resources: [...rest] });
  return sections;
}

/** Grants the org_admin role can never lose (mirrors the API lock-out guard). */
export const ORG_ADMIN_LOCKED_PERMISSIONS = new Set([
  'users:admin',
  'roles:admin',
  'roles:read',
  'users:read',
  'organization:read',
  'organization:update',
]);
