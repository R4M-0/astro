'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet, apiPost } from '@/lib/api';

interface OrgRow {
  id: string; name: string; slug: string; status: string; createdAt: string;
  plan: { key: string; name: string } | null;
  subscriptionStatus: string | null; renewalAt: string | null; seatLimit: number | null; activeAccounts: number;
}
interface Paged { data: OrgRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; }
interface Plan { id: string; key: string; name: string; seatLimit: number | null; }

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  TRIAL: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  SUSPENDED: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function OrganizationsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (search.trim()) params.set('search', search.trim());
  if (status !== 'all') params.set('status', status);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-orgs', page, search, status],
    queryFn: () => apiGet<Paged>(`/platform/organizations?${params.toString()}`),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="text-sm text-muted-foreground">Every tenant subscribed to Constella.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New organization</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or slug…" className="pl-8" />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="TRIAL">Trial</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Accounts</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Renewal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
            ))}
            {data?.data.map((o) => (
              <TableRow key={o.id} className="cursor-pointer">
                <TableCell>
                  <Link href={`/platform/organizations/${o.id}`} className="block">
                    <span className="font-medium hover:underline">{o.name}</span>
                    <span className="block text-xs text-muted-foreground">{o.slug}</span>
                  </Link>
                </TableCell>
                <TableCell><span className="text-sm">{o.plan?.name ?? '—'}</span></TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.activeAccounts}{o.seatLimit != null ? ` / ${o.seatLimit}` : ''}
                </TableCell>
                <TableCell><Badge variant="outline" className={STATUS_STYLES[o.status] ?? ''}>{o.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{o.renewalAt ? new Date(o.renewalAt).toLocaleDateString() : '—'}</TableCell>
              </TableRow>
            ))}
            {data && data.data.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No organizations found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{data.meta.total} organizations</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-muted-foreground">Page {data.meta.page} / {data.meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => qc.invalidateQueries({ queryKey: ['platform-orgs'] })} />
    </div>
  );
}

function CreateOrgDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', slug: '', adminEmail: '', adminFirstName: '', adminLastName: '', planKey: 'professional' });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => apiGet<Plan[]>('/platform/plans'), enabled: open });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // shown once in a dismissable dialog (never in a toast that lingers on screen / in the toast stack)
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost<{ temporaryPassword?: string; invitationSent?: boolean }>('/platform/organizations', form),
    onSuccess: (r) => {
      toast.success(r.invitationSent ? 'Organization created — invitation e-mailed to the admin' : 'Organization created');
      if (r.temporaryPassword) setTempPassword(r.temporaryPassword);
      onCreated();
      onOpenChange(false);
      setForm({ name: '', slug: '', adminEmail: '', adminFirstName: '', adminLastName: '', planKey: 'professional' });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const valid = form.name.trim() && form.slug.trim() && form.adminEmail.trim() && form.adminFirstName.trim() && form.adminLastName.trim();

  const copy = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed — select the password and copy it manually');
    }
  };

  return (
    <>
    <Dialog open={!!tempPassword} onOpenChange={(o) => { if (!o) setTempPassword(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Temporary admin password</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Shown only once. Send it to the admin through a separate channel; ask them to change it right after signing in.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={tempPassword ?? ''} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" onClick={copy}><Copy className="size-3.5" /> Copy</Button>
        </div>
        <DialogFooter>
          <Button onClick={() => setTempPassword(null)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New organization</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Organization name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }))} placeholder="ACME Industries" /></div>
          <div className="grid gap-1.5"><Label>Slug</Label><Input value={form.slug} onChange={set('slug')} placeholder="acme-industries" /></div>
          <div className="grid gap-1.5"><Label>Plan</Label>
            <Select value={form.planKey} onValueChange={(v) => setForm((f) => ({ ...f, planKey: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(plans.data ?? []).map((p) => <SelectItem key={p.id} value={p.key}>{p.name}{p.seatLimit != null ? ` · ${p.seatLimit} seats` : ' · custom'}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Admin first name</Label><Input value={form.adminFirstName} onChange={set('adminFirstName')} /></div>
            <div className="grid gap-1.5"><Label>Admin last name</Label><Input value={form.adminLastName} onChange={set('adminLastName')} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Admin email</Label><Input type="email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="admin@acme.com" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>Create organization</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
