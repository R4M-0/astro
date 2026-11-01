'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Panel } from '@/components/layout/stat';
import { Badge } from '@/components/ui/badge';
import { apiGet } from '@/lib/api';

interface OpenSurvey {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  anonymous: boolean;
  closesAt: string | null;
  questionCount: number;
  alreadyAnswered: boolean;
}

/** « Mon espace » panel: the published surveys the signed-in member can answer (no survey permission needed). */
export function MySurveysPanel() {
  const t = useTranslations('hrSurveys.mine');
  const locale = useLocale();
  const { data } = useQuery({ queryKey: ['hr', 'surveys', 'mine'], queryFn: () => apiGet<OpenSurvey[]>('/hr/surveys/mine') });

  // hidden while loading or when there is nothing to answer
  if (!data?.length) return null;

  return (
    <Panel title={t('title')} icon={ClipboardList}>
      <div className="flex flex-col gap-2">
        {data.map((s) => (
          <Link
            key={s.id}
            href={`/hr/surveys/${s.id}`}
            className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">
                {t('questions', { count: s.questionCount })}
                {s.anonymous ? ` · ${t('anonymous')}` : ''}
                {s.closesAt ? ` · ${t('closesOn', { date: new Date(s.closesAt).toLocaleDateString(locale) })}` : ''}
              </p>
            </div>
            {s.alreadyAnswered ? (
              <Badge variant="secondary" className="gap-1 text-[11px]">
                <CheckCircle2 className="size-3" />
                {t('answered')}
              </Badge>
            ) : (
              <Badge className="text-[11px]">{t('toAnswer')}</Badge>
            )}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </Panel>
  );
}
