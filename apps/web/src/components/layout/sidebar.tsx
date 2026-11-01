'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Check,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cloneElement, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { locateNav, useNavVisibility, NAV_GROUPS, type NavGroup, type NavItem } from './nav-config';
import { createStoredValue, groupKeyOf, lastVisitedStore, useHydrated, useLastVisited, useSidebarLayout } from './sidebar-layout';

const COLLAPSED_KEY = 'astro.sidebar.collapsed';
const collapsedStore = createStoredValue(COLLAPSED_KEY, (raw) => raw === '1', false, 'astro:sidebar-collapsed');

/** True when the keyboard event originates from a text-editing surface. */
function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** Inline transform string (avoids a direct @dnd-kit/utilities dependency). */
function sortableStyle(
  transform: { x: number; y: number } | null,
  transition: string | undefined,
): React.CSSProperties {
  return {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
}

/** Give an icon-only link an accessible name without changing its markup. */
function cloneWithLabel(el: React.ReactElement<{ 'aria-label'?: string }>, label: string) {
  return cloneElement(el, { 'aria-label': label });
}

interface RowProps {
  item: NavItem;
  group: NavGroup;
  active: boolean;
  collapsed: boolean;
  editing: boolean;
  favorited: boolean;
  onToggleFavorite: (href: string) => void;
  /** dnd id for this row; when set the row becomes sortable */
  sortableId?: string;
}

/** A single nav link — reused in favorites, groups and the collapsed rail. */
function NavRow({
  item,
  group,
  active,
  collapsed,
  editing,
  favorited,
  onToggleFavorite,
  sortableId,
}: RowProps) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const Icon = item.icon;

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: sortableId ?? item.href, disabled: !editing || !sortableId });
  const style = sortableId
    ? sortableStyle(transform, transition)
    : undefined;

  const body = (
    <>
      {/* active accent bar */}
      <span
        className={cn(
          'absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--grp)] transition-opacity duration-150',
          active && !editing ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* tinted icon tile in the group colour — gives each row presence and fills the rail */}
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
          active
            ? 'bg-[var(--grp)] text-white shadow-sm'
            : 'bg-[color-mix(in_oklab,var(--grp)_13%,transparent)] text-[var(--grp)] group-hover/item:bg-[color-mix(in_oklab,var(--grp)_22%,transparent)]',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      {!collapsed && <span className="line-clamp-2 leading-snug">{t(item.key)}</span>}
    </>
  );

  // ---- edit mode: static row with drag handle + pin toggle (no navigation) ----
  if (editing) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'group/item relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]',
          'bg-sidebar-accent/40 text-sidebar-foreground/85',
          isDragging && 'z-10 opacity-80 shadow-sm ring-1 ring-border',
        )}
        style={{ ...style, '--grp': group.color } as React.CSSProperties}
      >
        <button
          type="button"
          aria-label={`${tc('reorder')} — ${t(item.key)}`}
          className="-my-1 -ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-sidebar-foreground/40 hover:text-sidebar-foreground/80 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <Icon className="size-4 shrink-0 text-[var(--grp)]" aria-hidden />
        <span className="flex-1 truncate">{t(item.key)}</span>
        <button
          type="button"
          onClick={() => onToggleFavorite(item.href)}
          aria-label={`${favorited ? tc('unpinFavorite') : tc('pinFavorite')} — ${t(item.key)}`}
          aria-pressed={favorited}
          className={cn(
            '-my-1 -mr-1 flex size-6 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            favorited
              ? 'text-amber-500 hover:text-amber-600'
              : 'text-sidebar-foreground/35 hover:text-sidebar-foreground/70',
          )}
        >
          <Star className={cn('size-3.5', favorited && 'fill-current')} />
        </button>
      </div>
    );
  }

  // ---- normal mode: navigation link ----
  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      style={{ '--grp': group.color } as React.CSSProperties}
      className={cn(
        'group/item relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-[color-mix(in_oklab,var(--grp)_18%,transparent)] font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/75 hover:bg-[color-mix(in_oklab,var(--grp)_10%,transparent)] hover:text-sidebar-accent-foreground',
      )}
    >
      {body}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* collapsed rail: the tooltip is visual only, so the link carries its own name */}
        {cloneWithLabel(link, t(item.key))}
      </TooltipTrigger>
      <TooltipContent side="right">{t(item.key)}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A group block: in edit mode a sortable header + its sortable items (the item order is also the
 * order of the group's tabs); in normal mode only ungrouped blocks render this way — named groups
 * are a single button (see `Sidebar`).
 */
function GroupBlock({
  groupKey,
  group,
  items,
  editing,
  collapsed,
  pathname,
  favoriteSet,
  onToggleFavorite,
}: {
  groupKey: string;
  group: NavGroup;
  items: NavItem[];
  editing: boolean;
  collapsed: boolean;
  pathname: string;
  favoriteSet: Set<string>;
  onToggleFavorite: (href: string) => void;
}) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `grp:${groupKey}`, disabled: !editing || group.key === null });
  const style = sortableStyle(transform, transition);

  const itemNodes = items.map((item) => (
    <NavRow
      key={item.href}
      item={item}
      group={group}
      active={pathname === item.href}
      collapsed={collapsed}
      editing={editing}
      favorited={favoriteSet.has(item.href)}
      onToggleFavorite={onToggleFavorite}
      sortableId={editing ? `itm:${groupKey}:${item.href}` : undefined}
    />
  ));

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'z-10 opacity-80')}>
      {group.key && editing ? (
        <div
          style={{ '--grp': group.color } as React.CSSProperties}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60"
        >
          <button
            type="button"
            aria-label={`${tc('reorderGroup')} — ${t(group.key)}`}
            className="-my-1 -ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-sidebar-foreground/40 hover:text-sidebar-foreground/80 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
          <span className="flex-1 text-left">{t(group.key)}</span>
        </div>
      ) : null}

      <div>
        <div>
          <div
            style={{ '--grp': group.color } as React.CSSProperties}
            className={cn(
              'flex flex-col gap-0.5 py-px',
              group.key && 'ml-3 border-l border-[color-mix(in_oklab,var(--grp)_35%,var(--sidebar-border))] pl-2',
            )}
          >
            {editing ? (
              <SortableContext
                items={items.map((it) => `itm:${groupKey}:${it.href}`)}
                strategy={verticalListSortingStrategy}
              >
                {itemNodes}
              </SortableContext>
            ) : (
              itemNodes
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const tc = useTranslations('common');
  const pathname = usePathname();

  // persisted collapse + last-visited state (external stores — SSR-safe defaults until hydrated)
  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.getSnapshot, collapsedStore.getServerSnapshot);
  const lastVisited = useLastVisited();
  const hydrated = useHydrated();
  const [editing, setEditing] = useState(false);

  const { hydrated: layoutHydrated, resolved: fullLayout, isDefault, reset, setGroupOrder, setItemOrder, setFavorites, toggleFavorite } =
    useSidebarLayout();
  // pages the user can't open (and add-ons the organization does not subscribe to) are left out
  const visible = useNavVisibility();
  const resolved = {
    groups: fullLayout.groups
      .filter((g) => visible.group(g.group))
      .map((g) => ({ ...g, items: g.items.filter(visible.item) })),
    favorites: fullLayout.favorites.filter((f) => visible.group(f.group) && visible.item(f.item)),
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // the route's page (and group) — drives the active group button and its "reopen" target
  const location = locateNav(pathname);
  const activeGroupIndex = location?.group.key ? location.groupIndex : -1;
  const activeItemHref = location?.item.href;
  useEffect(() => {
    if (activeGroupIndex < 0 || !activeItemHref) return;
    const key = groupKeyOf(activeGroupIndex);
    const prev = lastVisitedStore.getSnapshot();
    if (prev[key] === activeItemHref) return;
    const next = { ...prev, [key]: activeItemHref };
    lastVisitedStore.set(next, JSON.stringify(next));
  }, [activeGroupIndex, activeItemHref]);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsedStore.getSnapshot();
    collapsedStore.set(next, next ? '1' : '0');
  }, []);

  // ⌘B / Ctrl+B toggles the rail (ignored while typing — TipTap uses it for bold)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && !isTypingTarget(e)) {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCollapsed]);

  const favoriteSet = new Set(resolved.favorites.map((f) => f.item.href));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith('grp:')) {
      if (!overId.startsWith('grp:')) return;
      const order = resolved.groups.map((g) => g.key);
      const from = order.indexOf(activeId.slice(4));
      const to = order.indexOf(overId.slice(4));
      if (from >= 0 && to >= 0) setGroupOrder(arrayMove(order, from, to));
      return;
    }

    if (activeId.startsWith('fav:')) {
      if (!overId.startsWith('fav:')) return;
      const order = resolved.favorites.map((f) => f.item.href);
      const from = order.indexOf(activeId.slice(4));
      const to = order.indexOf(overId.slice(4));
      if (from >= 0 && to >= 0) setFavorites(arrayMove(order, from, to));
      return;
    }

    if (activeId.startsWith('itm:')) {
      // itm:<groupKey>:<href> — only reorder within the same group
      const parse = (id: string) => {
        const rest = id.slice(4);
        const sep = rest.indexOf(':');
        return { groupKey: rest.slice(0, sep), href: rest.slice(sep + 1) };
      };
      const a = parse(activeId);
      if (!overId.startsWith('itm:')) return;
      const o = parse(overId);
      if (a.groupKey !== o.groupKey) return;
      const g = resolved.groups.find((grp) => grp.key === a.groupKey);
      if (!g) return;
      const order = g.items.map((it) => it.href);
      const from = order.indexOf(a.href);
      const to = order.indexOf(o.href);
      if (from >= 0 && to >= 0) setItemOrder(a.groupKey, arrayMove(order, from, to));
    }
  };

  const ready = hydrated && layoutHydrated;

  const favNodes = resolved.favorites.map(({ item, group }) => (
    <NavRow
      key={item.href}
      item={item}
      group={group}
      active={pathname === item.href}
      collapsed={collapsed}
      editing={editing}
      favorited
      onToggleFavorite={toggleFavorite}
      sortableId={editing ? `fav:${item.href}` : undefined}
    />
  ));

  const groupsList = (
    <>
      {resolved.groups.map((g, gi) => {
        // A named group is one button: it reopens the page last used in the group (else its first
        // page); the group's pages are the tabs on top of the page (SectionTabs).
        // thin divider where the list switches between ungrouped shortcuts and module groups
        const prev = resolved.groups[gi - 1];
        const boundary = !!prev && !editing && !prev.group.key !== !g.group.key;
        // paid add-on modules (Environnement, SST, HACCP) get their own labelled section after the ISO clauses
        const addonStart = !!prev && !editing && !!g.group.addon && !prev.group.addon;
        const divider = addonStart ? (
          <div key={`sep:${g.key}`} className={cn('mt-2 border-t border-sidebar-border', collapsed ? 'mx-1 mb-1.5' : 'pt-2')}>
            {!collapsed && (
              <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">{tc('addonModules')}</div>
            )}
          </div>
        ) : boundary ? (
          <div key={`sep:${g.key}`} className={cn('my-1.5 border-t border-sidebar-border', collapsed && 'mx-1')} />
        ) : null;
        if (g.group.key && !editing) {
          const pages = g.group.items.filter(visible.item);
          const last = lastVisited[g.key];
          const href = pages.some((it) => it.href === last) ? last : (g.items[0] ?? pages[0]).href;
          const groupItem: NavItem = { key: g.group.key, href, icon: g.group.icon ?? pages[0].icon };
          return [
            divider,
            <NavRow
              key={g.key}
              item={groupItem}
              group={g.group}
              active={NAV_GROUPS.indexOf(g.group) === activeGroupIndex}
              collapsed={collapsed}
              editing={false}
              favorited={false}
              onToggleFavorite={toggleFavorite}
            />,
          ];
        }
        // collapsed rail: flat icon list with a subtle divider between blocks
        if (collapsed && !editing) {
          return [
            divider,
            <div key={g.key} className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  group={g.group}
                  active={pathname === item.href}
                  collapsed
                  editing={false}
                  favorited={favoriteSet.has(item.href)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>,
          ];
        }
        return [
          divider,
          <GroupBlock
            key={g.key}
            groupKey={g.key}
            group={g.group}
            items={g.items}
            editing={editing}
            collapsed={collapsed}
            pathname={pathname}
            favoriteSet={favoriteSet}
            onToggleFavorite={toggleFavorite}
          />,
        ];
      })}
    </>
  );

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex',
        collapsed && !editing ? 'w-16' : 'w-64',
      )}
    >
      {/* header + collapse toggle */}
      <div
        className={cn(
          // same height + border as the topbar so both form one continuous line
          'flex h-14 shrink-0 items-center border-b border-border/70',
          collapsed && !editing ? 'justify-center px-2' : 'gap-2 px-3',
        )}
      >
        {collapsed && !editing ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={tc('openMenu')}
                aria-expanded={false}
                className="group/logo relative flex size-10 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/constella.svg"
                  alt=""
                  className="size-9 object-contain transition-opacity duration-150 group-hover/logo:opacity-0 group-focus-visible/logo:opacity-0"
                />
                <PanelLeftOpen aria-hidden className="absolute size-4 text-sidebar-foreground opacity-0 transition-opacity duration-150 group-hover/logo:opacity-100 group-focus-visible/logo:opacity-100" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-1.5">
              {tc('expandShort')}
              <kbd className="rounded border border-border/50 bg-muted/50 px-1 font-mono text-[10px]">⌘B</kbd>
            </TooltipContent>
          </Tooltip>
        ) : (
          <>
            <span className="flex size-9 shrink-0 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/constella.svg" alt="" className="size-9 object-contain" />
            </span>
            <span className={cn('flex-1 font-semibold tracking-tight', editing ? 'text-sm' : 'text-lg')}>
              {editing ? tc('customizeMenu') : 'Constella'}
            </span>
            {!editing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label={tc('customizeMenu')}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{tc('customizeMenu')}</TooltipContent>
              </Tooltip>
            )}
            {!editing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label={tc('collapseMenu')}
                    aria-expanded
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  >
                    <PanelLeftClose className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex items-center gap-1.5">
                  {tc('collapseShort')}
                  <kbd className="rounded border border-border/50 bg-muted/50 px-1 font-mono text-[10px]">⌘B</kbd>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-3">
        {editing ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <nav aria-label={tc('mainNavigation')} className="flex flex-col gap-1.5">
              {ready && (
                <>
                  {/* favorites (editable) */}
                  <div className="flex flex-col gap-0.5">
                    <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
                      {tc('favorites')}
                    </div>
                    {resolved.favorites.length === 0 ? (
                      <p className="px-2 pb-1 text-[11px] leading-snug text-sidebar-foreground/40">
                        {tc('favoritesHint')}
                      </p>
                    ) : (
                      <SortableContext
                        items={resolved.favorites.map((f) => `fav:${f.item.href}`)}
                        strategy={verticalListSortingStrategy}
                      >
                        {favNodes}
                      </SortableContext>
                    )}
                  </div>
                  <div className="my-1 border-t border-sidebar-border" />
                  <SortableContext
                    items={resolved.groups.map((g) => `grp:${g.key}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    {groupsList}
                  </SortableContext>
                </>
              )}
            </nav>
          </DndContext>
        ) : (
          <nav aria-label={tc('mainNavigation')} className="flex flex-col gap-0.5">
            {ready && (
              <>
                {resolved.favorites.length > 0 && (
                  <>
                    <div className="flex flex-col gap-0.5">
                      {!collapsed && (
                        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
                          <Star className="size-3 fill-current text-amber-500" />
                          {tc('favorites')}
                        </div>
                      )}
                      {favNodes}
                    </div>
                    <div className={cn('my-1 border-t border-sidebar-border', collapsed && 'mx-1')} />
                  </>
                )}
                {groupsList}
              </>
            )}
          </nav>
        )}
      </ScrollArea>

      {/* edit-mode footer: reset to default + done */}
      {editing && (
        <div className="flex items-center gap-2 border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={reset}
            disabled={isDefault}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[12px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" />
            {tc('resetToDefault')}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Check className="size-3.5" />
            {tc('done')}
          </button>
        </div>
      )}
    </aside>
  );
}
