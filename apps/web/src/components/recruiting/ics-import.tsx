'use client';

import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { ApiError, apiPost } from '@/lib/api';
import { parseIcs, proposeSlots, type ProposedSlot } from '@/lib/ics';
import { formatSlot, type InterviewSlot } from './recruiting-meta';

/**
 * Interview slots proposed from the recruiter's calendar: the .ics export is read in the browser,
 * free slots are proposed around the busy events, and the recruiter picks the ones to publish.
 */
export function IcsImport({ openingId, existing, onAdded }: { openingId: string; existing: InterviewSlot[]; onAdded: () => void }) {
  const t = useTranslations('recruiting.interviews.ics');
  const tc = useTranslations('common');
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [proposals, setProposals] = useState<ProposedSlot[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [meta, setMeta] = useState({ busy: 0, interviewer: '', location: '' });

  const read = async (file: File) => {
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(t('tooBig'));
      const horizon = new Date(Date.now() + 21 * 86_400_000);
      const cal = parseIcs(await file.text(), horizon);
      const taken = new Set(existing.map((s) => new Date(s.startsAt).getTime()));
      const list = proposeSlots(cal).filter((p) => !taken.has(p.start.getTime()));
      setProposals(list);
      setPicked(new Set(list.map((_, i) => i)));
      setMeta({ busy: cal.busy.filter((b) => b.end > new Date() && b.start < horizon).length, interviewer: cal.owner ?? '', location: '' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('invalid'));
    }
  };

  const add = useMutation({
    mutationFn: () =>
      apiPost(`/recruiting/openings/${openingId}/slots`, {
        slots: proposals!
          .filter((_, i) => picked.has(i))
          .map((p) => ({
            startsAt: p.start.toISOString(),
            durationMinutes: p.durationMinutes,
            location: p.location ?? (meta.location || undefined),
            interviewer: meta.interviewer || undefined,
          })),
      }),
    onSuccess: () => {
      toast.success(t('added', { count: picked.size }));
      setProposals(null);
      onAdded();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
          <CalendarPlus className="size-3.5" /> {t('import')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('hint')}</span>
      </div>

      {proposals && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{t('proposed', { count: proposals.length })}</p>
              <p className="text-xs text-muted-foreground">{t('summary', { busy: meta.busy })}</p>
            </div>
            <Button variant="ghost" size="icon" className="size-7" aria-label={tc('cancel')} onClick={() => setProposals(null)}>
              <X className="size-4" />
            </Button>
          </div>
          {!proposals.length ? (
            <p className="text-sm text-muted-foreground">{t('none')}</p>
          ) : (
            <>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {proposals.map((p, i) => (
                  <label key={p.start.toISOString()} className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                    <Checkbox
                      checked={picked.has(i)}
                      onCheckedChange={(v) => setPicked((s) => { const n = new Set(s); if (v) n.add(i); else n.delete(i); return n; })}
                    />
                    <span className="flex-1 whitespace-nowrap">{formatSlot(p.start.toISOString(), locale)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{p.durationMinutes} min</span>
                    {p.source === 'calendar' && <Badge variant="secondary" className="text-[10px]">{t('fromCalendar')}</Badge>}
                  </label>
                ))}
              </div>
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field label={t('interviewer')}>
                  <Input value={meta.interviewer} maxLength={200} onChange={(e) => setMeta({ ...meta, interviewer: e.target.value })} />
                </Field>
                <Field label={t('location')}>
                  <Input value={meta.location} maxLength={300} placeholder={t('locationHint')} onChange={(e) => setMeta({ ...meta, location: e.target.value })} />
                </Field>
                <Button size="sm" disabled={!picked.size || add.isPending} onClick={() => add.mutate()}>
                  {t('add', { count: picked.size })}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
