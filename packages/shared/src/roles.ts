export const SYSTEM_ROLES = [
  { key: 'org_admin', name: 'Organization Admin' },
  { key: 'hr_manager', name: 'HR Manager' },
  { key: 'manager', name: 'Manager' },
  { key: 'employee', name: 'Employee' },
  { key: 'viewer', name: 'Read-only' },
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[number]['key'];

/** System roles whose members only see their department(s)' records by default (editable per org). */
export const DEPARTMENT_SCOPED_ROLE_KEYS: readonly string[] = ['employee', 'manager'];
