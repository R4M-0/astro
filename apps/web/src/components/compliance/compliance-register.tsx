'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Download } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, saveBlob } from '@/lib/api';
import type { ProcessingActivity } from './types';

const FIELDS = ['purpose', 'legalBasis', 'subjects', 'dataCategories', 'recipients', 'retention'] as const;

/** Record of processing activities (GDPR Art. 30), linked to the live retention policies. */
export function ComplianceRegister() {
  const t = useTranslations('compliance.register');
  const locale = useLocale() === 'en' ? 'en' : 'fr';
  const { data, isLoading } = useQuery({
    queryKey: ['compliance', 'register'],
    queryFn: () => apiGet<ProcessingActivity[]>('/compliance/processing-register'),
  });

  const download = () => {
    if (!data) return;
    const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = [t('name'), ...FIELDS.map((f) => t(`fields.${f}`)), t('fields.ai')];
    const rows = data.map((a) => [a.name[locale], ...FIELDS.map((f) => a[f][locale]), a.ai?.[locale] ?? ''].map(cell).join(';'));
    saveBlob(new Blob([`﻿${header.map(cell).join(';')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' }), `${t('fileName')}.csv`);
  };

  if (isLoading || !data) return <Skeleton className="h-96" />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('intro')}</p>
        <Button size="sm" variant="outline" onClick={download}>
          <Download className="size-4" /> CSV
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.map((a) => (
          <article key={a.key} className="flex flex-col gap-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{a.name[locale]}</h3>
              {a.ai && (
                <Badge variant="outline" className="gap-1"><Bot className="size-3" /> {t('aiBadge')}</Badge>
              )}
              {a.policy && (
                <Badge variant="outline" className={a.policy.enabled ? 'border-success/40 text-success' : 'text-muted-foreground'}>
                  {a.policy.enabled ? t('policyOn') : t('policyOff')}
                </Badge>
              )}
              <Link href={a.module} className="ml-auto text-xs text-muted-foreground hover:underline">{t('open')}</Link>
            </div>
            <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
              {FIELDS.map((f) => (
                <Fragment key={f}>
                  <dt className="text-muted-foreground">{t(`fields.${f}`)}</dt>
                  <dd>{a[f][locale]}</dd>
                </Fragment>
              ))}
              {a.ai && (
                <>
                  <dt className="text-muted-foreground">{t('fields.ai')}</dt>
                  <dd>{a.ai[locale]}</dd>
                </>
              )}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
