export const ACTIONS = ['read', 'create', 'update', 'delete', 'approve', 'export', 'admin'] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = [
  'organization',
  'users',
  'roles',
  'dashboard',
  'employees',
  'skills',
  'job-descriptions',
  'competency-evaluations',
  'hr-trainings',
  'hr-surveys',
  'recruiting',
  'audit-log',
  'notifications',
] as const;
export type Resource = (typeof RESOURCES)[number];

export type PermissionKey = `${Resource}:${Action}`;

export const permissionKey = (resource: Resource, action: Action): PermissionKey =>
  `${resource}:${action}`;

/**
 * Actions that are actually enforced per resource. A permission key only exists when some
 * guard (`@RequirePermissions`, `granted.has(...)`, a web `useHasPermission`) checks it, so the
 * role editor never offers a box that controls nothing. `read` exists everywhere (generic
 * entity/history/AI checks build `<resource>:read`). `export` on register resources lets a role
 * download that register from the report center without the global `reports:export`.
 * Adding a guard on a new key = add the action here (a spec fails when a checked key is missing).
 */
export const RESOURCE_ACTIONS: Record<Resource, readonly Action[]> = {
  'organization': ['read', 'update', 'admin'],
  'users': ['read', 'admin'],
  'roles': ['read', 'admin'],
  'dashboard': ['read'],
  'employees': ['read', 'create', 'update', 'delete', 'approve'],
  'skills': ['read', 'create', 'update', 'delete'],
  'job-descriptions': ['read', 'create', 'update', 'delete'],
  'competency-evaluations': ['read', 'update', 'delete'],
  'hr-trainings': ['read', 'create', 'update', 'delete'],
  'hr-surveys': ['read', 'create', 'update', 'delete'],
  'recruiting': ['read', 'create', 'update', 'delete', 'approve'],
  'audit-log': ['read'],
  'notifications': ['read'],
};

/** Every permission key that exists (resource × its enforced actions). */
export const ALL_PERMISSIONS: PermissionKey[] = RESOURCES.flatMap((r) =>
  RESOURCE_ACTIONS[r].map((a) => `${r}:${a}` as PermissionKey),
);
export const PERMISSION_COUNT = ALL_PERMISSIONS.length;
const SUPPORTED = new Set<string>(ALL_PERMISSIONS);
export const isSupportedPermission = (key: string): key is PermissionKey => SUPPORTED.has(key);
export const resourceSupports = (resource: string, action: string): boolean =>
  SUPPORTED.has(`${resource}:${action}`);

const ALL_MODULE_RESOURCES: Resource[] = RESOURCES.filter(
  (r) => !['organization', 'users', 'roles', 'audit-log'].includes(r),
) as Resource[];
/** Candidate files: only roles that recruit see them by default (not managers / viewers). */
const BROAD_RESOURCES = ALL_MODULE_RESOURCES.filter((r) => r !== 'recruiting');

const crud = (r: Resource): PermissionKey[] => [
  `${r}:read`,
  `${r}:create`,
  `${r}:update`,
  `${r}:delete`,
];
const full = (r: Resource): PermissionKey[] => [...crud(r), `${r}:approve`, `${r}:export`];
const read = (r: Resource): PermissionKey[] => [`${r}:read`];

const HR_RESOURCES: Resource[] = ['employees', 'skills', 'job-descriptions', 'competency-evaluations', 'hr-trainings', 'hr-surveys'];

/** Default permission grants per system role (only supported keys). Org admins can customize copies. */
const ROLE_GRANTS: Record<string, PermissionKey[]> = {
  org_admin: [
    ...RESOURCES.flatMap((r) => full(r)),
    'organization:admin',
    'users:admin',
    'roles:admin',
    'audit-log:read',
  ],
  hr_manager: [
    ...ALL_MODULE_RESOURCES.flatMap((r) => full(r)),
    'users:read',
    'roles:read',
    'audit-log:read',
  ],
  manager: [
    ...BROAD_RESOURCES.flatMap((r) => read(r)),
    ...HR_RESOURCES.flatMap((r) => crud(r)),
  ],
  employee: ['dashboard:read', 'skills:read', 'hr-trainings:read', 'notifications:read'],
  viewer: [...BROAD_RESOURCES.flatMap((r) => read(r))],
};

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = Object.fromEntries(
  Object.entries(ROLE_GRANTS).map(([role, keys]) => [role, [...new Set(keys)].filter(isSupportedPermission)]),
);
