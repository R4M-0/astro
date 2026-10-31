'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { DepartmentFilter } from '@/components/departments/department-select';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { ProficiencyLegend, ProficiencyPicker } from '@/components/hr/proficiency';
import { gapTone, levelTone, type SkillType } from '@/components/hr/hr-meta';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

const ALL = '__all__';

interface MatrixEmployee {
  id: string;
  firstName: string;
  lastName: string;
  reference: string;
  departmentId: string | null;
  jobDescription: { id: string; jobTitle: string } | null;
}
interface MatrixSkill {
  id: string;
  name: string;
  type: SkillType;
}
interface MatrixEval {
  id: string;
  employeeId: string;
  skillId: string;
  expectedLevel: number | null;
  evaluatedLevel: number;
  gap: number;
  evaluationMethod: string | null;
  requiredAction: string | null;
}
interface Matrix {
  employees: MatrixEmployee[];
  skills: MatrixSkill[];
  evaluations: MatrixEval[];
  expected: { employeeId: string; skillId: string; requiredLevel: number }[];
}

interface Editing {
  employee: MatrixEmployee;
  skill: MatrixSkill;
  expectedLevel: number | null;
  existing: MatrixEval | null;
}

export default function CompetencyEvaluationPage() {
  const t = useTranslations('hr.evaluation');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canEvaluate = hasPermission('competency-evaluations:update');

  const [departmentId, setDepartmentId] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [employeeFilter, setEmployeeFilter] = useState<string>(ALL);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [level, setLevel] = useState(0);
  const [expected, setExpected] = useState<number | null>(null);
  const [method, setMethod] = useState('');
  const [action, setAction] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'evaluations', 'matrix', departmentId],
    queryFn: () => apiGet<Matrix>(`/hr/evaluations/matrix${departmentId ? `?departmentId=${departmentId}` : ''}`),
    placeholderData: (prev) => prev,
  });

  const evalMap = useMemo(() => {
    const m = new Map<string, MatrixEval>();
    for (const e of data?.evaluations ?? []) m.set(`${e.employeeId}:${e.skillId}`, e);
    return m;
  }, [data]);
  const expectedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.expected ?? []) m.set(`${e.employeeId}:${e.skillId}`, e.requiredLevel);
    return m;
  }, [data]);

  const skills = (data?.skills ?? []).filter((s) => typeFilter === ALL || s.type === typeFilter);
  const employees = (data?.employees ?? []).filter((e) => employeeFilter === ALL || e.id === employeeFilter);

  const open = (employee: MatrixEmployee, skill: MatrixSkill) => {
    if (!canEvaluate) return;
    const existing = evalMap.get(`${employee.id}:${skill.id}`) ?? null;
    const exp = existing?.expectedLevel ?? expectedMap.get(`${employee.id}:${skill.id}`) ?? null;
    setEditing({ employee, skill, expectedLevel: exp, existing });
    setLevel(existing?.evaluatedLevel ?? 0);
    setExpected(exp);
    setMethod(existing?.evaluationMethod ?? '');
    setAction(existing?.requiredAction ?? '');
  };

  const save = useMutation({
    mutationFn: () =>
      apiPost('/hr/evaluations', {
        employeeId: editing!.employee.id,
        skillId: editing!.skill.id,
        evaluatedLevel: level,
        expectedLevel: expected ?? undefined,
        evaluationMethod: method.trim() || undefined,
        requiredAction: action.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'evaluations'] });
      toast.success(t('savedToast'));
      setEditing(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
      />

      <div className="flex flex-wrap items-center gap-2">
        <DepartmentFilter
          value={departmentId}
          onChange={(v) => {
            setDepartmentId(v);
            setEmployeeFilter(ALL);
          }}
          className="w-48"
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allSkills')}</SelectItem>
            <SelectItem value="TECHNICAL">{t('filters.technical')}</SelectItem>
            <SelectItem value="BEHAVIORAL">{t('filters.behavioral')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger size="sm" className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allEmployees')}</SelectItem>
            {(data?.employees ?? []).map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto"><ProficiencyLegend /></div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t('legend')}</span>
        <span className={cn('rounded px-1.5 py-0.5', gapTone(-1))}>{t('gapLegendNeg')}</span>
        <span className={cn('rounded px-1.5 py-0.5', gapTone(0))}>{t('gapLegendZero')}</span>
        <span className={cn('rounded px-1.5 py-0.5', gapTone(1))}>{t('gapLegendPos')}</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : !employees.length || !skills.length ? (
        <EmptyState icon={ClipboardCheck} title={t('empty')} description={t('emptyDesc')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-10 min-w-52 bg-muted/40 p-2 text-left font-medium">{t('employee')}</th>
                {skills.map((s) => (
                  <th key={s.id} className="min-w-24 p-2 text-center align-bottom font-medium">
                    <div className="mx-auto max-w-28 text-xs leading-tight">{s.name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="sticky left-0 z-10 bg-background p-2">
                    <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                    <div className="text-xs text-muted-foreground">{emp.jobDescription?.jobTitle ?? '—'}</div>
                  </td>
                  {skills.map((s) => {
                    const ev = evalMap.get(`${emp.id}:${s.id}`);
                    const exp = ev?.expectedLevel ?? expectedMap.get(`${emp.id}:${s.id}`) ?? null;
                    const cellClass = cn(
                      'mx-auto flex h-11 w-16 flex-col items-center justify-center rounded-md border text-xs transition-colors',
                      ev ? cn(gapTone(ev.gap), 'border-current/30') : cn('border-dashed text-muted-foreground', canEvaluate && 'hover:bg-accent'),
                    );
                    const content = ev ? (
                      <>
                        <span className="text-sm font-semibold tabular-nums">{ev.evaluatedLevel}</span>
                        <span className="text-[10px] tabular-nums">{ev.gap > 0 ? `+${ev.gap}` : ev.gap}</span>
                      </>
                    ) : exp != null ? (
                      <span className="text-[10px]">{t('expected')} {exp}</span>
                    ) : (
                      <span>{canEvaluate ? '+' : '—'}</span>
                    );
                    const title = exp != null ? `${t('expected')}: ${exp}` : undefined;
                    return (
                      <td key={s.id} className="p-1.5 text-center">
                        {canEvaluate ? (
                          <button type="button" onClick={() => open(emp, s)} title={title} className={cellClass}>
                            {content}
                          </button>
                        ) : (
                          <div title={title} className={cellClass}>{content}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{t('dialog.title', { skill: editing.skill.name })}</DialogTitle>
                <DialogDescription>{editing.employee.firstName} {editing.employee.lastName}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('dialog.expectedLevel')}</Label>
                  <ProficiencyPicker value={expected} onChange={setExpected} allowClear />
                  {editing.expectedLevel != null && (
                    <p className="text-xs text-muted-foreground">{t('dialog.expectedFromJob')}: {editing.expectedLevel}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('dialog.evaluatedLevel')} *</Label>
                  <ProficiencyPicker value={level} onChange={setLevel} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('dialog.method')}</Label>
                  <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t('dialog.methodPh')} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('dialog.action')}</Label>
                  <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder={t('dialog.actionPh')} />
                </div>
                {level > 0 && expected != null && (
                  <div className="text-sm">
                    {t('gap')}:{' '}
                    <span className={cn('rounded px-1.5 py-0.5 font-semibold', gapTone(level - expected))}>
                      {level - expected > 0 ? `+${level - expected}` : level - expected}
                    </span>
                  </div>
                )}
                <div className={cn('h-1 rounded', level ? levelTone(level) : 'bg-muted')} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>{tc('cancel')}</Button>
                <Button disabled={!level || save.isPending} onClick={() => save.mutate()}>{t('save')}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
