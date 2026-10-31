'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileKey2, KeyRound, ServerCog, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { isAddonKey } from '@astro/shared';
import { ADDON_META } from '@/components/billing/addons';
import type { LicenseDetails, LicenseStatus } from '@/components/license/use-license';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api';
import { useSession } from '@/stores/session';

const STATUS_STYLE: Record<LicenseStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  expiring: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  grace: 'bg-red-500/10 text-red-600 border-red-500/20',
  expired: 'bg-red-500/10 text-red-600 border-red-500/20',
  missing: 'bg-red-500/10 text-red-600 border-red-500/20',
  invalid: 'bg-red-500/10 text-red-600 border-red-500/20',
  clock_tampered: 'bg-red-500/10 text-red-600 border-red-500/20',
};

/** Admin → Licence (self-hosted builds only; the page gates it on organization:admin). */
export function AdminLicense() {
  const t = useTranslations('license');
  const tAddons = useTranslations('addons');
  const format = useFormatter();
  const qc = useQueryClient();
  const organizationId = useSession((s) => s.organizationId);
  const switchOrganization = useSession((s) => s.switchOrganization);
  const [token, setToken] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({ queryKey: ['license-details'], queryFn: () => apiGet<LicenseDetails>('/license') });

  const install = useMutation({
    mutationFn: () => apiPost<LicenseDetails>('/license', { license: token.trim() }),
    onSuccess: async (r) => {
      toast.success(t('installed', { reference: r.license?.reference ?? '' }));
      setToken('');
      qc.setQueryData(['license-details'], r);
      await qc.invalidateQueries({ queryKey: ['license-status'] });
      // licensed add-ons may have changed → reload permissions + navigation
      if (organizationId) await switchOrganization(organizationId);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setToken((await file.text()).trim());
  };

  const copyInstanceId = async () => {
    if (!data?.instanceId) return;
    try {
      await navigator.clipboard.writeText(data.instanceId);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-32" /></div>;

  const lic = data.license;
  const date = (iso: string | null | undefined) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'long' }) : '—');
  const seatPct = lic ? Math.min(100, (data.usage.seatsUsed / Math.max(1, lic.seatLimit)) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4" /> {t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-lg font-semibold">{lic?.customer ?? t('none')}</span>
              <Badge variant="outline" className={STATUS_STYLE[data.status]}>{t(`status.${data.status}`)}</Badge>
            </div>
            {data.error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-red-600">{data.error.message}</p>}
            {data.readOnly && <p className="text-muted-foreground">{t('readOnlyHint')}</p>}
            {data.upcoming && (
              <p className="rounded-md bg-sky-500/10 px-3 py-2 text-sky-700 dark:text-sky-300">
                {t('upcoming', { reference: data.upcoming.lid, start: date(data.upcoming.startsAt), end: date(data.upcoming.expiresAt) })}
              </p>
            )}
            {lic && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 pt-1">
                <dt className="text-muted-foreground">{t('reference')}</dt><dd className="text-right font-mono text-xs leading-5">{lic.reference}</dd>
                <dt className="text-muted-foreground">{t('plan')}</dt><dd className="text-right capitalize">{lic.plan}</dd>
                <dt className="text-muted-foreground">{t('validity')}</dt><dd className="text-right">{date(lic.startsAt)} → {date(lic.expiresAt)}</dd>
                {data.daysLeft != null && data.daysLeft >= 0 && (
                  <><dt className="text-muted-foreground">{t('daysLeft')}</dt><dd className="text-right tabular-nums">{data.daysLeft}</dd></>
                )}
                <dt className="text-muted-foreground">{t('grace')}</dt><dd className="text-right">{t('graceDays', { n: lic.graceDays })} · {date(data.graceEndsAt)}</dd>
                {lic.updatesUntil && <><dt className="text-muted-foreground">{t('updatesUntil')}</dt><dd className="text-right">{date(lic.updatesUntil)}</dd></>}
                <dt className="text-muted-foreground">{t('source')}</dt><dd className="text-right">{data.source ? t(`sources.${data.source}`) : '—'}</dd>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><ServerCog className="size-4" /> {t('usage')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="flex items-end justify-between">
                <span className="text-muted-foreground">{t('accounts')}</span>
                <span className="text-xl font-semibold tabular-nums">
                  {data.usage.seatsUsed}{lic && <span className="text-base text-muted-foreground"> / {lic.seatLimit}</span>}
                </span>
              </div>
              {lic && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${seatPct >= 100 ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${seatPct}%` }} />
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{t('accountsHint')}</p>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('organizations')}</span>
              <span className="tabular-nums">{data.usage.organizations}{lic ? ` / ${lic.orgLimit}` : ''}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">{t('addons')}</span>
              <span className="flex flex-wrap justify-end gap-1">
                {lic?.addons.filter(isAddonKey).length
                  ? lic.addons.filter(isAddonKey).map((a) => <Badge key={a} variant="outline">{tAddons(`${ADDON_META[a].i18n}.short`)}</Badge>)
                  : '—'}
              </span>
            </div>
            <div className="border-t pt-3">
              <p className="text-muted-foreground">{t('instanceId')}</p>
              <div className="mt-1 flex gap-2">
                <Input readOnly value={data.instanceId ?? ''} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="sm" onClick={copyInstanceId}><Copy className="size-3.5" /> {t('copy')}</Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{lic?.boundToInstance ? t('bound') : t('instanceHint')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><FileKey2 className="size-4" /> {t('installTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('installBody')}</p>
          <Textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="QLIC1.…"
            rows={4}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <input ref={fileRef} type="file" accept=".lic,.txt,text/plain" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="size-4" /> {t('chooseFile')}</Button>
            <Button disabled={token.trim().length < 20 || install.isPending} onClick={() => install.mutate()}>{t('install')}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
