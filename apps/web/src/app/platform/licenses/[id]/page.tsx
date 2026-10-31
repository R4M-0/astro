'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { LICENSE_PHASE_STYLE, licensePhase, type IssuedLicense } from '@/components/license/issued-license';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiGet } from '@/lib/api';
import { useNow } from '@/lib/use-now';

type Ref = { id: string; reference: string; expiresAt: string };
interface Detail extends IssuedLicense {
  token: string;
  supersedes: Ref | null;
  renewals: (Ref & { createdAt: string })[];
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function LicenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const now = useNow(60_000);
  const { data: l, isLoading } = useQuery({ queryKey: ['platform-license', id], queryFn: () => apiGet<Detail>(`/platform/licenses/${id}`) });

  if (isLoading || !l) return <div className="mx-auto max-w-4xl space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;

  const phase = licensePhase(l, now);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(l.token);
      toast.success('License key copied');
    } catch {
      toast.error('Copy failed — select the key and copy it manually');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${l.token}\n`], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${l.reference}.lic` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const facts: [string, React.ReactNode][] = [
    ['Plan', <span key="p" className="capitalize">{l.plan}</span>],
    ['Accounts', l.seatLimit],
    ['Organizations', l.orgLimit],
    ['Add-ons', l.addons.length ? l.addons.join(', ') : '—'],
    ['Storage / organization', l.storageLimitMb != null ? `${l.storageLimitMb} MB` : 'Plan default'],
    ['Validity', `${day(l.startsAt)} → ${day(l.expiresAt)}`],
    ['Grace period', `${l.graceDays} days`],
    ['Updates until', day(l.updatesUntil)],
    ['Instance', l.instanceId ?? 'Any installation'],
    ['Issued', `${day(l.createdAt)}${l.issuedByEmail ? ` by ${l.issuedByEmail}` : ''}`],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/platform/licenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Licenses
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{l.reference}</span>
            <Badge variant="outline" className={LICENSE_PHASE_STYLE[phase]}>{phase}</Badge>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{l.customer}</h1>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/platform/licenses/new?from=${l.id}`}><RefreshCw className="size-4" /> Renew</Link>
        </Button>
      </div>

      <Card className="p-5">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed py-1 last:border-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
        {l.notes && <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{l.notes}</p>}
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">License key</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copy}><Copy className="size-3.5" /> Copy</Button>
            <Button size="sm" onClick={download}><Download className="size-3.5" /> Download .lic</Button>
          </div>
        </div>
        <Textarea readOnly value={l.token} rows={5} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <p className="text-xs text-muted-foreground">
          The customer installs it in Administration → Licence, or mounts it as <code className="rounded bg-muted px-1">/etc/astro/license.lic</code>.
        </p>
      </Card>

      {(l.supersedes || l.renewals.length > 0) && (
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="font-medium">Renewal chain</h2>
          {l.supersedes && (
            <p>Renews <Link className="font-mono hover:underline" href={`/platform/licenses/${l.supersedes.id}`}>{l.supersedes.reference}</Link> (expired {day(l.supersedes.expiresAt)})</p>
          )}
          {l.renewals.map((r) => (
            <p key={r.id}>Renewed by <Link className="font-mono hover:underline" href={`/platform/licenses/${r.id}`}>{r.reference}</Link> (until {day(r.expiresAt)})</p>
          ))}
        </Card>
      )}
    </div>
  );
}
