'use client';

import { useQuery } from '@tanstack/react-query';
import { Award, CalendarClock, GraduationCap, LogIn, MessageSquareText, Smile, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DistributionBars, EmptyLine, ListRow } from '@/components/dashboards/widgets';
import { useDepartments } from '@/components/hr/use-hr';
import { AttentionBoard, type AttentionItem } from '@/components/dashboards/signage';
import { Panel, StatTile } from '@/components/layout/stat';
import { WorkshopMascot, type MascotTip } from '@/components/mascot/workshop-mascot';
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

const DAY = 86_400_000;

/** Constella home: what needs action today first, then the organization's HR at a glance — each block only for registers the user can read. */
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tm = useTranslations('mascot');
  const te = useTranslations('hr.employees');
  const locale = useLocale();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const { nameOf } = useDepartments();
  const { data, isLoading, dataUpdatedAt } = useQuery({ queryKey: ['hr', 'dashboard'], queryFn: () => apiGet<HrDashboard>('/hr/dashboard') });
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '—');

  const empty = data && !data.people && !data.journeys && !data.competencies && !data.trainings && !data.surveys;
  // nothing to aggregate for this member (e.g. the employee role): their own space is the home page
  useEffect(() => {
    if (empty) router.replace('/hr/me');
  }, [empty, router]);

  // ---- one source of truth for the attention board and Gus's tips -------------------------
  const { items, tips } = useMemo(() => {
    const items: AttentionItem[] = [];
    const tips: MascotTip[] = [];
    if (!data) return { items, tips };
    // severities are judged at fetch time, so a re-render never reclassifies a row
    const now = dataUpdatedAt;
    const { people, journeys, competencies, trainings, surveys } = data;
    const short = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '—');
    const long = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'long' }) : '—');

    for (const j of journeys?.trialsSoon ?? []) {
      const name = `${j.employee.firstName} ${j.employee.lastName}`;
      const overdue = !!j.targetDate && new Date(j.targetDate).getTime() < now;
      items.push({
        id: `trial:${j.id}:${j.targetDate}`,
        severity: overdue ? 'alert' : 'warn',
        title: t(overdue ? 'trialOverdue' : 'trialEnds', { name }),
        detail: [j.reference, j.employee.jobTitle].filter(Boolean).join(' · '),
        meta: short(j.targetDate),
        href: `/hr/journeys/${j.id}`,
      });
      tips.push({
        id: `trial:${j.id}`,
        tone: overdue ? 'alert' : 'warn',
        text: tm(overdue ? 'trialOverdue' : 'trialSoon', { name: j.employee.firstName, date: long(j.targetDate) }),
        href: `/hr/journeys/${j.id}`,
      });
    }
    if (competencies && competencies.belowExpected > 0) {
      const top = competencies.topGaps[0];
      items.push({
        id: `gaps:${competencies.belowExpected}`,
        severity: 'warn',
        title: t('gapsTitle', { count: competencies.belowExpected }),
        detail: top ? t('gapsMeta', { skill: top.name }) : undefined,
        href: '/hr/competency-evaluation',
      });
      tips.push({
        id: 'gaps',
        tone: 'warn',
        text: tm('gaps', { count: competencies.belowExpected, skill: top?.name ?? '—' }),
        href: '/hr/competency-evaluation',
      });
    }
    for (const x of trainings?.upcoming ?? []) {
      if (!x.startDate || new Date(x.startDate).getTime() - now > 21 * DAY) continue;
      items.push({
        id: `training:${x.id}`,
        severity: 'todo',
        title: t('trainingSoon', { theme: x.theme }),
        detail: [x.code, t('participants', { count: x.participants })].join(' · '),
        meta: short(x.startDate),
        href: `/hr/trainings/${x.id}`,
      });
    }
    const nextTraining = trainings?.upcoming[0];
    if (nextTraining) {
      tips.push({
        id: `training:${nextTraining.id}`,
        tone: 'todo',
        text: tm('training', { theme: nextTraining.theme, date: long(nextTraining.startDate), count: nextTraining.participants }),
        href: `/hr/trainings/${nextTraining.id}`,
      });
    }
    if (journeys && journeys.onboarding > 0) {
      items.push({ id: 'onboarding', severity: 'info', title: t('onboardingRow', { count: journeys.onboarding }), href: '/hr/journeys' });
      tips.push({ id: 'onboarding', tone: 'info', text: tm('onboarding', { count: journeys.onboarding }), href: '/hr/journeys' });
    }
    if (journeys && journeys.offboarding > 0) {
      items.push({ id: 'offboarding', severity: 'info', title: t('offboardingRow', { count: journeys.offboarding }), href: '/hr/journeys' });
    }
    if (competencies?.coveragePct != null) {
      tips.push({
        id: 'coverage',
        tone: competencies.coveragePct >= 90 ? 'ok' : 'info',
        text: tm('coverage', { pct: competencies.coveragePct }),
        href: '/hr/competency-evaluation/polyvalence',
      });
    }
    if (people && people.hiresLast90Days > 0) {
      tips.push({ id: 'hires', tone: 'ok', text: tm('hires', { count: people.hiresLast90Days }), href: '/hr/employees' });
    }
    if (surveys && surveys.published > 0) {
      tips.push({ id: 'surveys', tone: 'info', text: tm('surveys', { count: surveys.published, responses: surveys.responses }), href: '/hr/surveys' });
    }
    if (!items.some((i) => i.severity === 'alert' || i.severity === 'warn')) {
      tips.unshift({ id: 'clear', tone: 'ok', text: tm('allClear') });
    }
    const rank = { alert: 0, warn: 1, todo: 2, info: 3, ok: 4 } as const;
    items.sort((a, b) => rank[a.severity] - rank[b.severity]);
    tips.sort((a, b) => rank[a.tone] - rank[b.tone]);
    return { items: items.slice(0, 7), tips };
  }, [data, dataUpdatedAt, locale, t, tm]);

  const hour = new Date(dataUpdatedAt).getHours();
  const greeting = tm(hour < 12 ? 'greetMorning' : hour < 18 ? 'greetAfternoon' : 'greetEvening', { name: user?.firstName ?? '' });

  if (isLoading || !data || empty) {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  const { people, journeys, competencies, trainings, surveys } = data;
  const today = new Date(dataUpdatedAt).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-4 pb-64 sm:p-6 sm:pb-64">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-keyline pb-4">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.9rem,3.2vw,2.75rem)] leading-[1.02] font-extrabold tracking-[-0.03em] text-balance [font-stretch:92%]">
            {user ? t('hello', { name: user.firstName }) : t('title')}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <p className="plate-label text-[13px] text-foreground/75 first-letter:uppercase">{today}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AttentionBoard items={items} className={people ? 'lg:col-span-2' : 'lg:col-span-3'} />
        {people && (
          <HeadcountPlate
            active={people.active}
            inactive={people.inactive}
            hires={people.hiresLast90Days}
            onboarding={journeys?.onboarding}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              value: competencies.coveragePct == null ? '—' : `${competencies.coveragePct}%`,
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
        {trainings && (
          <StatTile
            s={{
              label: t('satisfaction'),
              value: trainings.satisfactionAvg == null ? '—' : trainings.satisfactionAvg.toFixed(1),
              icon: Smile,
              accent: 'var(--success)',
              href: '/hr/trainings/dashboard',
              hint: t('feedbackCount', { count: trainings.feedbackCount }),
            }}
          />
        )}
        {surveys && !trainings && (
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {people && (
          <Panel title={t('byDepartment')} icon={Users}>
            <DistributionBars
              barClassName="bg-primary"
              data={people.byDepartment
                .map((r) => ({ label: r.departmentId ? nameOf(r.departmentId) : t('noDepartment'), count: r.count }))
                .sort((a, b) => b.count - a.count)}
            />
          </Panel>
        )}
        {people && (
          <Panel title={t('byContract')} icon={UserPlus}>
            <DistributionBars
              barClassName="bg-foreground/80"
              data={people.byContract
                .map((r) => ({ label: r.contractType ? te(`contracts.${r.contractType}` as never) : t('noContract'), count: r.count }))
                .sort((a, b) => b.count - a.count)}
            />
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
              <DistributionBars barClassName="hazard-thin" data={competencies.topGaps.map((g) => ({ label: g.name, count: g.count }))} />
            ) : (
              <EmptyLine>{t('noGaps')}</EmptyLine>
            )}
          </Panel>
        )}
        {journeys && !trainings && (
          <Panel title={t('trialsSoon')} icon={CalendarClock} bodyClassName="p-2">
            {journeys.trialsSoon.length ? (
              journeys.trialsSoon.map((j) => (
                <ListRow key={j.id} href={`/hr/journeys/${j.id}`} reference={j.reference} title={`${j.employee.firstName} ${j.employee.lastName}`} meta={fmt(j.targetDate)} />
              ))
            ) : (
              <EmptyLine>{t('noTrials')}</EmptyLine>
            )}
          </Panel>
        )}
      </div>

      <WorkshopMascot tips={tips} greeting={greeting} />
    </div>
  );
}

