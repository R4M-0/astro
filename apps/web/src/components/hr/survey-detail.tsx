'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Copy, ExternalLink, EyeOff, Link2, Lock, RotateCcw, Send, Trash2, Undo2, Users } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { HistoryPanel } from '@/components/history/history-panel';
import { DetailPage } from '@/components/layout/detail-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import { SurveyAnswer } from './survey-answer';
import { SurveyQuestionBuilder, SurveySettingsCard } from './survey-builder';
import { SURVEY_STATUS_TONE, type SurveyDetail as SurveyRecord } from './survey-meta';
import { SurveyRenderer } from './survey-renderer';
import { SurveyResults } from './survey-results';
import { useSurveyScope } from './survey-scope';

const TABS = ['questions', 'preview', 'share', 'answer', 'responses', 'history'] as const;

/** Copy text with the async clipboard API, falling back to a hidden textarea + execCommand. */
async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function SurveyDetail({ id }: { id: string }) {
  const t = useTranslations('hrSurveys');
  const tc = useTranslations('common');
  const th = useTranslations('history');
  const cfg = useSurveyScope();
  const backLabel = t('title');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canEdit = hasPermission(cfg.perms.update);
  const canDelete = hasPermission(cfg.perms.delete);
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<string | null>(TABS.includes(initialTab as (typeof TABS)[number]) ? initialTab! : null);

  const changeTab = (v: string) => {
    setTab(v);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', v);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // members without survey read rights (employees) only get the answering form, served by /:id/form
  const answerOnly = !hasPermission(cfg.perms.read);
  const { data: survey, isLoading, error } = useQuery({
    queryKey: [...cfg.queryKey, id],
    queryFn: () => apiGet<SurveyRecord>(`${cfg.api}/${id}`),
    enabled: !answerOnly,
  });
  // no ?tab=: managers land on the questions, other members on the answer form once published
  const activeTab = tab ?? (!canEdit && survey && survey.status !== 'DRAFT' ? 'answer' : 'questions');

  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const lifecycle = useMutation({
    mutationFn: (action: 'publish' | 'close' | 'reopen' | 'unpublish') =>
      apiPost<SurveyRecord>(`${cfg.api}/${id}/${action}`),
    onSuccess: (data, action) => {
      queryClient.setQueryData([...cfg.queryKey, id], data);
      queryClient.invalidateQueries({ queryKey: [...cfg.queryKey] });
      toast.success(t(`lifecycle.${action}Toast`));
      if (action === 'publish') changeTab('share');
    },
    onError: onErr,
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`${cfg.api}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...cfg.queryKey] });
      toast.success(tc('deletedToast'));
      router.push(cfg.listHref);
    },
    onError: onErr,
  });

  if (answerOnly) {
    return (
      <DetailPage backHref="/hr/me" backLabel={t('mine.back')}>
        <SurveyAnswer surveyId={id} />
      </DetailPage>
    );
  }

  if (error) {
    return (
      <DetailPage backHref={cfg.listHref} backLabel={backLabel}>
        <p className="text-sm text-muted-foreground">{error instanceof ApiError ? error.message : tc('error')}</p>
      </DetailPage>
    );
  }

  const busy = lifecycle.isPending;
  const s = survey;

  return (
    <DetailPage
      backHref={cfg.listHref}
      backLabel={backLabel}
      loading={isLoading || !s}
      reference={s?.reference}
      title={s?.title}
      subtitle={s?.description ?? undefined}
      badges={
        s && (
          <>
            <Badge variant="secondary" className={cn('text-[11px]', SURVEY_STATUS_TONE[s.status])}>
              {s.expired ? t('expired') : t(`statuses.${s.status}`)}
            </Badge>
            <Badge variant="outline" className="gap-1 text-[11px]">
              {s.anonymous ? <EyeOff className="size-3" /> : <Users className="size-3" />}
              {s.anonymous ? t('anonymousShort') : t('identifiedShort')}
            </Badge>
          </>
        )
      }
      actions={
        s && (
          <>
            {canEdit && s.status === 'DRAFT' && (
              <Button
                size="sm"
                disabled={busy || !s.questions.length}
                title={!s.questions.length ? t('lifecycle.needQuestion') : undefined}
                onClick={() => {
                  const unsaved = document.querySelector('[data-survey-unsaved]');
                  if (unsaved && !window.confirm(t('lifecycle.unsavedConfirm'))) return;
                  lifecycle.mutate('publish');
                }}
              >
                <Send className="size-4" /> {t('lifecycle.publish')}
              </Button>
            )}
            {canEdit && s.status === 'PUBLISHED' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => window.confirm(t('lifecycle.closeConfirm')) && lifecycle.mutate('close')}>
                <Lock className="size-4" /> {t('lifecycle.close')}
              </Button>
            )}
            {canEdit && s.status === 'CLOSED' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => lifecycle.mutate('reopen')}>
                <RotateCcw className="size-4" /> {t('lifecycle.reopen')}
              </Button>
            )}
            {canEdit && s.status !== 'DRAFT' && s.responseCount === 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => window.confirm(t('lifecycle.unpublishConfirm')) && lifecycle.mutate('unpublish')}>
                <Undo2 className="size-4" /> {t('lifecycle.unpublish')}
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => window.confirm(tc('deleteConfirm', { name: s.title })) && remove.mutate()}
              >
                <Trash2 className="size-4" /> {tc('delete')}
              </Button>
            )}
          </>
        )
      }
    >
      {s && (
        <Tabs value={activeTab} onValueChange={changeTab}>
          <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
            <TabsTrigger value="questions">
              {t('tabs.questions')}
              <Count n={s.questions.length} />
            </TabsTrigger>
            <TabsTrigger value="preview">{t('tabs.preview')}</TabsTrigger>
            {canEdit && <TabsTrigger value="share">{t('tabs.share')}</TabsTrigger>}
            {s.status !== 'DRAFT' && <TabsTrigger value="answer">{t('tabs.answer')}</TabsTrigger>}
            <TabsTrigger value="responses">
              {t('tabs.responses')}
              <Count n={s.responseCount} />
            </TabsTrigger>
            <TabsTrigger value="history">{th('title')}</TabsTrigger>
          </TabsList>

          <TabsContent value="questions" className="mt-4">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <SurveyQuestionBuilder survey={s} canEdit={canEdit} />
              <div className="lg:sticky lg:top-4">
                <SurveySettingsCard survey={s} canEdit={canEdit} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <div className="mx-auto max-w-2xl">
              <div className="mb-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('preview.banner')}</div>
              {s.questions.length ? (
                <SurveyRenderer
                  key={s.updatedAt}
                  survey={s}
                  preview
                  onSubmit={() => toast.info(t('preview.submitted'))}
                />
              ) : (
                <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('builder.empty')}</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="share" className="mt-4">
            <ShareCard survey={s} />
          </TabsContent>

          {s.status !== 'DRAFT' && (
            <TabsContent value="answer" className="mt-4">
              <SurveyAnswer surveyId={s.id} />
            </TabsContent>
          )}

          <TabsContent value="responses" className="mt-4">
            <SurveyResults survey={s} canDelete={canDelete} />
          </TabsContent>


          <TabsContent value="history" className="mt-4 max-w-4xl">
            <HistoryPanel
              entityType={cfg.entityType}
              entityId={s.id}
              hiddenFields={['publicToken']}
              fieldLabels={{
                title: t('fields.title'),
                description: t('fields.description'),
                anonymous: t('fields.anonymous'),
                allowMultipleResponses: t('fields.allowMultiple'),
                closesAt: t('fields.closesAt'),
                status: t('cols.status'),
                reference: t('cols.reference'),
              }}
              formatField={(field, value) =>
                field === 'status' && typeof value === 'string'
                  ? t(`statuses.${value}` as Parameters<typeof t>[0])
                  : undefined
              }
            />
          </TabsContent>
        </Tabs>
      )}
    </DetailPage>
  );
}

function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] tabular-nums text-primary">{n}</span>;
}

function ShareCard({ survey }: { survey: SurveyRecord }) {
  const t = useTranslations('hrSurveys.share');
  const url =
    survey.publicUrl ??
    (survey.publicToken && survey.status !== 'DRAFT' && typeof window !== 'undefined'
      ? `${window.location.origin}/e/${survey.publicToken}`
      : null);

  const explanation =
    survey.status === 'DRAFT'
      ? t('draftExplain')
      : survey.status === 'CLOSED'
        ? t('closedExplain')
        : survey.expired
          ? t('expiredExplain')
          : t('publishedExplain');

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" /> {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className={cn('text-sm', survey.status === 'PUBLISHED' && !survey.expired ? 'text-foreground' : 'text-muted-foreground')}>
          {explanation}
        </p>
        {url && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label={t('linkLabel')} />
              <div className="flex shrink-0 gap-2">
                <Button
                  onClick={async () => {
                    if (await copyText(url)) toast.success(t('copied'));
                    else toast.error(t('copyFailed'));
                  }}
                >
                  <Copy className="size-4" /> {t('copy')}
                </Button>
                <Button variant="outline" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" /> {t('open')}
                  </a>
                </Button>
              </div>
            </div>
            <ul className="grid gap-1 text-xs text-muted-foreground">
              <li>· {survey.anonymous ? t('ruleAnonymous') : t('ruleIdentified')}</li>
              <li>· {survey.allowMultipleResponses ? t('ruleMultiple') : t('ruleSingle')}</li>
              {survey.closesAt && (
                <li>· {t('ruleClosesAt', { date: format(new Date(survey.closesAt), 'dd/MM/yyyy HH:mm') })}</li>
              )}
              <li>· {t('ruleStable')}</li>
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
