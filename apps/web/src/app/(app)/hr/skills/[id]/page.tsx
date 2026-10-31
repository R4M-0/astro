'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AttachmentsPanel } from '@/components/attachments/attachments-panel';
import { HistoryPanel } from '@/components/history/history-panel';
import { JD_STATUS_TONE, SKILL_TYPE_TONE, gapTone, type JdStatus, type SkillType } from '@/components/hr/hr-meta';
import { ProficiencyBadge } from '@/components/hr/proficiency';
import { SkillDialog } from '@/components/hr/skill-dialog';
import { DetailPage } from '@/components/layout/detail-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, apiDelete, apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface SkillDetail {
  id: string;
  name: string;
  description: string | null;
  type: SkillType;
  createdAt: string;
  updatedAt: string;
  _count: { requirements: number; evaluations: number };
  /** null when the caller may not read job descriptions */
  jobDescriptions:
    | { id: string; reference: string; version: string; jobTitle: string; status: JdStatus; requiredLevel: number | null }[]
    | null;
  /** null when the caller may not read employees + competency evaluations */
  evaluations:
    | {
        id: string;
        expectedLevel: number | null;
        evaluatedLevel: number;
        gap: number;
        evaluationMethod: string | null;
        requiredAction: string | null;
        evaluatedAt: string;
        employee: { id: string; reference: string; firstName: string; lastName: string; jobTitle: string | null; active: boolean };
      }[]
    | null;
}

const TABS = ['overview', 'jobs', 'evaluations', 'actions', 'documents', 'history'] as const;

