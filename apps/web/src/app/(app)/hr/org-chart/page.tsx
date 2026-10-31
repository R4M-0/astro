'use client';

import { useQuery } from '@tanstack/react-query';
import { Network, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmployeeFormDialog } from '@/components/hr/employee-form-dialog';
import { OrgChart, type OrgChartEmployee } from '@/components/hr/org-chart';
import { useDepartments } from '@/components/hr/use-hr';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { useHasPermission } from '@/stores/session';

export default function OrgChartPage() {
  const t = useTranslations('hr.orgChart');
  const router = useRouter();
  const { departments, nameOf } = useDepartments();
  const hasPermission = useHasPermission();
  const canCreate = hasPermission('employees:create');
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'employees', 'org-chart'],
    queryFn: () => apiGet<OrgChartEmployee[]>('/hr/employees/org-chart'),
  });
  const employees = data ?? [];

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t('newEmployee')}
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="flex justify-center gap-10">
          <Skeleton className="h-40 w-48" />
          <Skeleton className="h-40 w-48" />
          <Skeleton className="h-40 w-48" />
        </div>
      ) : employees.length === 0 ? (
        <EmptyState icon={Network} title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <OrgChart
          employees={employees}
          deptName={nameOf}
          departments={departments}
          onSelect={(id) => router.push(`/hr/employees/${id}`)}
        />
      )}

      <EmployeeFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
