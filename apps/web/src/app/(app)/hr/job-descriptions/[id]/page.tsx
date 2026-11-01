'use client';

import { RecordNotFound } from '@/components/layout/no-access';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShareButton } from '@/components/departments/share-button';
import { HistoryPanel } from '@/components/history/history-panel';
import { useDepartments, useEmployees } from '@/components/hr/use-hr';
import { JobDescriptionForm } from '@/components/hr/job-description-form';
import { OnboardingTemplateEditor } from '@/components/hr/onboarding-template-editor';
import type { JobDescriptionRow } from '@/components/hr/hr-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { useHasPermission } from '@/stores/session';

export default function JobDescriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('hr.jobDescriptions');
  const th = useTranslations('history');
  const router = useRouter();
  const { nameOf: employeeNameOf } = useEmployees();
  const hasPermission = useHasPermission();
  const canEdit = hasPermission('job-descriptions:update');
  const canReadEmployees = hasPermission('employees:read');
  const { nameOf } = useDepartments();

  const { data: jd, isLoading } = useQuery({
    queryKey: ['hr', 'job-descriptions', 'detail', id],
    queryFn: () => apiGet<JobDescriptionRow>(`/hr/job-descriptions/${id}`),
  });

  if (isLoading) return <div className="p-4 sm:p-6"><Skeleton className="h-96" /></div>;
  if (!jd) return <RecordNotFound />;

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.push('/hr/job-descriptions')}>
        <ArrowLeft className="size-4" /> {t('backToList')}
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{jd.jobTitle}</h1>
        <span className="font-mono text-xs text-muted-foreground">{jd.reference} · v{jd.version}</span>
        {jd.departmentId && <Badge variant="outline">{nameOf(jd.departmentId)}</Badge>}
        <ShareButton entityType="JobDescription" entityId={id} resource="job-descriptions" />
      </div>

      {!!jd.assignments?.length && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('sections.assigned')} :</span>
          {jd.assignments.map((a) =>
            canReadEmployees ? (
              <Link key={a.employee.id} href={`/hr/employees/${a.employee.id}`}>
                <Badge variant="secondary" className="text-[11px]">{a.employee.firstName} {a.employee.lastName}</Badge>
              </Link>
            ) : (
              <Badge key={a.employee.id} variant="secondary" className="text-[11px]">{a.employee.firstName} {a.employee.lastName}</Badge>
            ),
          )}
        </div>
      )}

      {canEdit ? (
        <JobDescriptionForm jd={jd} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      )}

      <OnboardingTemplateEditor jobDescriptionId={id} canEdit={canEdit} />

      <section className="mt-2 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{th('title')}</h2>
        <HistoryPanel
          entityType="JobDescription"
          entityId={id}
          fieldLabels={{
            reference: t('fields.reference'),
            version: t('fields.version'),
            applicationDate: t('fields.applicationDate'),
            jobTitle: t('fields.jobTitle'),
            departmentId: t('fields.department'),
            managerId: t('fields.manager'),
            replacementId: t('fields.replacement'),
            mainMission: t('fields.mainMission'),
            hierarchicalLink: t('fields.hierarchicalLink'),
            functionalLink: t('fields.functionalLink'),
            jobPurpose: t('fields.jobPurpose'),
            authority: t('fields.authority'),
            minExperienceMonths: t('fields.minExperienceMonths'),
            experienceDomain: t('fields.experienceDomain'),
            status: t('fields.status'),
          }}
          formatField={(field, value) => {
            if (typeof value !== 'string') return undefined;
            if (field === 'status') return t(`statuses.${value}` as Parameters<typeof t>[0]);
            if (field === 'departmentId') return nameOf(value);
            if (field === 'managerId' || field === 'replacementId') return employeeNameOf(value);
            return undefined;
          }}
        />
      </section>
    </div>
  );
}