export default function SkillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const t = useTranslations('hr.skills');
  const tj = useTranslations('hr.jobDescriptions');
  const tc = useTranslations('common');
  const th = useTranslations('history');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canEdit = hasPermission('skills:update');
  const canDelete = hasPermission('skills:delete');
  const canReadEmployees = hasPermission('employees:read');
  const [tab, setTab] = useState<string>(TABS.includes(initialTab as never) ? initialTab! : 'overview');
  const [editOpen, setEditOpen] = useState(false);

  const { data: skill, isLoading } = useQuery({
    queryKey: ['hr', 'skills', 'detail', id],
    queryFn: () => apiGet<SkillDetail>(`/hr/skills/${id}`),
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/hr/skills/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'skills'] });
      toast.success(t('deletedToast'));
      router.push('/hr/skills');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  const fact = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || <span className="text-muted-foreground/60">—</span>}</dd>
    </div>
  );
  const restricted = (
    <Card>
      <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Lock className="size-4" /> {t('detail.restricted')}
      </CardContent>
    </Card>
  );
  const empty = (text: string) => <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;

  const evals = skill?.evaluations ?? [];
  const deficits = evals.filter((e) => e.gap < 0).length;
  const average = evals.length
    ? (evals.reduce((sum, e) => sum + e.evaluatedLevel, 0) / evals.length).toFixed(1)
    : null;

  return (
    <DetailPage
      backHref="/hr/skills"
      backLabel={t('title')}
      loading={isLoading || !skill}
      title={skill?.name}
      subtitle={skill?.description ?? undefined}
      badges={
        skill && (
          <Badge variant="secondary" className={cn('text-[11px]', SKILL_TYPE_TONE[skill.type])}>
            {t(`types.${skill.type}`)}
          </Badge>
        )
      }
      actions={
        skill && (
          <>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="size-3.5" /> {tc('edit')}
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => confirm(t('deleteConfirm', { name: skill.name })) && remove.mutate()}
              >
                <Trash2 className="size-3.5" /> {tc('delete')}
              </Button>
            )}
          </>
        )
      }
    >
      {skill && (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            router.replace(`/hr/skills/${id}?tab=${v}`, { scroll: false });
          }}
        >
          <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
            <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
            <TabsTrigger value="jobs">
              {t('detail.tabs.jobs')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{skill._count.requirements}</Badge>
            </TabsTrigger>
            <TabsTrigger value="evaluations">
              {t('detail.tabs.evaluations')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{skill._count.evaluations}</Badge>
            </TabsTrigger>
            <TabsTrigger value="documents">{t('detail.tabs.documents')}</TabsTrigger>
            <TabsTrigger value="history">{th('title')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: t('detail.stats.jobs'), value: skill._count.requirements },
                { label: t('detail.stats.evaluated'), value: skill._count.evaluations },
                { label: t('detail.stats.deficits'), value: skill.evaluations ? deficits : '—' },
                { label: t('detail.stats.average'), value: skill.evaluations ? (average ?? '—') : '—' },
              ].map((s) => (
                <Card key={s.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardContent className="p-5">
                <dl className="grid gap-4 sm:grid-cols-2">
                  {fact(t('fields.name'), skill.name)}
                  {fact(t('fields.type'), t(`types.${skill.type}`))}
                  <div className="sm:col-span-2">
                    {fact(t('fields.description'), skill.description && <span className="whitespace-pre-wrap">{skill.description}</span>)}
                  </div>
                </dl>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="jobs" className="mt-4">
            {skill.jobDescriptions === null ? (
              restricted
            ) : !skill.jobDescriptions.length ? (
              empty(t('detail.noJobs'))
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('detail.cols.reference')}</TableHead>
                      <TableHead>{t('detail.cols.jobTitle')}</TableHead>
                      <TableHead>{tc('status')}</TableHead>
                      <TableHead className="text-center">{t('detail.cols.requiredLevel')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skill.jobDescriptions.map((jd) => (
                      <TableRow key={jd.id} className="cursor-pointer" onClick={() => router.push(`/hr/job-descriptions/${jd.id}`)}>
                        <TableCell className="font-mono text-xs">
                          {jd.reference} <span className="text-muted-foreground">v{jd.version}</span>
                        </TableCell>
                        <TableCell className="font-medium">{jd.jobTitle}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn('text-[10px]', JD_STATUS_TONE[jd.status])}>
                            {tj(`statuses.${jd.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <ProficiencyBadge level={jd.requiredLevel} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="evaluations" className="mt-4">
            {skill.evaluations === null ? (
              restricted
            ) : !skill.evaluations.length ? (
              empty(t('detail.noEvaluations'))
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('detail.cols.employee')}</TableHead>
                      <TableHead className="text-center">{t('detail.cols.expected')}</TableHead>
                      <TableHead className="text-center">{t('detail.cols.evaluated')}</TableHead>
                      <TableHead className="text-center">{t('detail.cols.gap')}</TableHead>
                      <TableHead>{t('detail.cols.method')}</TableHead>
                      <TableHead>{t('detail.cols.requiredAction')}</TableHead>
                      <TableHead>{t('detail.cols.date')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skill.evaluations.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          {canReadEmployees ? (
                            <Link href={`/hr/employees/${e.employee.id}`} className={cn('font-medium hover:underline', !e.employee.active && 'text-muted-foreground')}>
                              {e.employee.firstName} {e.employee.lastName}
                            </Link>
                          ) : (
                            <span className={cn('font-medium', !e.employee.active && 'text-muted-foreground')}>
                              {e.employee.firstName} {e.employee.lastName}
                            </span>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {e.employee.reference}
                            {e.employee.jobTitle ? ` · ${e.employee.jobTitle}` : ''}
                          </p>
                        </TableCell>
                        <TableCell className="text-center"><ProficiencyBadge level={e.expectedLevel} /></TableCell>
                        <TableCell className="text-center"><ProficiencyBadge level={e.evaluatedLevel} /></TableCell>
                        <TableCell className="text-center">
                          <span className={cn('inline-flex min-w-8 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums', gapTone(e.gap))}>
                            {e.gap > 0 ? `+${e.gap}` : e.gap}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{e.evaluationMethod ?? '—'}</TableCell>
                        <TableCell className="max-w-xs text-sm">{e.requiredAction ?? '—'}</TableCell>
                        <TableCell className="text-sm tabular-nums">{new Date(e.evaluatedAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <AttachmentsPanel entityType="skill" entityId={skill.id} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <HistoryPanel
              entityType="Skill"
              entityId={skill.id}
              fieldLabels={{ name: t('fields.name'), description: t('fields.description'), type: t('fields.type') }}
              formatField={(field, value) =>
                field === 'type' && typeof value === 'string' ? t(`types.${value as SkillType}`) : undefined
              }
            />
          </TabsContent>
        </Tabs>
      )}

      <SkillDialog open={editOpen} onOpenChange={setEditOpen} skill={skill} />
    </DetailPage>
  );
}
