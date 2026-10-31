'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardList, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DepartmentFilter } from '@/components/departments/department-select';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Panel, StatTile } from '@/components/layout/stat';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Item {
  id: string;
  label: string;
  avgLevel: number;
  avgGap: number;
  count: number;
}
interface Dashboard {
  totalEvaluations: number;
  employeesEvaluated: number;
  skillsEvaluated: number;
  gapsCount: number;
  avgGap: number;
  topSkills: Item[];
  flopSkills: Item[];
  topEmployees: Item[];
  flopEmployees: Item[];
  topDepartments: Item[];
  flopDepartments: Item[];
}

function RankList({ title, items, icon: Icon, tone }: { title: string; items: Item[]; icon: React.ElementType; tone: string }) {
  const t = useTranslations('hr.evaluationDashboard');
  return (
    <Panel title={<span className="flex items-center gap-2"><Icon className={cn('size-4', tone)} /> {title}</span>}>
      <div className="flex flex-col gap-0.5">
        {items.length ? items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
            <span className="flex-1 truncate text-sm">{it.label}</span>
            <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full transition-[width] duration-500', tone.replace('text-', 'bg-'))} style={{ width: `${(it.avgLevel / 5) * 100}%` }} />
            </div>
            <span className="w-10 text-right text-xs font-semibold tabular-nums">{it.avgLevel}</span>
            <span className="w-14 text-right text-[11px] text-muted-foreground">{t('count', { n: it.count })}</span>
          </div>
        )) : <p className="px-2 py-2 text-sm text-muted-foreground">—</p>}
      </div>
    </Panel>
  );
}

export default function CompetencyDashboardPage() {
  const t = useTranslations('hr.evaluationDashboard');
  const [departmentId, setDepartmentId] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: [...['hr', 'evaluations', 'dashboard'], departmentId],
    queryFn: () => apiGet<Dashboard>(`/hr/evaluations/dashboard${departmentId ? `?departmentId=${departmentId}` : ''}`),
  });

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={<DepartmentFilter value={departmentId} onChange={setDepartmentId} className="w-48" />}
      />

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : !data || data.totalEvaluations === 0 ? (
        <EmptyState icon={ClipboardList} title={t('empty')} description={t('emptyDesc')} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile s={{ label: t('totalEvaluations'), value: data.totalEvaluations, icon: ClipboardList, accent: 'var(--primary)' }} />
            <StatTile s={{ label: t('employeesEvaluated'), value: data.employeesEvaluated, icon: Users, accent: 'oklch(0.64 0.17 235)' }} />
            <StatTile s={{ label: t('skillsEvaluated'), value: data.skillsEvaluated, icon: ClipboardList, accent: 'oklch(0.62 0.19 195)' }} />
            <StatTile s={{ label: t('gaps'), value: data.gapsCount, icon: TrendingDown, accent: 'oklch(0.64 0.23 25)' }} />
            <StatTile s={{ label: t('avgGap'), value: data.avgGap > 0 ? `+${data.avgGap}` : data.avgGap, icon: TrendingUp, accent: 'oklch(0.68 0.17 90)' }} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RankList title={t('topSkills')} items={data.topSkills} icon={TrendingUp} tone="text-emerald-600 dark:text-emerald-400" />
            <RankList title={t('flopSkills')} items={data.flopSkills} icon={TrendingDown} tone="text-rose-600 dark:text-rose-400" />
            <RankList title={t('topEmployees')} items={data.topEmployees} icon={TrendingUp} tone="text-emerald-600 dark:text-emerald-400" />
            <RankList title={t('flopEmployees')} items={data.flopEmployees} icon={TrendingDown} tone="text-rose-600 dark:text-rose-400" />
            <RankList title={t('topDepartments')} items={data.topDepartments} icon={TrendingUp} tone="text-sky-600 dark:text-sky-400" />
            <RankList title={t('flopDepartments')} items={data.flopDepartments} icon={TrendingDown} tone="text-amber-600 dark:text-amber-400" />
          </div>
        </>
      )}
    </div>
  );
}
