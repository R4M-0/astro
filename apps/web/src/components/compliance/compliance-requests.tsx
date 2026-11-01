'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import { SubjectPicker } from './subject-picker';
import type { Dsr, DsrStatus, DsrType, Subject } from './types';

const ALL = '__all';

export function DsrStatusBadge({ dsr }: { dsr: Pick<Dsr, 'status' | 'dueAt'> }) {
  const t = useTranslations('compliance.requests');
  const overdue = dsr.status === 'OPEN' && new Date(dsr.dueAt) < new Date();
  return (
    <Badge
      variant="outline"
      className={cn(
        overdue && 'border-destructive/40 text-destructive',
        dsr.status === 'COMPLETED' && 'border-success/40 text-success',
      )}
    >
      {overdue ? t('overdue') : t(`status.${dsr.status}`)}
    </Badge>
  );
}

export function ComplianceRequests() {
  const t = useTranslations('compliance.requests');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const can = useHasPermission();
  const router = useRouter();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>(ALL);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DsrType>('ACCESS');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [requesterEmail, setRequesterEmail] = useState('');
  const [channel, setChannel] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['compliance', 'requests', status],
    queryFn: () => apiGet<Dsr[]>(`/compliance/requests${status === ALL ? '' : `?status=${status}`}`),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<Dsr>('/compliance/requests', {
        type,
        subjectType: subject!.type,
        subjectId: subject!.id,
        requesterEmail: requesterEmail.trim() || undefined,
        channel: channel.trim() || undefined,
        notes: notes.trim() || undefined,
        receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(),
      }),
    onSuccess: (dsr) => {
      toast.success(t('created', { reference: dsr.reference }));
      qc.invalidateQueries({ queryKey: ['compliance'] });
      setOpen(false);
      router.push(`/compliance/requests/${dsr.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  const reset = () => {
    setType('ACCESS');
    setSubject(null);
    setRequesterEmail('');
    setChannel('');
    setNotes('');
    setReceivedAt(new Date().toISOString().slice(0, 10));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {(['OPEN', 'COMPLETED', 'REJECTED'] as DsrStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {can('compliance:update') && (
          <Button size="sm" onClick={() => { reset(); setOpen(true); }}>
            <Plus className="size-4" /> {t('new')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-60" />
      ) : !data?.length ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('columns.reference')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('columns.type')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('columns.subject')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('columns.received')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('columns.due')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/compliance/requests/${r.id}`} className="hover:underline">{r.reference}</Link>
                  </td>
                  <td className="px-3 py-2">{t(`type.${r.type}`)}</td>
                  <td className="px-3 py-2">{r.subjectLabel}</td>
                  <td className="px-3 py-2 tabular-nums">{format(new Date(r.receivedAt), 'd MMM yyyy', { locale: dateLocale })}</td>
                  <td className="px-3 py-2 tabular-nums">{format(new Date(r.dueAt), 'd MMM yyyy', { locale: dateLocale })}</td>
                  <td className="px-3 py-2"><DsrStatusBadge dsr={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('new')}
        description={t('newDesc')}
        submitLabel={t('create')}
        onSubmit={() => create.mutate()}
        submitting={create.isPending}
        disabled={!subject}
      >
        <Field label={t('fields.type')} required>
          <Select value={type} onValueChange={(v) => setType(v as DsrType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ACCESS">{t('type.ACCESS')}</SelectItem>
              <SelectItem value="ERASURE">{t('type.ERASURE')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('fields.subject')} required hint={t('fields.subjectHint')}>
          <SubjectPicker value={subject} onChange={setSubject} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.receivedAt')} required hint={t('fields.receivedAtHint')}>
            <Input type="date" value={receivedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReceivedAt(e.target.value)} />
          </Field>
          <Field label={t('fields.channel')}>
            <Input value={channel} placeholder={t('fields.channelPlaceholder')} onChange={(e) => setChannel(e.target.value)} />
          </Field>
        </div>
        <Field label={t('fields.requesterEmail')}>
          <Input type="email" value={requesterEmail} onChange={(e) => setRequesterEmail(e.target.value)} />
        </Field>
        <Field label={t('fields.notes')}>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </FormDialog>
    </div>
  );
}
