'use client';

import { useQuery } from '@tanstack/react-query';
import { Award, CalendarClock, GraduationCap, LogIn, LogOut, MessageSquareText, Smile, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DistributionBars, EmptyLine, ListRow } from '@/components/dashboards/widgets';
import { useDepartments } from '@/components/hr/use-hr';
import { PageHeader } from '@/components/layout/page-header';
import { Panel, StatTile } from '@/components/layout/stat';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { useSession } from '@/stores/session';

interface HrDashboard {
  people: {
    active: number;
    inactive: number;
    hiresLast90Days: number;
    byDepartment: { departmentId: string | null; count: number }[];
    byContract: { contractType: string | null; count: number }[];
  } | null;
  journeys: {
    onboarding: number;
    offboarding: number;
    trialsSoon: { id: string; reference: string; targetDate: string | null; employee: { id: string; firstName: string; lastName: string; jobTitle: string | null } }[];
  } | null;
  competencies: {
    evaluations: number;
    belowExpected: number;
    coveragePct: number | null;
    topGaps: { skillId: string; name: string; count: number }[];
  } | null;
  trainings: {
    planned: number;
    completedThisYear: number;
    upcoming: { id: string; code: string; theme: string; startDate: string | null; status: string; participants: number }[];
    satisfactionAvg: number | null;
    feedbackCount: number;
  } | null;
  surveys: { published: number; responses: number } | null;
}

/** Astro home: the organization's HR at a glance — each section only for registers the user can read. */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const te = useTranslations('hr.employees');
  const locale = useLocale();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const { nameOf } = useDepartments();
  const { data, isLoading } = useQuery({ queryKey: ['hr', 'dashboard'], queryFn: () => apiGet<HrDashboard>('/hr/dashboard') });
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : '—');

  const empty = data && !data.people && !data.journeys && !data.competencies && !data.trainings && !data.surveys;
  // nothing to aggregate for this member (e.g. the employee role): their own space is the home page
  useEffect(() => {
    if (empty) router.replace('/hr/me');
  }, [empty, router]);

  if (isLoading || !data || empty) {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  const { people, journeys, competencies, trainings, surveys } = data;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-4 sm:p-6">
      <PageHeader title={user ? t('hello', { name: user.firstName }) : t('title')} description={t('description')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {people && (
          <StatTile
            s={{
              label: t('headcount'),
              value: people.active,
              icon: Users,
              href: '/hr/employees',
              hint: people.hiresLast90Days ? t('recentHires', { count: people.hiresLast90Days }) : undefined,
              hintTone: 'success',
            }}
          />
        )}
        {journeys && (
          <StatTile
            s={{
              label: t('onboarding'),
              value: journeys.onboarding,
              icon: LogIn,
              href: '/hr/journeys',
              hint: journeys.offboarding ? t('offboarding', { count: journeys.offboarding }) : undefined,
            }}
          />
        )}
        {competencies && (
          <StatTile
            s={{
              label: t('coverage'),
              value: competencies.coveragePct == null ? '—' : `${competencies.coveragePct} %`,
              gauge: competencies.coveragePct,
              href: '/hr/competency-evaluation',
              hint: competencies.belowExpected ? t('belowExpected', { count: competencies.belowExpected }) : undefined,
              hintTone: 'warn',
            }}
          />
        )}
        {trainings && (
          <StatTile
            s={{
              label: t('plannedTrainings'),
              value: trainings.planned,
              icon: GraduationCap,
              href: '/hr/trainings',
              hint: t('completedThisYear', { count: trainings.completedThisYear }),
            }}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {people && (
          <Panel title={t('byDepartment')} icon={Users}>
            <DistributionBars
              data={people.byDepartment
                .map((r) => ({ label: r.departmentId ? nameOf(r.departmentId) : t('noDepartment'), count: r.count }))
                .sort((a, b) => b.count - a.count)}
            />
          </Panel>
        )}
        {people && (
          <Panel title={t('byContract')} icon={UserPlus}>
            <DistributionBars
              barClassName="bg-chart-2"
              data={people.byContract
                .map((r) => ({ label: r.contractType ? te(`contracts.${r.contractType}` as never) : t('noContract'), count: r.count }))
                .sort((a, b) => b.count - a.count)}
            />
          </Panel>
        )}
        {journeys && (
          <Panel title={t('trialsSoon')} icon={CalendarClock} bodyClassName="p-2">
            {journeys.trialsSoon.length ? (
              journeys.trialsSoon.map((j) => (
                <ListRow
                  key={j.id}
                  href={`/hr/journeys/${j.id}`}
                  reference={j.reference}
                  title={`${j.employee.firstName} ${j.employee.lastName}`}
                  meta={fmt(j.targetDate)}
                  metaTone={j.targetDate && new Date(j.targetDate) < new Date() ? 'destructive' : 'warn'}
                >
                  {j.employee.jobTitle && <p className="truncate text-xs text-muted-foreground">{j.employee.jobTitle}</p>}
                </ListRow>
              ))
            ) : (
              <EmptyLine>{t('noTrials')}</EmptyLine>
            )}
          </Panel>
        )}
        {trainings && (
          <Panel title={t('upcomingTrainings')} icon={GraduationCap} bodyClassName="p-2">
            {trainings.upcoming.length ? (
              trainings.upcoming.map((x) => (
                <ListRow key={x.id} href={`/hr/trainings/${x.id}`} reference={x.code} title={x.theme} meta={fmt(x.startDate)}>
                  <p className="text-xs text-muted-foreground">{t('participants', { count: x.participants })}</p>
                </ListRow>
              ))
            ) : (
              <EmptyLine>{t('noUpcomingTrainings')}</EmptyLine>
            )}
          </Panel>
        )}
        {competencies && (
          <Panel title={t('topGaps')} icon={Award}>
            {competencies.topGaps.length ? (
              <DistributionBars barClassName="bg-destructive/70" data={competencies.topGaps.map((g) => ({ label: g.name, count: g.count }))} />
            ) : (
              <EmptyLine>{t('noGaps')}</EmptyLine>
            )}
          </Panel>
        )}
        {(trainings || surveys) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {trainings && (
              <StatTile
                s={{
                  label: t('satisfaction'),
                  value: trainings.satisfactionAvg == null ? '—' : `${trainings.satisfactionAvg.toFixed(1)} / 5`,
                  icon: Smile,
                  href: '/hr/trainings/dashboard',
                  hint: t('feedbackCount', { count: trainings.feedbackCount }),
                }}
              />
            )}
            {surveys && (
              <StatTile
                s={{
                  label: t('openSurveys'),
                  value: surveys.published,
                  icon: MessageSquareText,
                  href: '/hr/surveys',
                  hint: t('surveyResponses', { count: surveys.responses }),
                }}
              />
            )}
            {journeys && journeys.offboarding > 0 && (
              <StatTile s={{ label: t('offboardingTitle'), value: journeys.offboarding, icon: LogOut, href: '/hr/journeys' }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
