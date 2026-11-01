'use client';

import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, Briefcase, CalendarClock, GraduationCap, LogIn, Sparkles, Target, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AskHr } from '@/components/galaxy/ask-hr';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Panel, StatTile } from '@/components/layout/stat';
import {
  gapTone,
  TRAINING_STATUS_TONE,
  type ContractType,
  type JourneyItem,
  type JourneyProgress,
  type SkillType,
  type TrainingStatus,
} from '@/components/hr/hr-meta';
import { ITEM_KIND_ICON } from '@/components/hr/journey-item-fields';
import { MySurveysPanel } from '@/components/hr/my-surveys';
import { ProficiencyBadge } from '@/components/hr/proficiency';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNow } from '@/lib/use-now';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface MySpace {
  employee: {
    id: string;
    reference: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    departmentName: string | null;
    email: string | null;
    hireDate: string | null;
    contractType: ContractType | null;
    trialEndDate: string | null;
    manager: { firstName: string; lastName: string; jobTitle: string | null } | null;
  } | null;
  jobDescription?: {
    reference: string;
    version: string;
    jobTitle: string;
    mainMission: string | null;
    jobPurpose: string | null;
    authority: string | null;
    activities: { id: string; description: string; frequency: string | null }[];
  } | null;
  competencies?: {
    skillId: string;
    name: string;
    type: SkillType;
    required: boolean;
    expectedLevel: number | null;
    evaluatedLevel: number | null;
    gap: number | null;
    evaluatedAt: string | null;
  }[];
  trainings?: { id: string; code: string; theme: string; status: TrainingStatus; startDate: string | null; endDate: string | null; present: boolean }[];
  onboarding?: {
    id: string;
    reference: string;
    status: string;
    targetDate: string | null;
    buddy: { firstName: string; lastName: string; jobTitle: string | null } | null;
    progress: JourneyProgress;
    items: Pick<JourneyItem, 'id' | 'kind' | 'label' | 'dueDate' | 'state' | 'trainingId'>[];
    linked: { trainings: { id: string; code: string; theme: string }[] };
  } | null;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || '—'}</span>
    </div>
  );
}

