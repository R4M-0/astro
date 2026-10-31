'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CreditCard, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminAddons } from '@/components/billing/addons';
import { apiGet, apiPost } from '@/lib/api';
import { useHasPermission } from '@/stores/session';

interface Overview {
  subscription: { status: string; billingCycle: string; seatLimit: number; currentPeriodEnd: string | null; plan: { key: string; name: string; description: string | null } } | null;
  seats: { limit: number | null; used: number; available: number | null };
  invoices: { id: string; number: string; status: string; amount: string; currency: string; issuedAt: string }[];
  addons?: { active: string[] };
}
interface Plan { id: string; key: string; name: string; description: string | null; seatLimit: number | null; priceMonthly: string | null; currency: string; features: string[]; }

export function AdminBilling() {
  const t = useTranslations('billing');
  const hasPermission = useHasPermission();
  const canManage = hasPermission('organization:admin');
  const [extraSeats, setExtraSeats] = useState('5');

  const { data, isLoading } = useQuery({ queryKey: ['billing-overview'], queryFn: () => apiGet<Overview>('/billing/overview') });
  const plans = useQuery({ queryKey: ['billing-plans'], queryFn: () => apiGet<Plan[]>('/billing/plans') });

  const requestSeats = useMutation({
    mutationFn: () => apiPost('/billing/request-seats', { additionalSeats: Number(extraSeats) }),
    onSuccess: () => toast.success(t('requestSent')),
    onError: (e) => toast.error((e as Error).message),
  });
  const requestPlan = useMutation({
    mutationFn: (planKey: string) => apiPost('/billing/request-plan', { planKey }),
    onSuccess: () => toast.success(t('requestSent')),
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-32" /></div>;

  const { seats, subscription } = data;
  const atLimit = seats.available === 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CreditCard className="size-4" /> {t('currentPlan')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{subscription?.plan.name ?? '—'}</span>
              {subscription && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">{subscription.status.toLowerCase()}</Badge>}
            </div>
            {subscription?.plan.description && <p className="text-muted-foreground">{subscription.plan.description}</p>}
            <div className="flex justify-between pt-1"><span className="text-muted-foreground">{t('billingCycle')}</span><span className="capitalize">{subscription?.billingCycle.toLowerCase() ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t('renewal')}</span><span>{subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : '—'}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> {t('accounts')}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-semibold tabular-nums">{seats.used}{seats.limit != null && <span className="text-lg text-muted-foreground"> / {seats.limit}</span>}</span>
              <span className="text-xs text-muted-foreground">{seats.available != null ? t('available', { n: seats.available }) : t('unlimited')}</span>
            </div>
            {seats.limit != null && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${atLimit ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, (seats.used / seats.limit) * 100)}%` }} /></div>
            )}
            {atLimit && <p className="mt-2 text-xs text-red-600">{t('limitReached')}</p>}
            {canManage && (
              <div className="mt-3 flex items-center gap-2">
                <Input type="number" min={1} value={extraSeats} onChange={(e) => setExtraSeats(e.target.value)} className="h-8 w-20" />
                <Button size="sm" variant="outline" disabled={requestSeats.isPending} onClick={() => requestSeats.mutate()}>{t('requestSeats')}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* upgrade options */}
      <div>
        <p className="mb-2 text-sm font-medium">{t('plans')}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {(plans.data ?? []).map((p) => {
            const current = p.key === subscription?.plan.key;
            return (
              <Card key={p.id} className={current ? 'border-primary' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    {current && <Badge variant="outline" className="bg-primary/10 text-primary">{t('current')}</Badge>}
                  </div>
                  <p className="text-2xl font-semibold">{p.priceMonthly ? `${Number(p.priceMonthly)} ${p.currency}` : t('custom')}<span className="text-xs font-normal text-muted-foreground">{p.priceMonthly ? t('perMonth') : ''}</span></p>
                  <p className="text-xs text-muted-foreground">{p.seatLimit != null ? t('seats', { n: p.seatLimit }) : t('customSeats')}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {(p.features ?? []).slice(0, 5).map((f, i) => <li key={i} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3 shrink-0 text-primary" /> {f}</li>)}
                  </ul>
                  {canManage && !current && (
                    <Button size="sm" variant="outline" className="w-full" disabled={requestPlan.isPending} onClick={() => requestPlan.mutate(p.key)}>{t('requestUpgrade')}</Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <AdminAddons active={data.addons?.active ?? []} />

      {/* invoices */}
      {data.invoices.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('invoices')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>{t('invoice')}</TableHead><TableHead>{t('status')}</TableHead><TableHead>{t('date')}</TableHead><TableHead className="text-right">{t('amount')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.number}</TableCell>
                    <TableCell><Badge variant="outline">{inv.status.toLowerCase()}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(inv.amount)} {inv.currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
