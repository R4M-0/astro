'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LogIn, Pencil, Power, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ADDON_BUNDLE, ADDONS, type AddonKey } from '@astro/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useSession } from '@/stores/session';

interface Detail {
  id: string; name: string; slug: string; status: string; statusReason: string | null; createdAt: string;
  subscription: { id: string; status: string; billingCycle: string; seatLimit: number; addons: string[]; currentPeriodEnd: string | null; trialEndsAt: string | null; plan: { id: string; key: string; name: string } } | null;
  seats: { limit: number | null; used: number; available: number | null };
  memberCount: number;
  storage: { bytes: number; files: number };
  recentAudit: { id: string; action: string; actorEmail: string | null; createdAt: string }[];
  _count: { sites: number; roles: number };
}
interface Account { id: string; isActive: boolean; user: { id: string; email: string; firstName: string; lastName: string; lastLoginAt: string | null }; role: { key: string; name: string }; }
interface Plan { id: string; key: string; name: string; seatLimit: number | null; }

const STATUS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  TRIAL: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  SUSPENDED: 'bg-red-500/10 text-red-600 border-red-500/20',
};
const ADDON_LABELS: Record<AddonKey, string> = { environment: 'Environment (ISO 14001)', 'health-safety': 'Health & Safety (ISO 45001)', haccp: 'HACCP — food safety (ISO 22000)' };
const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`);

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const startImpersonation = useSession((s) => s.startImpersonation);
  const [seatOpen, setSeatOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const { data: org, isLoading } = useQuery({ queryKey: ['platform-org', id], queryFn: () => apiGet<Detail>(`/platform/organizations/${id}`) });
  const accounts = useQuery({ queryKey: ['platform-org-accounts', id], queryFn: () => apiGet<{ data: Account[] }>(`/platform/organizations/${id}/accounts?pageSize=100`) });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['platform-org', id] }); qc.invalidateQueries({ queryKey: ['platform-org-accounts', id] }); };

  const setStatus = useMutation({
    mutationFn: (p: { status: 'ACTIVE' | 'SUSPENDED'; reason?: string }) => apiPatch(`/platform/organizations/${id}/status`, p),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const setAddons = useMutation({
    mutationFn: (addons: string[]) => apiPatch(`/platform/organizations/${id}/addons`, { addons }),
    onSuccess: () => { toast.success('Add-ons updated'); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const setAccountActive = useMutation({
    mutationFn: (p: { membershipId: string; active: boolean }) => apiPatch(`/platform/organizations/${id}/accounts/${p.membershipId}/active`, { active: p.active }),
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/platform/organizations/${id}`),
    onSuccess: () => { toast.success('Organization deleted'); router.push('/platform/organizations'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const impersonate = useMutation({
    mutationFn: () => apiPost<{ accessToken: string; organization: { id: string; name: string }; user: { id: string; email: string; firstName: string; lastName: string } }>(`/platform/organizations/${id}/impersonate`, {}),
    onSuccess: async (r) => { await startImpersonation(r); router.push('/dashboard'); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading || !org) {
    return <div className="mx-auto max-w-5xl space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>;
  }

  const suspended = org.status === 'SUSPENDED';

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/platform/organizations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Organizations</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
            <Badge variant="outline" className={STATUS[org.status] ?? ''}>{org.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{org.slug} · created {new Date(org.createdAt).toLocaleDateString()}</p>
          {org.statusReason && suspended && <p className="mt-1 text-xs text-red-600">Reason: {org.statusReason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => impersonate.mutate()} disabled={impersonate.isPending}><LogIn className="size-4" /> Access as admin</Button>
          {suspended ? (
            <Button variant="outline" size="sm" onClick={() => setStatus.mutate({ status: 'ACTIVE' })}><Power className="size-4" /> Reactivate</Button>
          ) : (
            <Button variant="outline" size="sm" className="text-amber-600" onClick={() => { const reason = prompt('Reason for suspension (optional):') ?? undefined; setStatus.mutate({ status: 'SUSPENDED', reason }); }}><Power className="size-4" /> Suspend</Button>
          )}
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { if (confirm(`Delete ${org.name}? This blocks all access.`)) remove.mutate(); }}><Trash2 className="size-4" /></Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* subscription */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Subscription</p>
            <Button variant="ghost" size="sm" onClick={() => setPlanOpen(true)}><Pencil className="size-3.5" /> Change plan</Button>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <Row k="Plan" v={org.subscription?.plan.name ?? 'No plan'} />
            <Row k="Status" v={org.subscription?.status ?? '—'} />
            <Row k="Billing" v={org.subscription?.billingCycle.toLowerCase() ?? '—'} />
            <Row k="Renewal" v={org.subscription?.currentPeriodEnd ? new Date(org.subscription.currentPeriodEnd).toLocaleDateString() : '—'} />
          </dl>
        </Card>

        {/* seats */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Accounts &amp; seats</p>
            <Button variant="ghost" size="sm" onClick={() => setSeatOpen(true)}><Pencil className="size-3.5" /> Seat limit</Button>
          </div>
          <div className="mt-3">
            <div className="flex items-end justify-between">
              <span className="text-2xl font-semibold tabular-nums">{org.seats.used}{org.seats.limit != null ? <span className="text-lg text-muted-foreground"> / {org.seats.limit}</span> : ''}</span>
              <span className="text-xs text-muted-foreground">{org.seats.available != null ? `${org.seats.available} available` : 'unlimited'}</span>
            </div>
            {org.seats.limit != null && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (org.seats.used / org.seats.limit) * 100)}%` }} />
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{org.memberCount} total members · {org.storage.files} files · {fmtBytes(org.storage.bytes)} · {org._count.sites} sites</p>
          </div>
        </Card>
      </div>

      {/* paid add-on modules — activated here once purchased */}
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Add-on modules</p>
          <p className="text-xs text-muted-foreground">Bundle (Env + H&S): {ADDON_BUNDLE.priceMonthly} €/mo</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.values(ADDONS).map((a) => {
            const active = org.subscription?.addons ?? [];
            const on = active.includes(a.key);
            return (
              <label key={a.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium">{ADDON_LABELS[a.key]}</span>
                  <span className="block text-xs text-muted-foreground">{a.priceMonthly} €/mo · {a.routePrefix}</span>
                </span>
                <Switch
                  checked={on}
                  disabled={!org.subscription || setAddons.isPending}
                  onCheckedChange={(v) => setAddons.mutate(v ? [...active, a.key] : active.filter((k) => k !== a.key))}
                />
              </label>
            );
          })}
        </div>
      </Card>

      {/* accounts */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3"><p className="text-sm font-medium">User accounts</p></div>
        <Table>
          <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Last login</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {(accounts.data?.data ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell><span className="font-medium">{a.user.firstName} {a.user.lastName}</span><span className="block text-xs text-muted-foreground">{a.user.email}</span></TableCell>
                <TableCell className="text-sm">{a.role.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.user.lastLoginAt ? new Date(a.user.lastLoginAt).toLocaleDateString() : 'never'}</TableCell>
                <TableCell>{a.isActive ? <Badge variant="outline" className={STATUS.ACTIVE}>Active</Badge> : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setAccountActive.mutate({ membershipId: a.id, active: !a.isActive })}>{a.isActive ? 'Deactivate' : 'Activate'}</Button>
                </TableCell>
              </TableRow>
            ))}
            {accounts.data && accounts.data.data.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No accounts.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* recent platform activity */}
      <Card className="p-4">
        <p className="text-sm font-medium">Recent platform activity</p>
        <div className="mt-2 space-y-1.5">
          {org.recentAudit.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {org.recentAudit.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-xs">
              <span><span className="font-medium">{e.action}</span>{e.actorEmail ? ` · ${e.actorEmail}` : ''}</span>
              <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>

      <SeatDialog open={seatOpen} onOpenChange={setSeatOpen} orgId={id} current={org.seats.limit ?? org.seats.used} used={org.seats.used} onDone={invalidate} />
      <PlanDialog open={planOpen} onOpenChange={setPlanOpen} orgId={id} currentPlanId={org.subscription?.plan.id} onDone={invalidate} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>;
}

function SeatDialog({ open, onOpenChange, orgId, current, used, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; current: number; used: number; onDone: () => void }) {
  const [value, setValue] = useState(String(current));
  const save = useMutation({
    mutationFn: () => apiPatch(`/platform/organizations/${orgId}/seat-limit`, { seatLimit: Number(value) }),
    onSuccess: () => { toast.success('Seat limit updated'); onDone(); onOpenChange(false); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>Seat limit</DialogTitle></DialogHeader>
        <Field className="grid gap-1.5"><Label>Maximum accounts</Label><Input type="number" min={used} value={value} onChange={(e) => setValue(e.target.value)} /><p className="text-xs text-muted-foreground">{used} accounts currently active.</p></Field>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({ open, onOpenChange, orgId, currentPlanId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; currentPlanId?: string; onDone: () => void }) {
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => apiGet<Plan[]>('/platform/plans'), enabled: open });
  const [planId, setPlanId] = useState(currentPlanId ?? '');
  const save = useMutation({
    mutationFn: () => apiPatch(`/platform/organizations/${orgId}/plan`, { planId }),
    onSuccess: () => { toast.success('Plan changed'); onDone(); onOpenChange(false); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>Change plan</DialogTitle></DialogHeader>
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
          <SelectContent>{(plans.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.seatLimit != null ? ` · ${p.seatLimit} seats` : ' · custom'}</SelectItem>)}</SelectContent>
        </Select>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!planId || save.isPending} onClick={() => save.mutate()}>Apply</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
