'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, ShieldAlert, Sparkles, Trash2, Upload } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { DetailPage } from '@/components/layout/detail-page';
import {
  CRITERION_KINDS,
  CV_TONE,
  DECISION_TONE,
  RANKING_TONE,
  type CandidateRow,
  type Criterion,
  type CriterionKind,
  type RankingStatus,
} from '@/components/recruiting/recruiting-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface Opening {
  id: string;
  title: string;
  description: string;
  criteria: Criterion[];
  retrievalSize: number;
  shortlistSize: number;
  status: 'OPEN' | 'CLOSED';
  rankingStatus: RankingStatus;
  rankingError: string | null;
  rankedAt: string | null;
  candidates: CandidateRow[];
}

type Draft = Pick<Opening, 'title' | 'description' | 'criteria' | 'retrievalSize' | 'shortlistSize' | 'status'>;

const TABS = ['candidates', 'criteria'] as const;

export default function OpeningPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('recruiting');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canUpload = hasPermission('recruiting:create');
  const canEdit = hasPermission('recruiting:update');
  const canDelete = hasPermission('recruiting:delete');
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<string>(TABS.includes(initialTab as never) ? initialTab! : 'candidates');
  // unsaved edits; falls back to the saved opening
  const [edits, setDraft] = useState<Draft | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: opening, isLoading } = useQuery({
    queryKey: ['recruiting', 'opening', id],
    queryFn: () => apiGet<Opening>(`/recruiting/openings/${id}`),
    // the pipeline runs in the worker: poll while something is in flight
    refetchInterval: (q) => {
      const o = q.state.data;
      const busy = o && (o.rankingStatus === 'RUNNING' || o.candidates.some((c) => c.status === 'RECEIVED' || c.status === 'PROCESSING'));
      return busy ? 3000 : false;
    },
  });

  const draft: Draft | undefined =
    edits ??
    (opening && {
      title: opening.title,
      description: opening.description,
      criteria: opening.criteria,
      retrievalSize: opening.retrievalSize,
      shortlistSize: opening.shortlistSize,
      status: opening.status,
    });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recruiting'] });
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append('files', f));
      return apiUpload<CandidateRow[]>(`/recruiting/openings/${id}/candidates`, form);
    },
    onSuccess: (rows) => {
      refresh();
      toast.success(t('uploaded', { count: rows.length }));
    },
    onError,
  });

  const rank = useMutation({
    mutationFn: () => apiPost(`/recruiting/openings/${id}/rank`),
    onSuccess: () => {
      refresh();
      toast.success(t('rankQueued'));
    },
    onError,
  });

  const save = useMutation({
    mutationFn: async (rerun: boolean) => {
      await apiPatch(`/recruiting/openings/${id}`, draft);
      if (rerun) await apiPost(`/recruiting/openings/${id}/rank`);
      return rerun;
    },
    onSuccess: (rerun) => {
      refresh();
      toast.success(rerun ? t('rankQueued') : t('saved'));
    },
    onError,
  });

  const suggest = useMutation({
    mutationFn: () => apiPost<Criterion[]>('/recruiting/openings/suggest-criteria', { title: draft!.title, description: draft!.description }),
    onSuccess: (criteria) => {
      setDraft({ ...draft!, criteria });
      toast.success(t('criteria.suggested'));
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/recruiting/openings/${id}`),
    onSuccess: () => {
      refresh();
      toast.success(t('deleted'));
      router.push('/recruiting');
    },
    onError,
  });

  const setCriterion = (i: number, patch: Partial<Criterion>) =>
    setDraft({ ...draft!, criteria: draft!.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const hasReady = !!opening?.candidates.some((c) => c.status === 'READY');
  const draftValid = !!draft && !!draft.title.trim() && !!draft.description.trim() && draft.criteria.every((c) => c.label.trim());

  return (
    <DetailPage
      backHref="/recruiting"
      backLabel={t('title')}
      loading={isLoading || !opening}
      title={opening?.title}
      subtitle={
        opening?.rankedAt
          ? t('rankedAt', { date: new Date(opening.rankedAt).toLocaleString() })
          : undefined
      }
      badges={
        opening && (
          <>
            <Badge variant="secondary" className="text-[11px]">{t(`statuses.${opening.status}`)}</Badge>
            <Badge variant="secondary" className={cn('text-[11px]', RANKING_TONE[opening.rankingStatus])}>
              {t(`rankingStatuses.${opening.rankingStatus}`)}
            </Badge>
          </>
        )
      }
      actions={
        opening && (
          <>
            {canUpload && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => {
                    if (e.target.files?.length) upload.mutate(e.target.files);
                    e.target.value = '';
                  }}
                />
                <Button size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()} title={t('uploadHint')}>
                  <Upload className="size-3.5" /> {t('upload')}
                </Button>
              </>
            )}
            {canEdit && hasReady && (
              <Button size="sm" variant="outline" disabled={rank.isPending || opening.rankingStatus === 'RUNNING'} onClick={() => rank.mutate()}>
                <RefreshCw className={cn('size-3.5', opening.rankingStatus === 'RUNNING' && 'animate-spin')} /> {t('rerun')}
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => confirm(t('deleteConfirm', { name: opening.title })) && remove.mutate()}
              >
                <Trash2 className="size-3.5" /> {tc('delete')}
              </Button>
            )}
          </>
        )
      }
    >
      {opening && (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            router.replace(`/recruiting/${id}?tab=${v}`, { scroll: false });
          }}
        >
          <TabsList>
            <TabsTrigger value="candidates">
              {t('tabs.candidates')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{opening.candidates.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="criteria">
              {t('tabs.criteria')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{opening.criteria.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="candidates" className="mt-4 flex flex-col gap-3">
            {opening.rankingStatus === 'FAILED' && opening.rankingError && (
              <p className="rounded-md bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">{opening.rankingError}</p>
            )}
            {!opening.candidates.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('noCandidates')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14 text-center">{t('cols.rank')}</TableHead>
                      <TableHead>{t('cols.candidate')}</TableHead>
                      <TableHead className="text-center">{t('cols.score')}</TableHead>
                      <TableHead className="text-center">{t('cols.retrieval')}</TableHead>
                      <TableHead>{t('cols.pipeline')}</TableHead>
                      <TableHead>{t('cols.decision')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opening.candidates.map((c) => (
                      <TableRow
                        key={c.id}
                        className={cn('cursor-pointer', c.shortlisted && 'bg-emerald-500/5')}
                        onClick={() => router.push(`/recruiting/candidates/${c.id}`)}
                      >
                        <TableCell className="text-center font-semibold tabular-nums">{c.rank ?? '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 font-medium">
                            {c.fullName ?? c.fileName}
                            {c.guardFlags.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <ShieldAlert className="size-3.5 text-amber-500" />
                                </TooltipTrigger>
                                <TooltipContent>{t('flagged')}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {c.filterReasons?.length
                              ? t('filtered', { reasons: c.filterReasons.join(', ') })
                              : c.fullName
                                ? c.fileName
                                : ''}
                          </p>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{c.score ?? '—'}</TableCell>
                        <TableCell className="text-center text-xs tabular-nums text-muted-foreground">
                          {c.retrievalScore != null ? c.retrievalScore.toFixed(3) : c.status === 'READY' && opening.rankedAt ? t('notRetrieved') : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn('text-[11px]', CV_TONE[c.status])} title={c.error ?? undefined}>
                            {t(`cvStatuses.${c.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn('text-[11px]', DECISION_TONE[c.decision])}>
                            {t(`decisions.${c.decision}`)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="criteria" className="mt-4">
            {draft && (
              <Card>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('fields.title')} required className="sm:col-span-2">
                      <Input value={draft.title} disabled={!canEdit} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                    </Field>
                    <Field label={t('fields.description')} required className="sm:col-span-2">
                      <Textarea rows={8} value={draft.description} disabled={!canEdit} maxLength={20000} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                    </Field>
                    <Field label={t('fields.retrievalSize')}>
                      <Input type="number" min={1} max={500} value={draft.retrievalSize} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, retrievalSize: Number(e.target.value) || 1 })} />
                    </Field>
                    <Field label={t('fields.shortlistSize')}>
                      <Input type="number" min={1} max={100} value={draft.shortlistSize} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, shortlistSize: Number(e.target.value) || 1 })} />
                    </Field>
                    <Field label={t('cols.status')}>
                      <Select value={draft.status} disabled={!canEdit} onValueChange={(v) => setDraft({ ...draft, status: v as Draft['status'] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['OPEN', 'CLOSED'] as const).map((s) => <SelectItem key={s} value={s}>{t(`statuses.${s}`)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <p className="max-w-2xl text-sm text-muted-foreground">{t('criteria.desc')}</p>
                    {canEdit && (
                      <Button size="sm" variant="outline" disabled={suggest.isPending || !draft.description.trim()} onClick={() => suggest.mutate()}>
                        <Sparkles className="size-3.5" /> {t('criteria.suggest')}
                      </Button>
                    )}
                  </div>

                  {!draft.criteria.length ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">{t('criteria.empty')}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('criteria.label')}</TableHead>
                            <TableHead className="w-44">{t('criteria.kind')}</TableHead>
                            <TableHead className="w-40">{t('criteria.value')}</TableHead>
                            <TableHead className="w-24">{t('criteria.weight')}</TableHead>
                            <TableHead className="w-24 text-center">{t('criteria.mustHave')}</TableHead>
                            {canEdit && <TableHead className="w-10" />}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draft.criteria.map((c, i) => (
                            <TableRow key={c.id}>
                              <TableCell>
                                <Input value={c.label} disabled={!canEdit} maxLength={200} onChange={(e) => setCriterion(i, { label: e.target.value })} />
                              </TableCell>
                              <TableCell>
                                <Select value={c.kind} disabled={!canEdit} onValueChange={(v) => setCriterion(i, { kind: v as CriterionKind, value: null })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {CRITERION_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`criteria.kinds.${k}`)}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                {c.kind !== 'OTHER' && (
                                  <Input
                                    type={c.kind === 'YEARS' ? 'number' : 'text'}
                                    min={0}
                                    value={c.value ?? ''}
                                    disabled={!canEdit}
                                    maxLength={200}
                                    onChange={(e) => setCriterion(i, { value: c.kind === 'YEARS' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })}
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                <Input type="number" min={1} max={5} value={c.weight} disabled={!canEdit} onChange={(e) => setCriterion(i, { weight: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} />
                              </TableCell>
                              <TableCell className="text-center">
                                <Checkbox checked={c.mustHave} disabled={!canEdit} onCheckedChange={(v) => setCriterion(i, { mustHave: v === true })} />
                              </TableCell>
                              {canEdit && (
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 text-destructive"
                                    onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) })}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {canEdit && (
                    <div className="flex flex-wrap justify-between gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            criteria: [...draft.criteria, { id: crypto.randomUUID(), label: '', weight: 3, mustHave: false, kind: 'OTHER', value: null }],
                          })
                        }
                      >
                        <Plus className="size-3.5" /> {t('criteria.add')}
                      </Button>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={!draftValid || save.isPending} onClick={() => save.mutate(false)}>
                          {t('criteria.save')}
                        </Button>
                        {hasReady && (
                          <Button size="sm" disabled={!draftValid || save.isPending || opening.rankingStatus === 'RUNNING'} onClick={() => save.mutate(true)}>
                            <RefreshCw className="size-3.5" /> {t('criteria.saveAndRerun')}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </DetailPage>
  );
}
