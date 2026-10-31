'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DepartmentFilter } from '@/components/departments/department-select';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Panel, StatTile } from '@/components/layout/stat';
import { SKILL_TYPE_TONE, type SkillType } from '@/components/hr/hr-meta';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface Matrix {
  employees: { id: string; firstName: string; lastName: string; reference: string; active: boolean }[];
  skills: { id: string; name: string; type: SkillType }[];
  evaluations: { employeeId: string; skillId: string; evaluatedLevel: number }[];
  expected: { employeeId: string; skillId: string; requiredLevel: number }[];
}

type Risk = 'uncovered' | 'single' | 'fragile' | 'covered';
const RISK_ORDER: Risk[] = ['uncovered', 'single', 'fragile', 'covered'];
const RISK_TONE: Record<Risk, string> = {
  uncovered: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  single: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  fragile: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  covered: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};
const ALL = '__all__';

/**
 * Polyvalence: for each skill, who holds it at the chosen level (autonomous by default) —
 * a skill held by nobody or a single person is a continuity risk (absence, departure).
 */
export default function CoveragePage() {
  const t = useTranslations('hr.coverage');
  const canReadEmployees = useHasPermission()('employees:read');
  const [departmentId, setDepartmentId] = useState('');
  const [minLevel, setMinLevel] = useState('3');
  const [riskFilter, setRiskFilter] = useState<string>(ALL);
  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'evaluations', 'matrix', departmentId],
    queryFn: () => apiGet<Matrix>(`/hr/evaluations/matrix${departmentId ? `?departmentId=${departmentId}` : ''}`),
  });

  const { skills, people, counts } = useMemo(() => {
    const min = Number(minLevel);
    const active = new Map((data?.employees ?? []).filter((e) => e.active).map((e) => [e.id, e]));
    const holders = new Map<string, { id: string; name: string; level: number }[]>();
    for (const ev of data?.evaluations ?? []) {
      const e = active.get(ev.employeeId);
      if (!e || ev.evaluatedLevel < min) continue;
      holders.set(ev.skillId, [...(holders.get(ev.skillId) ?? []), { id: e.id, name: `${e.firstName} ${e.lastName}`, level: ev.evaluatedLevel }]);
    }
    const requiredBy = new Map<string, number>();
    for (const x of data?.expected ?? []) if (active.has(x.employeeId)) requiredBy.set(x.skillId, (requiredBy.get(x.skillId) ?? 0) + 1);
    const rows = (data?.skills ?? []).map((s) => {
      const h = (holders.get(s.id) ?? []).sort((a, b) => b.level - a.level);
      const risk: Risk = h.length === 0 ? 'uncovered' : h.length === 1 ? 'single' : h.length === 2 ? 'fragile' : 'covered';
      return { ...s, holders: h, requiredBy: requiredBy.get(s.id) ?? 0, risk };
    });
    // skills nobody needs and nobody holds are noise
    const relevant = rows.filter((r) => r.holders.length || r.requiredBy);
    relevant.sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || b.requiredBy - a.requiredBy || a.name.localeCompare(b.name));
    const perPerson = [...active.values()]
      .map((e) => ({
        ...e,
        skills: rows.filter((r) => r.holders.some((h) => h.id === e.id)).length,
        sole: rows.filter((r) => r.holders.length === 1 && r.holders[0].id === e.id).map((r) => r.name),
      }))
      .filter((p) => p.skills || p.sole.length)
      .sort((a, b) => b.sole.length - a.sole.length || b.skills - a.skills);
    const c = Object.fromEntries(RISK_ORDER.map((r) => [r, relevant.filter((x) => x.risk === r).length])) as Record<Risk, number>;
    return { skills: relevant, people: perPerson, counts: c };
  }, [data, minLevel]);

  const visible = riskFilter === ALL ? skills : skills.filter((s) => s.risk === riskFilter);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('title')} description={t('desc')} />

      <div className="flex flex-wrap items-center gap-2">
        <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
        <Select value={minLevel} onValueChange={setMinLevel}>
          <SelectTrigger size="sm" className="w-auto min-w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['2', '3', '4', '5'].map((l) => (
              <SelectItem key={l} value={l}>{t('minLevel', { level: l })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger size="sm" className="w-auto min-w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allRisks')}</SelectItem>
            {RISK_ORDER.map((r) => (
              <SelectItem key={r} value={r}>{t(`risks.${r}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : !skills.length ? (
        <EmptyState icon={Users} title={t('empty')} description={t('emptyDesc')} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile s={{ label: t('risks.uncovered'), value: counts.uncovered, icon: ShieldAlert, accent: 'var(--destructive)', hint: t('hints.uncovered'), hintTone: 'muted' }} />
            <StatTile s={{ label: t('risks.single'), value: counts.single, icon: AlertTriangle, accent: 'oklch(0.7 0.17 50)', hint: t('hints.single'), hintTone: 'muted' }} />
            <StatTile s={{ label: t('risks.fragile'), value: counts.fragile, icon: AlertTriangle, accent: 'oklch(0.8 0.15 85)', hint: t('hints.fragile'), hintTone: 'muted' }} />
            <StatTile s={{ label: t('risks.covered'), value: counts.covered, icon: ShieldCheck, accent: 'oklch(0.7 0.15 155)', hint: t('hints.covered'), hintTone: 'muted' }} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('skill')}</TableHead>
                    <TableHead className="text-center">{t('requiredBy')}</TableHead>
                    <TableHead className="text-center">{t('holdersCount')}</TableHead>
                    <TableHead>{t('holders')}</TableHead>
                    <TableHead>{t('risk')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/hr/skills/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                        <Badge variant="secondary" className={cn('ml-2 text-[10px]', SKILL_TYPE_TONE[s.type])}>{s.type === 'TECHNICAL' ? t('technical') : t('behavioral')}</Badge>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{s.requiredBy || '—'}</TableCell>
                      <TableCell className="text-center font-semibold tabular-nums">{s.holders.length}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {s.holders.slice(0, 6).map((h) => (
                            canReadEmployees ? (
                              <Link key={h.id} href={`/hr/employees/${h.id}`}>
                                <Badge variant="outline" className="text-[11px] font-normal">{h.name} · {h.level}</Badge>
                              </Link>
                            ) : (
                              <Badge key={h.id} variant="outline" className="text-[11px] font-normal">{h.name} · {h.level}</Badge>
                            )
                          ))}
                          {s.holders.length > 6 && <span className="text-xs text-muted-foreground">+{s.holders.length - 6}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={cn('text-[11px]', RISK_TONE[s.risk])}>{t(`risks.${s.risk}`)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Panel title={t('keyPeople')} icon={Users}>
              <p className="mb-3 text-xs text-muted-foreground">{t('keyPeopleDesc')}</p>
              <ul className="flex flex-col gap-2">
                {people.slice(0, 15).map((p) => (
                  <li key={p.id} className="rounded-md border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      {canReadEmployees ? (
                        <Link href={`/hr/employees/${p.id}`} className="text-sm font-medium hover:underline">{p.firstName} {p.lastName}</Link>
                      ) : (
                        <span className="text-sm font-medium">{p.firstName} {p.lastName}</span>
                      )}
                      <span className="text-xs tabular-nums text-muted-foreground">{t('skillsHeld', { count: p.skills })}</span>
                    </div>
                    {p.sole.length > 0 && (
                      <p className="mt-1 text-xs text-orange-600 dark:text-orange-400">{t('soleHolder', { skills: p.sole.join(', ') })}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
