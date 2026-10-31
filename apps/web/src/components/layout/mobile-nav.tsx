'use client';

import { Menu, Star } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { locateNav, useNavVisibility, NAV_GROUPS, type NavGroup, type NavItem } from './nav-config';
import { useLastVisited, useSidebarLayout } from './sidebar-layout';

function MobileRow({
  item,
  group,
  active,
  onNavigate,
}: {
  item: NavItem;
  group: NavGroup;
  active: boolean;
  onNavigate: () => void;
}) {
  const t = useTranslations('nav');
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      style={{ '--grp': group.color } as React.CSSProperties}
      className={cn(
        'group/item relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-[color-mix(in_oklab,var(--grp)_18%,transparent)] font-medium text-foreground'
          : 'text-muted-foreground hover:bg-[color-mix(in_oklab,var(--grp)_10%,transparent)] hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--grp)]',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          active
            ? 'bg-[var(--grp)] text-white shadow-sm'
            : 'bg-[color-mix(in_oklab,var(--grp)_13%,transparent)] text-[var(--grp)]',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="line-clamp-2 leading-snug">{t(item.key)}</span>
    </Link>
  );
}

/**
 * Drawer navigation for < md screens; the fixed sidebar handles md+. Mirrors the sidebar: favorites,
 * ungrouped shortcuts as links, and each named group as one button that reopens its last-used page
 * (the group's pages are the section tabs under the topbar).
 */
export function MobileNav() {
  const tc = useTranslations('common');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // the desktop sidebar (mounted but hidden on mobile) records last-visited pages
  const lastVisited = useLastVisited();

  const { hydrated, resolved: fullLayout } = useSidebarLayout();
  // pages the user can't open (and add-ons the organization does not subscribe to) are left out
  const visible = useNavVisibility();
  const groups = fullLayout.groups
    .filter((g) => visible.group(g.group))
    .map((g) => ({ ...g, items: g.items.filter(visible.item) }));
  const favorites = fullLayout.favorites.filter((f) => visible.group(f.group) && visible.item(f.item));

  const location = locateNav(pathname);
  const activeGroupIndex = location?.group.key ? location.groupIndex : -1;
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={tc('openMenu')}>
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <span className="flex size-6 items-center justify-center overflow-hidden rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon.ico" alt="" className="size-6 object-contain" />
            </span>
            Astro
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100svh-3.5rem)] px-2 py-3">
          <nav aria-label={tc('mainNavigation')} className="flex flex-col gap-0.5">
            {hydrated && (
              <>
                {favorites.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <Star className="size-3 fill-current text-amber-500" />
                      {tc('favorites')}
                    </div>
                    {favorites.map(({ item, group }) => (
                      <MobileRow
                        key={`fav:${item.href}`}
                        item={item}
                        group={group}
                        active={pathname === item.href}
                        onNavigate={close}
                      />
                    ))}
                    <div className="my-1 border-t" />
                  </>
                )}
                {groups.map((g, gi) => {
                  const prev = groups[gi - 1];
                  const boundary = !!prev && !prev.group.key !== !g.group.key;
                  const addonStart = !!prev && !!g.group.addon && !prev.group.addon;
                  const divider = addonStart ? (
                    <div key={`sep:${g.key}`} className="mt-2 border-t pt-2">
                      <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {tc('addonModules')}
                      </div>
                    </div>
                  ) : boundary ? (
                    <div key={`sep:${g.key}`} className="my-1.5 border-t" />
                  ) : null;

                  if (g.group.key) {
                    const pages = g.group.items.filter(visible.item);
                    const last = lastVisited[g.key];
                    const href = pages.some((it) => it.href === last) ? last : (g.items[0] ?? pages[0]).href;
                    const groupItem: NavItem = { key: g.group.key, href, icon: g.group.icon ?? pages[0].icon };
                    return [
                      divider,
                      <MobileRow
                        key={g.key}
                        item={groupItem}
                        group={g.group}
                        active={NAV_GROUPS.indexOf(g.group) === activeGroupIndex}
                        onNavigate={close}
                      />,
                    ];
                  }
                  return [
                    divider,
                    ...g.items.map((item) => (
                      <MobileRow
                        key={item.href}
                        item={item}
                        group={g.group}
                        active={pathname === item.href}
                        onNavigate={close}
                      />
                    )),
                  ];
                })}
              </>
            )}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
