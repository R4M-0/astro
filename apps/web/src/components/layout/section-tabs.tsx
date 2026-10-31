'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { locateNav, useNavVisibility } from './nav-config';
import { groupItemsInOrder, useSidebarLayout } from './sidebar-layout';

/**
 * Tab bar of the current sidebar group (Contexte, Support, RH…): one tab per page of the group,
 * in the user's sidebar order, the page the route belongs to underlined in the group colour.
 * Renders nothing on ungrouped pages (dashboard, my space, surveys…).
 * ← / → move to the previous / next tab, unless the user is typing or a dialog/menu is open.
 */
export function SectionTabs() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const { layout } = useSidebarLayout();
  const visible = useNavVisibility();
  const activeRef = useRef<HTMLAnchorElement>(null);

  const location = locateNav(pathname);
  const group = location?.group;

  // keep the active tab visible when the bar scrolls horizontally (narrow screens, long groups)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [location?.item.href]);

  const groupIndex = location && group?.key ? location.groupIndex : -1;
  const items = groupIndex >= 0 ? groupItemsInOrder(groupIndex, layout).filter(visible.item) : [];
  const activeHref = location?.item.href;

  useEffect(() => {
    // re-derived here so the listener depends on the stable group index, not a fresh array
    const items = groupIndex >= 0 ? groupItemsInOrder(groupIndex, layout).filter(visible.item) : [];
    if (items.length < 2) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isArrowKeyBusy(e.target)) return;
      const index = items.findIndex((item) => item.href === activeHref);
      if (index < 0) return;
      const next = items[(index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
      e.preventDefault();
      router.push(next.href);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [groupIndex, layout, visible, activeHref, router]);

  if (!location || !group?.key) return null;
  const GroupIcon = group.icon;

  return (
    <nav
      aria-label={t(group.key)}
      style={{ '--grp': group.color } as React.CSSProperties}
      className="sticky top-14 z-20 flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-border/70 bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/65 [scrollbar-width:none]"
    >
      <span className="mr-2 flex shrink-0 items-center gap-2 border-r pr-4 text-sm font-semibold text-foreground/80">
        {GroupIcon && <GroupIcon className="size-[18px] text-[var(--grp)]" />}
        {t(group.key)}
      </span>
      {items.map((item) => {
        const active = item.href === location.item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            ref={active ? activeRef : undefined}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden className={cn('size-4', active ? 'text-[var(--grp)]' : 'opacity-70')} />
            {t(item.key)}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--grp)] transition-opacity',
                active ? 'opacity-100' : 'opacity-0',
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}

/** True when ← / → already mean something where the key was pressed (text entry, sliders, menus, dialogs, canvases…). */
function isArrowKeyBusy(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="grid"], [role="tree"], [role="combobox"], .react-flow',
    ),
  );
}
