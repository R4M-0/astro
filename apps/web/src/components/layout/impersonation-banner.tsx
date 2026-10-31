'use client';

import { ShieldAlert, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useSession } from '@/stores/session';

/**
 * Persistent banner shown while a Super Admin is impersonating an org user for
 * support. Always visible; "Exit" restores the Super Admin session.
 */
export function ImpersonationBanner() {
  const impersonation = useSession((s) => s.impersonation);
  const exitImpersonation = useSession((s) => s.exitImpersonation);
  const router = useRouter();

  if (!impersonation) return null;

  const exit = async () => {
    await exitImpersonation();
    router.push('/platform/organizations');
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
      <span className="inline-flex items-center gap-1.5">
        <ShieldAlert className="size-3.5" />
        Support access — you are viewing <b>{impersonation.user.firstName} {impersonation.user.lastName}</b>&rsquo;s account in <b>{impersonation.organization.name}</b>.
      </span>
      <Button size="sm" variant="outline" className="h-6 border-amber-950/30 bg-amber-100 px-2 text-amber-950 hover:bg-amber-50" onClick={exit}>
        <X className="size-3" /> Exit impersonation
      </Button>
    </div>
  );
}
