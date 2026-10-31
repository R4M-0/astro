'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { JobDescriptionForm } from '@/components/hr/job-description-form';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/stores/session';

export default function NewJobDescriptionPage() {
  const t = useTranslations('hr.jobDescriptions');
  const router = useRouter();
  const canCreate = useHasPermission()('job-descriptions:create');
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push('/hr/job-descriptions')}>
        <ArrowLeft className="size-4" /> {t('backToList')}
      </Button>
      <PageHeader title={t('new')} description={t('desc')} />
      {canCreate && <JobDescriptionForm />}
    </div>
  );
}
