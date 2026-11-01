'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, CircleDollarSign, PauseCircle, Users } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';

interface Stats {
  organizations: { total: number; active: number; trial: number; suspended: number };
  users: { total: number; activeSeats: number };
  subscriptions: Record<string, number>;
  revenue: { mrr: number; arr: number; currency: string };
  planCount: number;
}

const money = (n: number, c: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export default function PlatformOverview() {
  const { data, isLoading } = useQuery({ queryKey: ['platform-stats'], queryFn: () => apiGet<Stats>('/platform/stats') });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">Platform-wide health across all Constella organizations.</p>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Organizations" value={data.organizations.total} sub={`${data.organizations.active} active · ${data.organizations.trial} trial`} icon={Building2} />
            <Stat label="Suspended" value={data.organizations.suspended} sub="access blocked" icon={PauseCircle} />
            <Stat label="Active accounts" value={data.users.activeSeats} sub={`${data.users.total} users total`} icon={Users} />
            <Stat label="MRR" value={money(data.revenue.mrr, data.revenue.currency)} sub={`${money(data.revenue.arr, data.revenue.currency)} ARR`} icon={CircleDollarSign} />
          </div>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Subscriptions by status</p>
                <p className="text-xs text-muted-foreground">{data.planCount} plans configured</p>
              </div>
              <Link href="/platform/organizations" className="text-sm text-primary hover:underline">Manage organizations →</Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(data.subscriptions).length === 0 && <span className="text-sm text-muted-foreground">No subscriptions yet.</span>}
              {Object.entries(data.subscriptions).map(([status, count]) => (
                <span key={status} className="rounded-full border bg-muted/40 px-3 py-1 text-xs">
                  <span className="font-medium">{count}</span> {status.toLowerCase()}
                </span>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