/** « Mon espace » — the signed-in member's own HR record, readable without HR permissions. */
export default function MySpacePage() {
  const t = useTranslations('hr.me');
  const te = useTranslations('hr.employees');
  const tt = useTranslations('hr.trainings');
  const tj = useTranslations('hr.journeys');
  const locale = useLocale();
  const has = useHasPermission();
  const now = useNow();
  const { data, isLoading } = useQuery({ queryKey: ['hr', 'me'], queryFn: () => apiGet<MySpace>('/hr/me') });
  const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(locale) : null);

  if (isLoading) return <div className="p-4 sm:p-6"><Skeleton className="h-96" /></div>;
  if (!data?.employee) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <PageHeader title={t('title')} description={t('desc')} />
        <EmptyState icon={UserRound} title={t('notLinked')} description={t('notLinkedDesc')} />
        <div className="mt-5">
          <MySurveysPanel />
        </div>
      </div>
    );
  }

  const e = data.employee;
  const comps = data.competencies ?? [];
  const required = comps.filter((c) => c.required);
  const met = required.filter((c) => c.gap != null && c.gap >= 0).length;
  const toImprove = required.filter((c) => c.gap != null && c.gap < 0).length;
  const notEvaluated = required.filter((c) => c.evaluatedLevel == null).length;
  const upcoming = (data.trainings ?? []).filter((x) => x.status === 'PLANNED' || x.status === 'IN_PROGRESS');
  const past = (data.trainings ?? []).filter((x) => x.status === 'COMPLETED');
  const onb = data.onboarding;
  const activeOnboarding = onb && onb.status === 'IN_PROGRESS' ? onb : null;

  const itemLink = (i: NonNullable<MySpace['onboarding']>['items'][number]) => {
    if (i.trainingId && has('hr-trainings:read')) return `/hr/trainings/${i.trainingId}`;
    return null;
  };

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 p-4 sm:p-6">
      <PageHeader title={t('hello', { name: e.firstName })} description={t('desc')} />

      <AskHr />

      <MySurveysPanel />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile s={{ label: t('tiles.skillsMet'), value: required.length ? `${met}/${required.length}` : '—', icon: Target, hint: toImprove ? t('tiles.toImprove', { count: toImprove }) : notEvaluated ? t('tiles.notEvaluated', { count: notEvaluated }) : undefined, hintTone: toImprove ? 'warn' : 'muted' }} />
        <StatTile s={{ label: t('tiles.upcomingTrainings'), value: upcoming.length, icon: GraduationCap }} />
        <StatTile s={{ label: t('tiles.completedTrainings'), value: past.length, icon: BookOpenCheck }} />
        <StatTile
          s={{
            label: t('tiles.onboarding'),
            value: activeOnboarding ? `${activeOnboarding.progress.pct} %` : '—',
            icon: LogIn,
            gauge: activeOnboarding ? activeOnboarding.progress.pct : null,
            hint: activeOnboarding?.targetDate ? t('tiles.trialEnds', { date: fmt(activeOnboarding.targetDate)! }) : undefined,
            hintTone: 'muted',
          }}
        />
      </div>

      {activeOnboarding && (
        <Panel title={t('onboardingTitle')} icon={LogIn}>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex min-w-48 flex-1 items-center gap-2">
              <Progress value={activeOnboarding.progress.pct} className="h-2" />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{activeOnboarding.progress.done}/{activeOnboarding.progress.total}</span>
            </div>
            {activeOnboarding.buddy && (
              <span className="text-muted-foreground">{t('buddy')} : <span className="font-medium text-foreground">{activeOnboarding.buddy.firstName} {activeOnboarding.buddy.lastName}</span></span>
            )}
          </div>
          <ul className="divide-y rounded-lg border">
            {activeOnboarding.items.map((i) => {
              const Icon = ITEM_KIND_ICON[i.kind];
              const href = itemLink(i);
              const body = (
                <>
                  <Icon className={cn('size-4 shrink-0', i.state.done ? 'text-emerald-500' : 'text-muted-foreground')} />
                  <span className={cn('flex-1 text-sm', i.state.done && 'text-muted-foreground line-through')}>{i.label}</span>
                  {i.state.done ? (
                    <Badge variant="secondary" className="gap-1 bg-emerald-500/15 text-[11px] text-emerald-600 dark:text-emerald-400">
                      {i.state.auto && <Sparkles className="size-3" />} {tj('done')}
                    </Badge>
                  ) : i.dueDate ? (
                    <span className={cn('text-xs', i.state.overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>{tj('dueOn', { date: fmt(i.dueDate)! })}</span>
                  ) : null}
                </>
              );
              return (
                <li key={i.id}>
                  {href && !i.state.done ? (
                    <Link href={href} className="flex items-center gap-3 p-3 hover:bg-accent">{body}</Link>
                  ) : (
                    <div className="flex items-center gap-3 p-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t('onboardingHint')}</p>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('profile')} icon={UserRound}>
          <div className="grid grid-cols-2 gap-4">
            <Fact label={te('fields.jobTitle')} value={e.jobTitle} />
            <Fact label={te('fields.department')} value={e.departmentName} />
            <Fact label={te('fields.manager')} value={e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : null} />
            <Fact label={te('fields.email')} value={e.email} />
            <Fact label={te('fields.hireDate')} value={fmt(e.hireDate)} />
            <Fact label={te('fields.contractType')} value={e.contractType ? te(`contracts.${e.contractType}`) : null} />
            {e.trialEndDate && e.trialEndDate > new Date(now - 86_400_000).toISOString() && (
              <Fact label={te('fields.trialEndDate')} value={fmt(e.trialEndDate)} />
            )}
            <Fact label={t('reference')} value={e.reference} />
          </div>
        </Panel>

        <Panel title={t('jobDescription')} icon={Briefcase}>
          {data.jobDescription ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="font-medium">
                {data.jobDescription.jobTitle} <span className="font-mono text-xs text-muted-foreground">{data.jobDescription.reference} · v{data.jobDescription.version}</span>
              </p>
              {data.jobDescription.mainMission && (
                <div>
                  <p className="text-xs text-muted-foreground">{t('mission')}</p>
                  <p className="whitespace-pre-wrap">{data.jobDescription.mainMission}</p>
                </div>
              )}
              {data.jobDescription.authority && (
                <div>
                  <p className="text-xs text-muted-foreground">{t('authority')}</p>
                  <p className="whitespace-pre-wrap">{data.jobDescription.authority}</p>
                </div>
              )}
              {data.jobDescription.activities.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">{t('activities')}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {data.jobDescription.activities.map((a) => (
                      <li key={a.id}>{a.description}{a.frequency ? <span className="text-muted-foreground"> · {a.frequency}</span> : null}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noJobDescription')}</p>
          )}
        </Panel>
      </div>

      <Panel title={t('competencies')} icon={Target}>
        {comps.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('skill')}</TableHead>
                  <TableHead className="text-center">{t('expected')}</TableHead>
                  <TableHead className="text-center">{t('evaluated')}</TableHead>
                  <TableHead className="text-center">{t('gap')}</TableHead>
                  <TableHead>{t('evaluatedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comps.map((c) => (
                  <TableRow key={c.skillId}>
                    <TableCell className="font-medium">
                      {c.name}
                      {!c.required && <span className="ml-2 text-xs font-normal text-muted-foreground">{t('extraSkill')}</span>}
                    </TableCell>
                    <TableCell className="text-center"><ProficiencyBadge level={c.expectedLevel} /></TableCell>
                    <TableCell className="text-center">{c.evaluatedLevel != null ? <ProficiencyBadge level={c.evaluatedLevel} /> : <span className="text-xs text-muted-foreground">{t('notEvaluated')}</span>}</TableCell>
                    <TableCell className="text-center">
                      {c.gap != null ? (
                        <span className={cn('inline-flex min-w-8 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums', gapTone(c.gap))}>{c.gap > 0 ? `+${c.gap}` : c.gap}</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmt(c.evaluatedAt) ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noCompetencies')}</p>
        )}
      </Panel>

      <Panel title={t('trainings')} icon={GraduationCap}>
        {upcoming.length + past.length ? (
          <div className="flex flex-col gap-4">
            {[
              { key: 'upcoming', rows: upcoming },
              { key: 'past', rows: past },
            ]
              .filter((g) => g.rows.length)
              .map((g) => (
                <div key={g.key} className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`trainingGroups.${g.key}`)}</p>
                  {g.rows.map((x) => (
                    <div key={x.id} className="flex items-center gap-3 rounded-md border p-3">
                      <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{x.theme}</p>
                        <p className="text-xs text-muted-foreground">
                          {x.code}
                          {x.startDate ? ` · ${fmt(x.startDate)}` : ''}
                          {x.endDate && x.endDate !== x.startDate ? ` → ${fmt(x.endDate)}` : ''}
                          {x.status === 'COMPLETED' && !x.present ? ` · ${t('absent')}` : ''}
                        </p>
                      </div>
                      <Badge variant="secondary" className={cn('text-[11px]', TRAINING_STATUS_TONE[x.status])}>{tt(`statuses.${x.status}`)}</Badge>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noTrainings')}</p>
        )}
      </Panel>
    </div>
  );
}
