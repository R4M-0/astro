'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { ADDONS, type AddonKey } from '@astro/shared';
import type { IssuedLicense } from '@/components/license/issued-license';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api';

interface Plan { id: string; key: string; name: string; seatLimit: number | null; }

const ADDON_LABELS: Record<AddonKey, string> = { environment: 'Environment (ISO 14001)', 'health-safety': 'Health & Safety (ISO 45001)', haccp: 'HACCP (ISO 22000)' };
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const plusYear = (iso: string) => {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return isoDay(d);
};
const noopSubscribe = () => () => {};

interface Form {
  customer: string; plan: string; seatLimit: string; orgLimit: string; addons: string[]; storageLimitMb: string;
  startsAt: string; expiresAt: string; graceDays: string; instanceId: string; updatesUntil: string; notes: string;
}

export default function NewLicensePage() {
  // `?from=<id>` pre-fills a renewal of that license
  const fromId = useSyncExternalStore(noopSubscribe, () => new URLSearchParams(window.location.search).get('from'), () => null);
  const source = useQuery({
    queryKey: ['platform-license', fromId],
    queryFn: () => apiGet<IssuedLicense>(`/platform/licenses/${fromId}`),
    enabled: !!fromId,
  });
  if (fromId && !source.data) return <div className="mx-auto max-w-3xl"><Skeleton className="h-96" /></div>;
  return <LicenseForm key={source.data?.id ?? 'new'} renewOf={source.data ?? null} />;
}

function LicenseForm({ renewOf }: { renewOf: IssuedLicense | null }) {
  const router = useRouter();
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => apiGet<Plan[]>('/platform/plans') });
  const [form, setForm] = useState<Form>(() => {
    const today = isoDay(new Date());
    const startsAt = renewOf ? isoDay(new Date(renewOf.expiresAt)) : today;
    return {
      customer: renewOf?.customer ?? '',
      plan: renewOf?.plan ?? 'enterprise',
      seatLimit: String(renewOf?.seatLimit ?? 50),
      orgLimit: String(renewOf?.orgLimit ?? 1),
      addons: renewOf?.addons ?? [],
      storageLimitMb: renewOf?.storageLimitMb != null ? String(renewOf.storageLimitMb) : '',
      startsAt,
      expiresAt: plusYear(startsAt),
      graceDays: String(renewOf?.graceDays ?? 14),
      instanceId: renewOf?.instanceId ?? '',
      updatesUntil: '',
      notes: '',
    };
  });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const issue = useMutation({
    mutationFn: () =>
      apiPost<IssuedLicense>('/platform/licenses', {
        customer: form.customer.trim(),
        plan: form.plan,
        seatLimit: Number(form.seatLimit),
        orgLimit: Number(form.orgLimit),
        addons: form.addons,
        storageLimitMb: form.storageLimitMb ? Number(form.storageLimitMb) : null,
        startsAt: form.startsAt,
        expiresAt: form.expiresAt,
        graceDays: Number(form.graceDays),
        instanceId: form.instanceId.trim() || null,
        updatesUntil: form.updatesUntil || null,
        notes: form.notes.trim() || null,
        supersedesId: renewOf?.id ?? null,
        organizationId: renewOf?.organizationId ?? null,
      }),
    onSuccess: (l) => {
      toast.success(`${l.reference} issued`);
      router.push(`/platform/licenses/${l.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const valid =
    form.customer.trim() &&
    Number(form.seatLimit) >= 1 &&
    Number(form.orgLimit) >= 1 &&
    form.startsAt &&
    form.expiresAt > form.startsAt &&
    Number(form.graceDays) >= 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={renewOf ? `/platform/licenses/${renewOf.id}` : '/platform/licenses'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {renewOf ? renewOf.reference : 'Licenses'}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{renewOf ? `Renew ${renewOf.reference}` : 'Issue a license'}</h1>
        <p className="text-sm text-muted-foreground">The signed key is shown once issued; the customer installs it in Administration → Licence.</p>
      </div>

      <Card className="grid gap-4 p-5">
        <div className="grid gap-1.5"><Label>Customer *</Label><Input value={form.customer} onChange={set('customer')} placeholder="Acme Industries SA" /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label>Plan *</Label>
            <Select value={form.plan} onValueChange={(v) => setForm((f) => ({ ...f, plan: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(plans.data ?? []).map((p) => <SelectItem key={p.id} value={p.key}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Accounts *</Label><Input type="number" min={1} value={form.seatLimit} onChange={set('seatLimit')} /></div>
          <div className="grid gap-1.5"><Label>Organizations *</Label><Input type="number" min={1} value={form.orgLimit} onChange={set('orgLimit')} /></div>
        </div>
        <div className="grid gap-2">
          <Label>Add-ons</Label>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(ADDONS) as AddonKey[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.addons.includes(k)}
                  onCheckedChange={(c) => setForm((f) => ({ ...f, addons: c ? [...f.addons, k] : f.addons.filter((a) => a !== k) }))}
                />
                {ADDON_LABELS[k]}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label>Starts *</Label><Input type="date" value={form.startsAt} onChange={set('startsAt')} /></div>
          <div className="grid gap-1.5"><Label>Expires *</Label><Input type="date" value={form.expiresAt} onChange={set('expiresAt')} /></div>
          <div className="grid gap-1.5"><Label>Grace (days)</Label><Input type="number" min={0} max={90} value={form.graceDays} onChange={set('graceDays')} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Instance ID</Label>
            <Input value={form.instanceId} onChange={set('instanceId')} placeholder="QI-… (empty = any installation)" className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label>Updates until</Label>
            <Input type="date" value={form.updatesUntil} onChange={set('updatesUntil')} />
          </div>
        </div>
        <div className="grid gap-1.5"><Label>Storage per organization (MB)</Label><Input type="number" min={0} value={form.storageLimitMb} onChange={set('storageLimitMb')} placeholder="Plan default" /></div>
        <div className="grid gap-1.5"><Label>Internal notes</Label><Textarea value={form.notes} onChange={set('notes')} rows={3} placeholder="Contract, order number…" /></div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" asChild><Link href="/platform/licenses">Cancel</Link></Button>
          <Button disabled={!valid || issue.isPending} onClick={() => issue.mutate()}>Sign & issue</Button>
        </div>
      </Card>
    </div>
  );
}
