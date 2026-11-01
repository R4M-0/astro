'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AddonLocked } from '@/components/billing/addons';
import { CommandPalette } from '@/components/layout/command-palette';
import { ImpersonationBanner } from '@/components/layout/impersonation-banner';
import { LicenseBanner } from '@/components/license/license-banner';
import { lockedAddonOf, requiredPermissionFor } from '@/components/layout/nav-config';
import { NoAccess } from '@/components/layout/no-access';
import { SectionTabs } from '@/components/layout/section-tabs';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { Skeleton } from '@/components/ui/skeleton';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/stores/session';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslations('common');
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const organizationId = useSession((s) => s.organizationId);
  const impersonation = useSession((s) => s.impersonation);
  const initialize = useSession((s) => s.initialize);
  const addons = useSession((s) => s.addons);
  const permissions = useSession((s) => s.permissions);
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useRealtime();

  useEffect(() => {
    if (status === 'loading') void initialize();
  }, [status, initialize]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    // a super admin with no org (and not impersonating) belongs in the platform area
    else if (status === 'authenticated' && user?.isSuperAdmin && !impersonation && !organizationId) {
      router.replace('/platform');
    }
  }, [status, user, organizationId, impersonation, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-svh">
        <div className="hidden w-60 border-r bg-sidebar p-4 md:block">
          <Skeleton className="h-8 w-32" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-10 w-64" />
          <div className="mt-6 grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // paid add-on module the organization does not subscribe to → upsell page instead of the module
  const lockedAddon = lockedAddonOf(pathname, addons);
  // a page the member's role cannot open (deep link, stale bookmark) → explain instead of firing forbidden requests
  const needed = requiredPermissionFor(pathname);
  const forbidden = !!needed && !needed.some((p) => permissions.includes(p));

  return (
    <div className="flex min-h-svh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {t('skipToContent')}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ImpersonationBanner />
        <LicenseBanner />
        <Topbar onOpenPalette={() => setPaletteOpen(true)} />
        {!lockedAddon && <SectionTabs />}
        <main id="main-content" tabIndex={-1} className="min-w-0 focus:outline-none flex-1 overflow-y-auto bg-background bg-[radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--primary)_9%,transparent),transparent_55%),radial-gradient(100%_70%_at_0%_0%,color-mix(in_oklab,var(--chart-2)_8%,transparent),transparent_50%)]">
          {lockedAddon ? <AddonLocked addon={lockedAddon} /> : forbidden ? <NoAccess /> : children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
