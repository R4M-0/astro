'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Copy, KeyRound, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { LICENSE_PHASE_STYLE, licensePhase, type IssuedLicense } from '@/components/license/issued-license';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { useNow } from '@/lib/use-now';

export default function LicensesPage() {
  const now = useNow(60_000);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['platform-licenses', search],
    queryFn: () => apiGet<IssuedLicense[]>(`/platform/licenses${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`),
  });
  const key = useQuery({
    queryKey: ['platform-license-key'],
    queryFn: () => apiGet<{ configured: boolean; publicKeyPem: string | null }>('/platform/licenses/signing-key'),
  });

  const copyKey = async () => {
    if (!key.data?.publicKeyPem) return;
    try {
      await navigator.clipboard.writeText(key.data.publicKeyPem);
      toast.success('Public key copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Self-hosted licenses</h1>
          <p className="text-sm text-muted-foreground">Signed license keys for customers running Constella on their own servers.</p>
        </div>
        {key.data?.configured && (
          <Button asChild><Link href="/platform/licenses/new"><Plus className="size-4" /> Issue license</Link></Button>
        )}
      </div>

      {key.data && !key.data.configured && (
        <Card className="flex items-start gap-3 border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>
            Signing is not configured. Generate a key pair with <code className="rounded bg-muted px-1">pnpm --filter @astro/api license keygen</code>,
            set <code className="rounded bg-muted px-1">LICENSE_SIGNING_KEY</code> on this server and build the self-hosted images with the matching public key.
          </p>
        </Card>
      )}
      {key.data?.publicKeyPem && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <span>Self-hosted images must be built with this public key (<code className="rounded bg-muted px-1">LICENSE_PUBLIC_KEY</code> build arg).</span>
          </div>
          <Button variant="outline" size="sm" onClick={copyKey}><Copy className="size-3.5" /> Copy public key</Button>
        </Card>
      )}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer or reference…" className="pl-8" />
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Accounts</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
            ))}
            {data?.map((l) => {
              const phase = licensePhase(l, now);
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link href={`/platform/licenses/${l.id}`} className="font-mono text-xs font-medium hover:underline">{l.reference}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/platform/licenses/${l.id}`} className="font-medium hover:underline">{l.customer}</Link>
                    {l.instanceId && <span className="block text-xs text-muted-foreground">bound to {l.instanceId}</span>}
                  </TableCell>
                  <TableCell className="capitalize">{l.plan}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.seatLimit}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(l.expiresAt).toLocaleDateString()}</TableCell>
                  <TableCell><Badge variant="outline" className={LICENSE_PHASE_STYLE[phase]}>{phase}</Badge></TableCell>
                </TableRow>
              );
            })}
            {data && data.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No licenses issued yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
