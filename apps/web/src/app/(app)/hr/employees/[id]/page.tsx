'use client';

import { RecordNotFound } from '@/components/layout/no-access';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GraduationCap, LogIn, LogOut, Pencil, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AttachmentsPanel } from '@/components/attachments/attachments-panel';
import { ShareButton } from '@/components/departments/share-button';
import { HistoryPanel } from '@/components/history/history-panel';
import { EmployeeFormDialog } from '@/components/hr/employee-form-dialog';
import { JourneyCreateDialog } from '@/components/hr/journey-create-dialog';
import { Progress } from '@/components/ui/progress';
import { ProficiencyBadge } from '@/components/hr/proficiency';
import { useDepartments, useEmployees } from '@/components/hr/use-hr';
import { gapTone, JOURNEY_STATUS_TONE, TRAINING_STATUS_TONE, type ContractType, type JourneyKind, type JourneyRow } from '@/components/hr/hr-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface EmployeeDetail {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  contact: string | null;
  email: string | null;
  cin: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  managerId: string | null;
  userId: string | null;
  active: boolean;
  hireDate: string | null;
  contractType: ContractType | null;
  trialEndDate: string | null;
  exitDate: string | null;
  exitReason: string | null;
  jobDescription: {
    id: string;
    reference: string;
    version: string;
    jobTitle: string;
    skillRequirements: { skillId: string; requiredLevel: number; skill: { name: string; type: string } }[];
  } | null;
  evaluations: {
    id: string;
    skillId: string;
    expectedLevel: number | null;
    evaluatedLevel: number;
    gap: number;
    evaluationMethod: string | null;
    requiredAction: string | null;
    skill: { name: string; type: string };
  }[];
  participants: {
    id: string;
    present: boolean;
    training: { id: string; code: string; theme: string; status: string; startDate: string | null };
  }[];
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || '—'}</span>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('hr.employees');
  const te = useTranslations('hr.evaluation');
  const tt = useTranslations('hr.trainings');
  const tj = useTranslations('hr.journeys');
  const locale = useLocale();
  const [journeyKind, setJourneyKind] = useState<JourneyKind | null>(null);
  const th = useTranslations('history');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'competencies');
  const changeTab = (next: string) => {
    setTab(next);
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('tab', next);
    router.replace(`?${qs.toString()}`, { scroll: false });
  };
  const { nameOf } = useDepartments();
  const { nameOf: employeeNameOf } = useEmployees();
  const hasPermission = useHasPermission();
  const canEdit = hasPermission('employees:update');
  const [editOpen, setEditOpen] = useState(false);

  const { data: emp, isLoading } = useQuery({
    queryKey: ['hr', 'employees', 'detail', id],
    queryFn: () => apiGet<EmployeeDetail>(`/hr/employees/${id}`),
  });

  const { data: journeys } = useQuery({
    queryKey: ['hr', 'journeys', 'employee', id],
    queryFn: () => apiGet<{ data: JourneyRow[] }>(`/hr/journeys?employeeId=${id}&pageSize=50`),
  });
  const openKinds = new Set((journeys?.data ?? []).filter((j) => j.status === 'IN_PROGRESS').map((j) => j.kind));
  const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(locale) : null);

  if (isLoading) return <div className="p-4 sm:p-6"><Skeleton className="h-96" /></div>;
  if (!emp) return <RecordNotFound />;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push('/hr/employees')}>
          <ArrowLeft className="size-4" /> {t('title')}
        </Button>
        <div className="flex items-center gap-2">
          <ShareButton entityType="Employee" entityId={emp.id} resource="employees" />
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" /> {t('edit')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{emp.firstName} {emp.lastName}</h1>
        <span className="font-mono text-xs text-muted-foreground">{emp.reference}</span>
        <Badge variant={emp.active ? 'secondary' : 'outline'}>{emp.active ? t('status.active') : t('status.inactive')}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{t('detail.info')}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Fact label={t('fields.jobTitle')} value={emp.jobTitle} />
            <Fact label={t('fields.department')} value={nameOf(emp.departmentId)} />
            <Fact label={t('fields.manager')} value={emp.managerId ? employeeNameOf(emp.managerId) : null} />
            <Fact label={t('fields.contact')} value={emp.contact} />
            <Fact label={t('fields.email')} value={emp.email} />
            <Fact label={t('fields.cin')} value={emp.cin} />
            <Fact label={t('fields.hireDate')} value={fmt(emp.hireDate)} />
            <Fact label={t('fields.contractType')} value={emp.contractType ? t(`contracts.${emp.contractType}`) : null} />
            <Fact label={t('fields.trialEndDate')} value={fmt(emp.trialEndDate)} />
            {emp.exitDate && <Fact label={t('fields.exitDate')} value={fmt(emp.exitDate)} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{t('detail.jobDescription')}</CardTitle></CardHeader>
          <CardContent>
            {emp.jobDescription ? (
              <Link href={`/hr/job-descriptions/${emp.jobDescription.id}`} className="flex items-center gap-2 rounded-md border p-3 hover:bg-accent">
                <ScrollText className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{emp.jobDescription.jobTitle}</p>
                  <p className="text-xs text-muted-foreground">{emp.jobDescription.reference} · v{emp.jobDescription.version}</p>
                </div>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">{t('detail.noJobDescription')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="competencies">{t('detail.competencies')}</TabsTrigger>
          <TabsTrigger value="trainings">{t('detail.trainings')}</TabsTrigger>
          <TabsTrigger value="journeys">{tj('tabs.journeys')}</TabsTrigger>
          <TabsTrigger value="documents">{tt('tabs.documents')}</TabsTrigger>
          <TabsTrigger value="history">{th('title')}</TabsTrigger>
        </TabsList>

        <TabsContent value="competencies">
          {emp.evaluations.length ? (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{te('dialog.skill')}</TableHead>
                    <TableHead className="text-center">{te('expected')}</TableHead>
                    <TableHead className="text-center">{te('evaluated')}</TableHead>
                    <TableHead className="text-center">{te('gap')}</TableHead>
                    <TableHead>{te('method')}</TableHead>
                    <TableHead>{te('action')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emp.evaluations.map((ev) => (
                    <TableRow key={ev.id}>
                      <TableCell className="font-medium">{ev.skill.name}</TableCell>
                      <TableCell className="text-center"><ProficiencyBadge level={ev.expectedLevel} /></TableCell>
                      <TableCell className="text-center"><ProficiencyBadge level={ev.evaluatedLevel} /></TableCell>
                      <TableCell className="text-center">
                        <span className={cn('inline-flex min-w-8 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums', gapTone(ev.gap))}>
                          {ev.gap > 0 ? `+${ev.gap}` : ev.gap}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ev.evaluationMethod ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ev.requiredAction ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t('detail.noCompetencies')}</p>
          )}
        </TabsContent>

        <TabsContent value="trainings">
          {emp.participants.length ? (
            <div className="flex flex-col gap-2">
              {emp.participants.map((p) => (
                <Link key={p.id} href={`/hr/trainings/${p.training.id}`} className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent">
                  <GraduationCap className="size-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{p.training.theme}</p>
                    <p className="text-xs text-muted-foreground">{p.training.code}</p>
                  </div>
                  <Badge className={cn('text-[11px]', TRAINING_STATUS_TONE[p.training.status as keyof typeof TRAINING_STATUS_TONE])} variant="secondary">
                    {tt(`statuses.${p.training.status}`)}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t('detail.noTrainings')}</p>
          )}
        </TabsContent>

        <TabsContent value="journeys">
          <div className="flex flex-col gap-3">
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {!openKinds.has('ONBOARDING') && emp.active && (
                  <Button size="sm" variant="outline" onClick={() => setJourneyKind('ONBOARDING')}>
                    <LogIn className="size-4" /> {tj('newOnboarding')}
                  </Button>
                )}
                {!openKinds.has('OFFBOARDING') && emp.active && (
                  <Button size="sm" variant="outline" onClick={() => setJourneyKind('OFFBOARDING')}>
                    <LogOut className="size-4" /> {tj('newOffboarding')}
                  </Button>
                )}
              </div>
            )}
            {(journeys?.data ?? []).length ? (
              (journeys?.data ?? []).map((j) => (
                <Link key={j.id} href={`/hr/journeys/${j.id}`} className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent">
                  {j.kind === 'ONBOARDING' ? <LogIn className="size-4 text-muted-foreground" /> : <LogOut className="size-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{tj(j.kind === 'ONBOARDING' ? 'onboarding' : 'offboarding')} · <span className="font-mono text-xs text-muted-foreground">{j.reference}</span></p>
                    <div className="mt-1 flex items-center gap-2">
                      <Progress value={j.progress.pct} className="h-1.5 max-w-48" />
                      <span className="text-xs tabular-nums text-muted-foreground">{j.progress.done}/{j.progress.total}</span>
                    </div>
                  </div>
                  <Badge variant="secondary" className={cn('text-[11px]', JOURNEY_STATUS_TONE[j.status])}>{tj(`statuses.${j.status}`)}</Badge>
                </Link>
              ))
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{tj('noJourneys')}</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <AttachmentsPanel entityType="employee" entityId={emp.id} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="history" className="max-w-4xl">
          <HistoryPanel
            entityType="Employee"
            entityId={emp.id}
            fieldLabels={{
              firstName: t('fields.firstName'),
              lastName: t('fields.lastName'),
              contact: t('fields.contact'),
              email: t('fields.email'),
              cin: t('fields.cin'),
              jobTitle: t('fields.jobTitle'),
              departmentId: t('fields.department'),
              userId: t('fields.user'),
              active: t('fields.active'),
              managerId: t('fields.manager'),
              hireDate: t('fields.hireDate'),
              contractType: t('fields.contractType'),
              trialEndDate: t('fields.trialEndDate'),
              exitDate: t('fields.exitDate'),
              exitReason: t('fields.exitReason'),
            }}
            formatField={(field, value) => {
              if (typeof value !== 'string') return undefined;
              if (field === 'departmentId') return nameOf(value);
              if (field === 'managerId') return employeeNameOf(value);
              if (field === 'contractType') return t(`contracts.${value}`);
              return undefined;
            }}
          />
        </TabsContent>
      </Tabs>

      <EmployeeFormDialog open={editOpen} onOpenChange={setEditOpen} employee={emp} />
      {journeyKind && (
        <JourneyCreateDialog open onOpenChange={(v) => !v && setJourneyKind(null)} kind={journeyKind} employeeId={emp.id} />
      )}
    </div>
  );
}
