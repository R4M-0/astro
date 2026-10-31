'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, GraduationCap, ListChecks, MessageSquare, Tag, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DepartmentFilter } from '@/components/departments/department-select';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Panel, StatTile } from '@/components/layout/stat';
import { HR_TRAINING_TYPES, TRAINING_STATUSES } from '@/components/hr/hr-meta';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PerTraining {
  id: string;
  code: string;
  theme: string;
  type: string;
  status: string;
  participantCount: number;
  responseCount: number;
  satisfactionRate: number | null;
}
interface Dashboard {
  trainingCount: number;
  completed: number;
  planned: number;
  totalParticipants: number;
  totalResponses: number;
  overallRate: number | null;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  perTraining: PerTraining[];
}

function Distribution({ title, icon, data, keys, labelFor }: { title: string; icon: React.ElementType; data: Record<string, number>; keys: readonly string[]; labelFor: (k: string) => string }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  return (
    <Panel title={title} icon={icon}>
      <div className="flex flex-col gap-2.5">
        {keys.map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{labelFor(k)}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${((data[k] ?? 0) / total) * 100}%` }} />
            </div>
            <span className="w-8 text-right text-xs font-medium tabular-nums">{data[k] ?? 0}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function TrainingDashboardPage() {
  const t = useTranslations('hr.trainingDashboard');
  const tt = useTranslations('hr.trainings');
  const [departmentId, setDepartmentId] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: [...['hr', 'trainings', 'dashboard'], departmentId],
    queryFn: () => apiGet<Dashboard>(`/hr/trainings/dashboard${departmentId ? `?departmentId=${departmentId}` : ''}`),
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
      ) : !data || data.trainingCount === 0 ? (
        <EmptyState icon={BarChart3} title={t('empty')} description={t('emptyDesc')} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <StatTile s={{ label: t('trainingCount'), value: data.trainingCount, icon: GraduationCap, accent: 'var(--primary)' }} />
            <StatTile s={{ label: t('completed'), value: data.completed, icon: CheckCircle2, accent: 'oklch(0.62 0.15 152)' }} />
            <StatTile s={{ label: t('planned'), value: data.planned, icon: GraduationCap, accent: 'oklch(0.64 0.17 235)' }} />
            <StatTile s={{ label: t('totalParticipants'), value: data.totalParticipants, icon: Users, accent: 'oklch(0.63 0.2 300)' }} />
            <StatTile s={{ label: t('totalResponses'), value: data.totalResponses, icon: MessageSquare, accent: 'oklch(0.62 0.19 195)' }} />
            <StatTile s={{ label: t('overallRate'), value: data.overallRate != null ? `${data.overallRate}%` : '—', icon: BarChart3, accent: 'oklch(0.72 0.18 70)' }} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Distribution title={t('byStatus')} icon={ListChecks} data={data.byStatus} keys={TRAINING_STATUSES} labelFor={(k) => tt(`statuses.${k}`)} />
            <Distribution title={t('byType')} icon={Tag} data={data.byType} keys={HR_TRAINING_TYPES} labelFor={(k) => tt(`types.${k}`)} />
          </div>

          <Panel title={t('perTraining')} icon={GraduationCap}>
            <div className="flex flex-col gap-1">
              {data.perTraining.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40">
                  <div className="w-56 shrink-0">
                    <p className="truncate text-sm font-medium">{p.theme}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
                  </div>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full transition-[width] duration-500', p.satisfactionRate == null ? 'bg-muted' : p.satisfactionRate >= 60 ? 'bg-success' : 'bg-warning')}
                      style={{ width: `${p.satisfactionRate ?? 0}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-sm font-semibold tabular-nums">
                    {p.satisfactionRate != null ? `${p.satisfactionRate}%` : '—'}
                  </span>
                  <span className="w-24 text-right text-[11px] text-muted-foreground">
                    {p.responseCount} {t('responses')} · {p.participantCount} {t('participants')}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
