'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { Bell, Check, Globe, LogOut, Moon, Search, Settings, Sun, User, Volume2, VolumeX } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { fr as frLocale, enUS } from 'date-fns/locale';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { setSoundEnabled, soundEnabled } from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { MobileNav } from './mobile-nav';
import { useFallbackPoll } from '@/lib/realtime';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const noopSubscribe = () => () => {};

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const t = useTranslations('common');
  const pollSlow = useFallbackPoll(30_000);
  const locale = useLocale();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiGet<{ count: number }>('/notifications/unread-count'),
    refetchInterval: pollSlow,
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => apiGet<Notification[]>('/notifications'),
  });

  // stored preference (SSR-safe: on until hydrated); a toggle wins even if storage is unavailable
  const storedSound = useSyncExternalStore(noopSubscribe, soundEnabled, () => true);
  const [soundOverride, setSoundOverride] = useState<boolean | null>(null);
  const sound = soundOverride ?? storedSound;
  const toggleSound = () => { const next = !sound; setSoundOverride(next); setSoundEnabled(next); };

  const [notifOpen, setNotifOpen] = useState(false);
  const markRead = useMutation({
    mutationFn: (id: string) => apiPatch(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const openNotification = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) {
      setNotifOpen(false);
      router.push(n.link);
    }
  };

  const markAllRead = useMutation({
    mutationFn: () => apiPatch('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const setLocale = (next: string) => {
    document.cookie = `astro.locale=${next};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  };

  const logout = async () => {
    try {
      await apiPost('/auth/logout');
    } finally {
      clear();
      router.push('/login');
    }
  };

  const unreadCount = unread?.count ?? 0;
  const isDark = resolvedTheme === 'dark';
  const initials = user ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() : '·';
  const dateLocale = locale === 'fr' ? frLocale : enUS;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
      <MobileNav />
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenPalette}
        className="group w-80 justify-start gap-2 bg-background font-normal text-muted-foreground shadow-none hover:text-foreground max-md:w-auto"
      >
        <Search className="size-4 transition-colors group-hover:text-foreground" />
        <span className="max-md:hidden">{t('searchShortcut')}</span>
        <kbd className="ml-auto hidden rounded-[3px] border border-keyline/40 bg-card px-1.5 font-mono text-[10px] font-semibold text-foreground/70 md:inline-block">
          ⌘K
        </kbd>
      </Button>

      <div className="flex-1" />

      {/* language */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('language')}>
            <Globe className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setLocale('fr')}>
            Français {locale === 'fr' && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocale('en')}>
            English {locale === 'en' && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* theme */}
      <Button
        variant="ghost"
        size="icon"
        aria-label={isDark ? t('switchToLight') : t('switchToDark')}
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
      >
        <Sun className="size-4 dark:hidden" />
        <Moon className="hidden size-4 dark:block" />
      </Button>

      {/* notifications */}
      <Popover open={notifOpen} onOpenChange={setNotifOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={t('unreadNotifications', { count: unreadCount })}
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <CountBadge count={unreadCount} className="bg-destructive text-destructive-foreground" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">{t('notifications')}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={sound ? t('soundOn') : t('soundOff')}
                aria-label={sound ? t('soundOn') : t('soundOff')}
                aria-pressed={sound}
                onClick={toggleSound}
              >
                {sound ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={unreadCount === 0 || markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
              >
                <Check className="size-3.5" /> {t('markAllRead')}
              </Button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!notifications?.length && (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <Bell className="size-5 text-muted-foreground/60" aria-hidden />
                <p className="text-sm text-muted-foreground">{t('noNotifications')}</p>
              </div>
            )}
            {notifications?.map((n) => (
              <button
                key={n.id}
                onClick={() => openNotification(n)}
                className={cn(
                  'relative flex w-full flex-col gap-0.5 border-b px-3 py-2.5 pl-6 text-left transition-colors last:border-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                  !n.readAt && 'bg-primary/5',
                )}
              >
                {!n.readAt && (
                  <span className="absolute left-2.5 top-[1.05rem] size-1.5 rounded-full bg-primary" aria-hidden />
                )}
                <span className={cn('text-sm', !n.readAt ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                <span className="text-[10px] text-muted-foreground/70">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: dateLocale })}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs"
              onClick={() => {
                setNotifOpen(false);
                router.push('/notifications');
              }}
            >
              {t('viewAllNotifications')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* user */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 px-2">
            <Avatar className="size-7 rounded-[3px]">
              <AvatarFallback className="rounded-[3px] bg-foreground text-xs font-bold text-background">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm max-lg:hidden">{user?.firstName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="flex flex-col">
            <span>
              {user?.firstName} {user?.lastName}
            </span>
            <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            <User className="size-4" /> {t('profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            <Settings className="size-4" /> {t('settings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={logout}>
            <LogOut className="size-4" /> {t('logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

/** Unread counter pinned to the corner of an icon button; caps at 99+. */
function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums ring-2 ring-background',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
