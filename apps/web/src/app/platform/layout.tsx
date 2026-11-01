'use client';

import { Building2, KeyRound, LayoutDashboard, LogOut, Moon, ScrollText, ShieldCheck, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiPost } from '@/lib/api';
import { SELF_HOSTED } from '@/lib/deployment';
import { cn } from '@/lib/utils';
import { useSession } from '@/stores/session';

const NAV = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/platform/organizations', label: 'Organizations', icon: Building2 },
  { href: '/platform/licenses', label: 'Self-hosted licenses', icon: KeyRound },
  { href: '/platform/audit', label: 'Audit log', icon: ScrollText },
];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const initialize = useSession((s) => s.initialize);
  const clear = useSession((s) => s.clear);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (status === 'loading') void initialize();
  }, [status, initialize]);

  useEffect(() => {
    // self-hosted installs have no platform staff area (its API routes do not exist)
    if (SELF_HOSTED) router.replace('/dashboard');
    else if (status === 'unauthenticated') router.replace('/login');
    else if (status === 'authenticated' && user && !user.isSuperAdmin) router.replace('/dashboard');
  }, [status, user, router]);

  const signOut = async () => {
    try { await apiPost('/auth/logout'); } finally { clear(); router.push('/login'); }
  };

  if (status !== 'authenticated' || !user?.isSuperAdmin) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Skeleton className="h-32 w-80" />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh bg-muted/20">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Constella</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Platform admin</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                <Icon className="size-4" /> {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Avatar className="size-7"><AvatarFallback className="text-[10px]">{(user.firstName[0] ?? '') + (user.lastName[0] ?? '')}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{user.firstName} {user.lastName}</p>
              <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-sm font-semibold">Platform</span>
          </div>
          <div className="hidden text-sm text-muted-foreground md:block">Constella platform administration</div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Sun className="size-4 dark:hidden" />
              <Moon className="hidden size-4 dark:block" />
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        </header>
        {/* mobile nav */}
        <div className="flex gap-1 overflow-x-auto border-b bg-background px-2 py-1.5 md:hidden">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm', active ? 'bg-accent font-medium' : 'text-muted-foreground')}>
                {item.label}
              </Link>
            );
          })}
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