/** Inverse ink plate: the headcount, set like the big number on a factory safety board. */
function HeadcountPlate({ active, inactive, hires, onboarding }: { active: number; inactive: number; hires: number; onboarding?: number }) {
  const t = useTranslations('dashboard');
  return (
    <Link
      href="/hr/employees"
      className="plate-press group relative flex flex-col justify-between gap-6 overflow-hidden rounded-[5px] border-2 border-keyline bg-foreground p-5 text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="plate-label text-[15px] text-background/80">{t('headcount')}</p>
        <Users aria-hidden className="size-5 text-background/70" />
      </div>
      <p className="figure text-[clamp(4.5rem,8vw,6.5rem)] text-background">{active}</p>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] bg-background/20">
        <div className="bg-foreground py-2 pr-3">
          <dt className="plate-label text-[11px] text-background/65">{t('hiresPlate')}</dt>
          <dd className="figure mt-1 text-2xl text-[oklch(0.8_0.16_155)] dark:text-[oklch(0.45_0.13_155)]">+{hires}</dd>
        </div>
        <div className="bg-foreground py-2 pl-3">
          <dt className="plate-label text-[11px] text-background/65">{t('onboarding')}</dt>
          <dd className="figure mt-1 text-2xl">{onboarding ?? '—'}</dd>
        </div>
      </dl>
      <p className="-mt-3 text-xs text-background/70">{t('inactive', { count: inactive })}</p>
    </Link>
  );
}
