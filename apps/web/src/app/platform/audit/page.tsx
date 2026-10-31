'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight, Building2, CreditCard, LogIn, Power, Search, ShieldAlert, Ticket, UserCog, UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';

interface Entry {
  id: string; action: string; actorEmail: string | null; organizationId: string | null; organizationName: string | null;
  targetUserId: string | null; ip: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null; createdAt: string;
}
interface Paged { data: Entry[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; }

// action → readable label, icon, and tone
const ACTIONS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  'organization.created': { label: 'Organization created', icon: Building2, tone: 'text-emerald-600 bg-emerald-500/10' },
  'organization.suspended': { label: 'Organization suspended', icon: Power, tone: 'text-red-600 bg-red-500/10' },
  'organization.activated': { label: 'Organization reactivated', icon: Power, tone: 'text-emerald-600 bg-emerald-500/10' },
  'organization.deleted': { label: 'Organization deleted', icon: ShieldAlert, tone: 'text-red-600 bg-red-500/10' },
  'seat.limit_changed': { label: 'Seat limit changed', icon: UserCog, tone: 'text-blue-600 bg-blue-500/10' },
  'seat.requested': { label: 'Seats requested', icon: Ticket, tone: 'text-amber-600 bg-amber-500/10' },
  'subscription.plan_changed': { label: 'Plan changed', icon: CreditCard, tone: 'text-blue-600 bg-blue-500/10' },
  'subscription.status_changed': { label: 'Subscription status changed', icon: CreditCard, tone: 'text-blue-600 bg-blue-500/10' },
  'plan.requested': { label: 'Plan upgrade requested', icon: Ticket, tone: 'text-amber-600 bg-amber-500/10' },
  'account.activated': { label: 'Account activated', icon: UserPlus, tone: 'text-emerald-600 bg-emerald-500/10' },
  'account.deactivated': { label: 'Account deactivated', icon: UserCog, tone: 'text-red-600 bg-red-500/10' },
  'impersonation.start': { label: 'Support access', icon: LogIn, tone: 'text-violet-600 bg-violet-500/10' },
};
const fallback = { label: '', icon: ShieldAlert, tone: 'text-muted-foreground bg-muted' };

/** Turn an entry's before/after/metadata into a plain-English description. */
function describe(e: Entry): string {
  const m = { ...(e.before ?? {}), ...(e.after ?? {}), ...(e.metadata ?? {}) } as Record<string, unknown>;
  switch (e.action) {
    case 'seat.limit_changed': return `Seat limit set to ${m.seatLimit}`;
    case 'seat.requested': return `Requested ${m.additionalSeats} more seat(s)${m.note ? ` — “${m.note}”` : ''}`;
    case 'organization.suspended': return m.reason ? `Reason: ${m.reason}` : 'Access blocked';
    case 'organization.activated': return 'Access restored';
    case 'organization.created': return `Created “${m.name ?? ''}”`;
    case 'subscription.plan_changed': return `New plan applied${m.seatLimit ? ` · ${m.seatLimit} seats` : ''}`;
    case 'subscription.status_changed': return `Status → ${String(m.status ?? '').toLowerCase()}`;
    case 'plan.requested': return `Requested plan “${m.planKey ?? ''}”${m.note ? ` — “${m.note}”` : ''}`;
    case 'impersonation.start': return `Signed in as ${String(m.role ?? 'org user')} for support`;
    case 'account.activated': return 'User account enabled';
    case 'account.deactivated': return 'User account disabled';
    default: {
      const parts = Object.entries(m).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
      return parts.join(' · ') || '—';
    }
  }
}

export default function PlatformAuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '30' });
  if (action.trim()) params.set('action', action.trim());
  const { data, isLoading } = useQuery({ queryKey: ['platform-audit', page, action], queryFn: () => apiGet<Paged>(`/platform/audit-logs?${params.toString()}`) });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">Immutable trail of sensitive platform actions.</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Filter by action…" className="pl-8" />
      </div>

      <div className="overflow-hidden rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
            {data?.data.map((e) => {
              const meta = ACTIONS[e.action] ?? { ...fallback, label: e.action };
              const Icon = meta.icon;
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md ${meta.tone}`}><Icon className="size-4" /></span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">{describe(e)}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{e.actorEmail ?? 'System'}</span>
                    {e.ip && <span className="block text-[10px] text-muted-foreground">{e.ip}</span>}
                  </TableCell>
                  <TableCell>
                    {e.organizationId ? (
                      <Link href={`/platform/organizations/${e.organizationId}`} className="text-sm text-primary hover:underline">{e.organizationName ?? 'View'}</Link>
                    ) : <span className="text-sm text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {e.organizationId ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/platform/organizations/${e.organizationId}`}>Open <ArrowUpRight className="size-3.5" /></Link>
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">platform</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {data && data.data.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No audit entries.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-muted-foreground">Page {data.meta.page} / {data.meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
