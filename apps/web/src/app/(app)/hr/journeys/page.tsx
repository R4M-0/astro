'use client';

import { useQuery } from '@tanstack/react-query';
import { LogIn, LogOut, Route, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DepartmentFilter } from '@/components/departments/department-select';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { JourneyCreateDialog } from '@/components/hr/journey-create-dialog';
import { JOURNEY_STATUSES, JOURNEY_STATUS_TONE, type JourneyKind, type JourneyRow } from '@/components/hr/hr-meta';
import { useMembers } from '@/components/hr/use-members';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

const ALL = '__all__';

export default function JourneysPage() {
  const t = useTranslations('hr.journeys');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEdit = useHasPermission()('employees:update');
  const { nameOf } = useMembers();
  const [kind, setKind] = useState<JourneyKind>(searchParams.get('kind') === 'OFFBOARDING' ? 'OFFBOARDING' : 'ONBOARDING');
  const [status, setStatus] = useState<string>('IN_PROGRESS');
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const changeKind = (k: string) => {
    setKind(k as JourneyKind);
    router.replace(`?kind=${k}`, { scroll: false });
  };

  const params = new URLSearchParams({ kind, pageSize: '200' });
  if (status !== ALL) params.set('status', status);
  if (department) params.set('departmentId', department);
  if (search) params.set('search', search);
  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'journeys', params.toString()],
    queryFn: () => apiGet<{ data: JourneyRow[] }>(`/hr/journeys?${params.toString()}`),
  });
  const rows = data?.data ?? [];
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : '—');
  const onboarding = kind === 'ONBOARDING';

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {onboarding ? <LogIn className="size-4" /> : <LogOut className="size-4" />}
              {onboarding ? t('newOnboarding') : t('newOffboarding')}
            </Button>
          ) : undefined
        }
      />

      <Tabs value={kind} onValueChange={changeKind}>
        <TabsList>
          <TabsTrigger value="ONBOARDING"><LogIn className="size-4" /> {t('onboarding')}</TabsTrigger>
          <TabsTrigger value="OFFBOARDING"><LogOut className="size-4" /> {t('offboarding')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {JOURNEY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`statuses.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DepartmentFilter value={department} onChange={setDepartment} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Route} title={onboarding ? t('emptyOnboarding') : t('emptyOffboarding')} description={onboarding ? t('emptyOnboardingDesc') : t('emptyOffboardingDesc')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fields.reference')}</TableHead>
                <TableHead>{t('fields.employee')}</TableHead>
                <TableHead>{onboarding ? t('fields.startDate') : t('fields.announcedAt')}</TableHead>
                <TableHead>{onboarding ? t('fields.trialEnd') : t('fields.exitDate')}</TableHead>
                <TableHead>{t('fields.owner')}</TableHead>
                <TableHead className="w-48">{t('fields.progress')}</TableHead>
                <TableHead>{t('fields.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((j) => {
                const late = j.status === 'IN_PROGRESS' && j.targetDate && new Date(j.targetDate) < new Date();
                return (
                  <TableRow key={j.id} className="cursor-pointer" onClick={() => router.push(`/hr/journeys/${j.id}`)}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{j.reference}</TableCell>
                    <TableCell>
                      <p className="font-medium">{j.employee.firstName} {j.employee.lastName}</p>
                      <p className="text-xs text-muted-foreground">{j.employee.jobTitle ?? '—'}</p>
                    </TableCell>
                    <TableCell className="text-sm">{fmt(j.startDate)}</TableCell>
                    <TableCell className={cn('text-sm', late && 'font-medium text-destructive')}>{fmt(j.targetDate)}</TableCell>
                    <TableCell className="text-sm">{nameOf(j.ownerId)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={j.progress.pct} className="h-1.5" />
                        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{j.progress.done}/{j.progress.total}</span>
                      </div>
                      {j.progress.overdue > 0 && <p className="mt-1 text-xs text-destructive">{t('overdueSteps', { count: j.progress.overdue })}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn('text-[11px]', JOURNEY_STATUS_TONE[j.status])}>{t(`statuses.${j.status}`)}</Badge>
                      {j.trialDecision && <p className="mt-1 text-xs text-muted-foreground">{t(`decisions.${j.trialDecision}`)}</p>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <JourneyCreateDialog open={createOpen} onOpenChange={setCreateOpen} kind={kind} />
    </div>
  );
}
