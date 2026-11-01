'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AttentionItem } from '@/components/dashboards/signage';
import { apiGet } from '@/lib/api';
import type { MascotTip } from './workshop-mascot';

export interface HrDashboard {
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

/** The organization's HR aggregates (each section only for registers the caller can read). */
export function useHrDashboard() {
  return useQuery({ queryKey: ['hr', 'dashboard'], queryFn: () => apiGet<HrDashboard>('/hr/dashboard') });
}

/**
 * One source of truth for what needs attention: the dashboard's board, Gus's tips and his daily
 * round all read from here.
 */
export function useWorkshopBoard() {
  const t = useTranslations('dashboard');
  const tm = useTranslations('mascot');
  const locale = useLocale();
  const query = useHrDashboard();
  const { data, dataUpdatedAt } = query;
  const board = useMemo(() => {
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
  return { ...query, ...board };
}
