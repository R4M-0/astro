'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { ApiError, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import { toDateInput, type JourneyDetail, type JourneyItem } from './hr-meta';
import { EMPTY_ITEM, ITEM_KIND_ICON, itemDraftValid, JourneyItemFields, type JourneyItemDraft } from './journey-item-fields';

/** Steps of a plan: state computed by the API (read receipts, awareness, attendance) + manual ticks. */
export function JourneyChecklist({ journey, canEdit }: { journey: JourneyDetail; canEdit: boolean }) {
  const t = useTranslations('hr.journeys');
  const tc = useTranslations('common');
  const has = useHasPermission();
  const locale = useLocale();
  const qc = useQueryClient();
  const open = journey.status === 'IN_PROGRESS';
  const editable = canEdit && open;
  const [dialog, setDialog] = useState<{ item: JourneyItem | null } | null>(null);
  const [draft, setDraft] = useState<JourneyItemDraft>(EMPTY_ITEM);
  const [dueDate, setDueDate] = useState('');

  const openDialog = (i: JourneyItem | null) => {
    setDialog({ item: i });
    setDraft(i ? { kind: i.kind, label: i.label, trainingId: i.trainingId ?? '' } : EMPTY_ITEM);
    setDueDate(toDateInput(i?.dueDate));
  };

  const key = ['hr', 'journeys', 'detail', journey.id];
  const done = (j: JourneyDetail) => {
    qc.setQueryData(key, j);
    qc.invalidateQueries({ queryKey: ['hr', 'journeys'] });
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));

  const toggle = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => apiPost<JourneyDetail>(`/hr/journeys/${journey.id}/items/${id}/toggle`, { done: value }),
    onSuccess: done,
    onError: onErr,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: draft.kind,
        label: draft.label.trim(),
        trainingId: draft.trainingId || undefined,
        dueDate: dueDate || undefined,
      };
      if (dialog?.item) {
        // the kind of an existing step is fixed
        const { label, trainingId } = body;
        return apiPatch<JourneyDetail>(`/hr/journeys/${journey.id}/items/${dialog.item.id}`, {
          label,
          trainingId,
          dueDate: dueDate || null,
        });
      }
      return apiPost<JourneyDetail>(`/hr/journeys/${journey.id}/items`, body);
    },
    onSuccess: (j) => {
      done(j);
      setDialog(null);
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<JourneyDetail>(`/hr/journeys/${journey.id}/items/${id}`),
    onSuccess: done,
    onError: onErr,
  });

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : null);
  const linkOf = (i: JourneyItem) => {
    if (i.trainingId) {
      const x = journey.linked.trainings.find((y) => y.id === i.trainingId);
      return x ? { href: has('hr-trainings:read') ? `/hr/trainings/${x.id}` : null, label: `${x.code} · ${x.theme}` } : null;
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('checklistHint')}</p>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => openDialog(null)}>
            <Plus className="size-4" /> {t('addStep')}
          </Button>
        )}
      </div>

      {journey.items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('noSteps')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {journey.items.map((i) => {
            const Icon = ITEM_KIND_ICON[i.kind];
            const link = linkOf(i);
            const pendingLink = (i.kind === 'TRAINING' && !i.trainingId) || (i.kind !== 'TASK' && i.kind !== 'TRAINING' && !link);
            return (
              <li key={i.id} className="flex items-start gap-3 p-3">
                <Checkbox
                  className="mt-0.5"
                  checked={i.state.done}
                  // auto-validated steps are read-only: they follow the real record
                  disabled={!editable || i.state.auto || toggle.isPending}
                  onCheckedChange={(v) => toggle.mutate({ id: i.id, value: v === true })}
                  aria-label={i.label}
                />
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', i.state.done && 'text-muted-foreground line-through')}>{i.label}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{t(`kinds.${i.kind}`)}</span>
                    {link &&
                      (link.href ? (
                        <Link href={link.href} className="truncate underline-offset-2 hover:underline">{link.label}</Link>
                      ) : (
                        <span className="truncate">{link.label}</span>
                      ))}
                    {pendingLink && <span className="text-amber-600 dark:text-amber-400">{i.kind === 'TRAINING' ? t('noSessionYet') : t('linkMissing')}</span>}
                    {i.dueDate && <span className={cn(i.state.overdue && 'font-medium text-destructive')}>{t('dueOn', { date: fmt(i.dueDate)! })}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {i.state.done ? (
                    <Badge variant="secondary" className="gap-1 bg-emerald-500/15 text-[11px] text-emerald-600 dark:text-emerald-400">
                      {i.state.auto && <Sparkles className="size-3" />}
                      {i.state.auto ? t('autoDone', { date: fmt(i.state.completedAt) ?? '' }) : t('doneOn', { date: fmt(i.state.completedAt) ?? '' })}
                    </Badge>
                  ) : i.state.overdue ? (
                    <Badge variant="secondary" className="gap-1 bg-rose-500/15 text-[11px] text-rose-600 dark:text-rose-400">
                      <CircleAlert className="size-3" /> {t('overdue')}
                    </Badge>
                  ) : null}
                  {editable && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-7" aria-label={tc('actions')}><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDialog(i)}><Pencil className="size-4" /> {tc('edit')}</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => window.confirm(tc('deleteConfirm')) && remove.mutate(i.id)}
                        >
                          <Trash2 className="size-4" /> {tc('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <FormDialog
        open={!!dialog}
        onOpenChange={(v) => !v && setDialog(null)}
        title={dialog?.item ? t('editStep') : t('addStep')}
        description={t('stepDesc')}
        submitLabel={dialog?.item ? tc('save') : tc('create')}
        onSubmit={() => save.mutate()}
        submitting={save.isPending}
        disabled={!itemDraftValid(draft)}
        size="md"
      >
        <JourneyItemFields value={draft} onChange={setDraft} kindLocked={!!dialog?.item} />
        <Field label={t('item.dueDate')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </FormDialog>
    </div>
  );
}
