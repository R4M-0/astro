'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { SurveyList } from '@/components/hr/survey-list';

export default function SurveysPage() {
  const t = useTranslations('hrSurveys');
  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('title')} description={t('desc')} />
      <SurveyList />
    </div>
  );
}
