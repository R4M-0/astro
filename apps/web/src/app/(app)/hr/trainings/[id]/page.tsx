'use client';

import { RecordNotFound } from '@/components/layout/no-access';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, ExternalLink, Pencil, X } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { AttachmentsPanel } from '@/components/attachments/attachments-panel';
import { ShareButton } from '@/components/departments/share-button';
import { HistoryPanel } from '@/components/history/history-panel';
import { useDepartments } from '@/components/hr/use-hr';
import { TrainingFormDialog } from '@/components/hr/training-form-dialog';
import { TRAINING_STATUS_TONE, type HrTrainingType, type TrainingStatus } from '@/components/hr/hr-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface TrainingDetail {
  id: string;
  code: string;
  theme: string;
  type: HrTrainingType;
  status: TrainingStatus;
  startDate: string | null;
  endDate: string | null;
  observation: string | null;
  departmentId: string | null;
  // share tokens are only sent to hr-trainings:update holders
  hotToken: string | null;
  coldToken: string | null;
  participants: {
    id: string;
    present: boolean;
    employee: { id: string; firstName: string; lastName: string; reference: string; jobTitle: string | null };
  }[];
  satisfaction: {
    hot: { count: number; avgScore: number | null; rate: number | null };
    cold: { count: number; avgScore: number | null; rate: number | null };
  };
}

