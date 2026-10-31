import { runWithHistoryContext, type HistoryContext } from '../history/history-context';
import { DEPARTMENT_OWNING_MODELS, scopeArgs } from './department-scope';

const ctx = (defaultDepartmentId: string | null): HistoryContext => ({
  actorId: 'u1', organizationId: 'orgA', ip: null, userAgent: null, deleteEvents: [], touched: [], access: null,
  defaultDepartmentId,
});

describe('scopeArgs — default department', () => {
  const model = 'Employee';
  const base = {} as any;

  it('is a department-owning model', () => {
    expect(DEPARTMENT_OWNING_MODELS.has(model)).toBe(true);
  });

  it("files a new record under the author's main department", async () => {
    const args = await runWithHistoryContext(ctx('deptA'), () => scopeArgs(base, model, 'create', { data: { firstName: 'A' } }));
    expect(args.data.departmentId).toBe('deptA');
  });

  it('keeps an explicit department', async () => {
    const args = await runWithHistoryContext(ctx('deptA'), () =>
      scopeArgs(base, model, 'create', { data: { firstName: 'A', departmentId: 'deptB' } }),
    );
    expect(args.data.departmentId).toBe('deptB');
  });
});
