/**
 * Visibility registry: the registers whose visibility an organization admin can configure
 * (Admin → Visibilité). Each register picks one mode:
 *  - `organization` — every member sees every record (RBAC still applies);
 *  - `process`      — members of department-limited roles (Role.departmentScoped) only see records of
 *                     their process(es) (= departments: main + extra + their groups'), plus records they
 *                     are involved in or that are shared with them; other roles see everything;
 *  - `members`      — EVERY member (admins included) only sees records they are involved in or that are
 *                     shared with them (with them or one of their groups).
 * "Involved" = the person fields listed per register. Child models (tasks, findings…) follow their parent.
 */
export type VisibilityMode = 'organization' | 'process' | 'members';
export const VISIBILITY_MODES: VisibilityMode[] = ['organization', 'process', 'members'];

export interface PeopleRule {
  /** scalar user-id fields that make a user "involved" */
  people: string[];
  /** String[] user-id fields */
  peopleLists?: string[];
}

export interface ChildRegister extends Partial<PeopleRule> {
  model: string;
  /** to-one relation from the child to the parent register's model */
  relation: string;
}

export interface Register extends PeopleRule {
  model: string;
  /** RBAC resource (share rights = `<resource>:update`) */
  resource: string;
  /** ISO block used to group registers in the admin screen */
  group: 'hr';
  modes: VisibilityMode[];
  default: VisibilityMode;
  children?: ChildRegister[];
}

const ALL: VisibilityMode[] = ['organization', 'process', 'members'];
/** registers without a department column cannot be filtered by process */
const NO_PROCESS: VisibilityMode[] = ['organization', 'members'];

export const REGISTERS: Register[] = [
  // RH
  {
    model: 'Employee', resource: 'employees', group: 'hr', modes: ALL, default: 'process', people: ['userId', 'createdById'],
    children: [
      { model: 'CompetencyEvaluation', relation: 'employee', people: ['evaluatedById'] },
      // onboarding / offboarding plans follow their employee; the HR owner is involved
      { model: 'EmployeeJourney', relation: 'employee', people: ['ownerId', 'createdById'] },
    ],
  },
  { model: 'JobDescription', resource: 'job-descriptions', group: 'hr', modes: ALL, default: 'process', people: ['createdById'] },
  { model: 'HrTraining', resource: 'hr-trainings', group: 'hr', modes: ALL, default: 'process', people: ['createdById'] },
];

export const REGISTER_BY_MODEL = new Map(REGISTERS.map((r) => [r.model, r]));

/** child model → its parent register + relation */
export const CHILD_REGISTERS = new Map(
  REGISTERS.flatMap((r) => (r.children ?? []).map((c) => [c.model, { parent: r, child: c }] as const)),
);

/** Models with their own `departmentId` (registers that can be filtered by process). */
export const DEPARTMENT_OWNING_MODELS = new Set(REGISTERS.filter((r) => r.modes.includes('process')).map((r) => r.model));

/** Every model whose records can be shared (RecordShare). */
export const SHAREABLE_MODELS = new Set([...REGISTERS.map((r) => r.model), ...CHILD_REGISTERS.keys()]);

export type VisibilityPolicy = Record<string, VisibilityMode>;

/** The organization's policy: defaults overridden by `Organization.settings.visibility` (valid modes only). */
export function resolvePolicy(settings: unknown): VisibilityPolicy {
  const stored = (settings as { visibility?: Record<string, unknown> } | null)?.visibility ?? {};
  const policy: VisibilityPolicy = {};
  for (const r of REGISTERS) {
    const v = stored[r.model];
    policy[r.model] = typeof v === 'string' && (r.modes as string[]).includes(v) ? (v as VisibilityMode) : r.default;
  }
  return policy;
}