function ShareCard({
  variant,
  token,
  summary,
}: {
  variant: 'hot' | 'cold';
  token: string | null;
  summary: { count: number; avgScore: number | null; rate: number | null };
}) {
  const t = useTranslations('hr.trainings.feedback');
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/f/${token}` : `/f/${token}`;
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success(t('copied'));
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className={cn('inline-block size-2 rounded-full', variant === 'hot' ? 'bg-amber-500' : 'bg-sky-500')} />
          {t(variant)}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t(`${variant}Desc`)}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {token ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs">{url}</code>
          <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={copy}>
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          </Button>
          <Button variant="outline" size="icon" className="size-8 shrink-0" asChild>
            <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /></a>
          </Button>
        </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('linkRestricted')}</p>
        )}
        {summary.count > 0 ? (
          <div className="flex items-center gap-4 text-sm">
            <div><span className="text-muted-foreground">{t('responses', { n: summary.count })}</span></div>
            <div><span className="text-muted-foreground">{t('satisfactionRate')}: </span><span className="font-semibold">{summary.rate}%</span></div>
            <div><span className="text-muted-foreground">{t('avgScore')}: </span><span className="font-semibold tabular-nums">{summary.avgScore}/5</span></div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('noResponses')}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function TrainingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('hr.trainings');
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const dl = locale === 'fr' ? frLocale : enUS;
  const hasPermission = useHasPermission();
  const canEdit = hasPermission('hr-trainings:update');
  const [editOpen, setEditOpen] = useState(false);
  const td = useTranslations('departments');
  const th = useTranslations('history');
  const { nameOf } = useDepartments();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'overview');
  const changeTab = (next: string) => {
    setTab(next);
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('tab', next);
    router.replace(`?${qs.toString()}`, { scroll: false });
  };

  const { data: tr, isLoading } = useQuery({
    queryKey: ['hr', 'trainings', 'detail', id],
    queryFn: () => apiGet<TrainingDetail>(`/hr/trainings/${id}`),
  });

  const presence = useMutation({
    mutationFn: (v: { pid: string; present: boolean }) => apiPost(`/hr/trainings/${id}/participants/${v.pid}/presence`, { present: v.present }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'trainings', 'detail', id] }),
  });

  if (isLoading) return <div className="p-4 sm:p-6"><Skeleton className="h-96" /></div>;
  if (!tr) return <RecordNotFound />;

  const fmt = (d: string | null) => (d ? format(new Date(d), 'dd MMM yyyy', { locale: dl }) : '—');

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push('/hr/trainings')}>
          <ArrowLeft className="size-4" /> {t('backToList')}
        </Button>
        <div className="flex items-center gap-2">
          <ShareButton entityType="HrTraining" entityId={id} resource="hr-trainings" />
          {canEdit && <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="size-4" /> {t('edit')}</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{tr.theme}</h1>
        <span className="font-mono text-xs text-muted-foreground">{tr.code}</span>
        <Badge variant="secondary" className={cn('text-[11px]', TRAINING_STATUS_TONE[tr.status as keyof typeof TRAINING_STATUS_TONE])}>{t(`statuses.${tr.status}`)}</Badge>
        <Badge variant="outline" className="text-[11px]">{t(`types.${tr.type}`)}</Badge>
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="attendance">{t('tabs.attendance')}</TabsTrigger>
          <TabsTrigger value="documents">{t('tabs.documents')}</TabsTrigger>
          <TabsTrigger value="feedback">{t('tabs.feedback')}</TabsTrigger>
          <TabsTrigger value="history">{th('title')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">{t('fields.startDate')}</p><p className="text-sm font-medium">{fmt(tr.startDate)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('fields.endDate')}</p><p className="text-sm font-medium">{fmt(tr.endDate)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('attendance.title')}</p><p className="text-sm font-medium">{t('attendance.count', { n: tr.participants.length })}</p></div>
              <div><p className="text-xs text-muted-foreground">{td('label')}</p><p className="text-sm font-medium">{nameOf(tr.departmentId)}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">{t('observationTitle')}</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{tr.observation || t('noObservation')}</p></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t('attendance.count', { n: tr.participants.length })}</p>
            {canEdit && <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="size-4" /> {t('attendance.manage')}</Button>}
          </div>
          {tr.participants.length ? (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('cols.code')}</TableHead>
                    <TableHead>{t('attendance.title')}</TableHead>
                    <TableHead className="text-center">{t('attendance.present')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tr.participants.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.employee.reference}</TableCell>
                      <TableCell className="font-medium">
                        {p.employee.firstName} {p.employee.lastName}
                        {p.employee.jobTitle && <div className="text-xs font-normal text-muted-foreground">{p.employee.jobTitle}</div>}
                      </TableCell>
                      <TableCell className="text-center">
                        {canEdit ? (
                          <Button
                            variant={p.present ? 'secondary' : 'outline'}
                            size="sm"
                            disabled={presence.isPending}
                            onClick={() => presence.mutate({ pid: p.id, present: !p.present })}
                            className={cn('gap-1', p.present && 'text-emerald-600 dark:text-emerald-400')}
                          >
                            {p.present ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                            {p.present ? t('attendance.present') : t('attendance.absent')}
                          </Button>
                        ) : (
                          <Badge
                            variant={p.present ? 'secondary' : 'outline'}
                            className={cn('gap-1', p.present && 'text-emerald-600 dark:text-emerald-400')}
                          >
                            {p.present ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                            {p.present ? t('attendance.present') : t('attendance.absent')}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t('attendance.empty')}</p>
          )}
        </TabsContent>

        <TabsContent value="documents">
          <AttachmentsPanel entityType="hr-training" entityId={tr.id} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="feedback" className="flex flex-col gap-4">
          <ShareCard variant="hot" token={tr.hotToken} summary={tr.satisfaction.hot} />
          <ShareCard variant="cold" token={tr.coldToken} summary={tr.satisfaction.cold} />
        </TabsContent>

        <TabsContent value="history" className="max-w-4xl">
          <HistoryPanel
            entityType="HrTraining"
            entityId={tr.id}
            hiddenFields={['hotToken', 'coldToken']}
            fieldLabels={{
              code: t('fields.code'),
              theme: t('fields.theme'),
              type: t('fields.type'),
              startDate: t('fields.startDate'),
              endDate: t('fields.endDate'),
              status: t('fields.status'),
              observation: t('fields.observation'),
              departmentId: td('label'),
            }}
            formatField={(field, value) => {
              if (typeof value !== 'string') return undefined;
              if (field === 'status') return t(`statuses.${value}` as Parameters<typeof t>[0]);
              if (field === 'type') return t(`types.${value}` as Parameters<typeof t>[0]);
              if (field === 'departmentId') return nameOf(value);
              return undefined;
            }}
          />
        </TabsContent>
      </Tabs>

      <TrainingFormDialog open={editOpen} onOpenChange={setEditOpen} training={tr} />
    </div>
  );
}
