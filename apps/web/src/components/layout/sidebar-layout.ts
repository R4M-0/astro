'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { NAV_GROUPS, type NavGroup, type NavItem } from './nav-config';

/**
 * Per-browser sidebar personalisation (order + favorites).
 *
 * The "current" hard-coded {@link NAV_GROUPS} is always the default: an empty /
 * missing layout resolves to exactly that arrangement, and {@link resetLayout}
 * clears the stored overrides so the user can go back to it at any time. Stored
 * overrides are applied on top and are tolerant of nav-config changes — items or
 * groups added in code that the saved layout has never seen are appended in their
 * default position rather than dropped.
 */
export interface SidebarLayout {
  /** group keys in display order */
  groupOrder: string[];
  /** groupKey -> item hrefs in display order */
  itemOrder: Record<string, string[]>;
  /** item hrefs pinned to the Favorites section, in display order */
  favorites: string[];
}

export const LAYOUT_KEY = 'astro.sidebar.layout';
/** Fired on window when the layout changes, so the sidebar and the section tabs stay in sync. */
const LAYOUT_EVENT = 'astro:sidebar-layout';

/** Stable key for a group (its i18n key, or a positional key for ungrouped blocks). */
export function groupKeyOf(index: number): string {
  return NAV_GROUPS[index].key ?? `_${index}`;
}

export const EMPTY_LAYOUT: SidebarLayout = { groupOrder: [], itemOrder: {}, favorites: [] };

/** A group with its items already resolved into final display order. */
export interface ResolvedGroup {
  key: string;
  group: NavGroup;
  items: NavItem[];
}

export interface ResolvedLayout {
  favorites: { item: NavItem; group: NavGroup }[];
  groups: ResolvedGroup[];
}

/** Index every nav item by href, remembering its owning group + group key. */
function indexItems() {
  const byHref = new Map<string, { item: NavItem; group: NavGroup; groupKey: string }>();
  NAV_GROUPS.forEach((group, gi) => {
    const groupKey = groupKeyOf(gi);
    group.items.forEach((item) => byHref.set(item.href, { item, group, groupKey }));
  });
  return byHref;
}

/**
 * Merge a stored order with the canonical order: keep the stored sequence for
 * anything still known, drop unknown entries, and append canonical entries the
 * stored order has never seen (so new nav items surface instead of vanishing).
 */
function mergeOrder(stored: string[] | undefined, canonical: string[]): string[] {
  const known = new Set(canonical);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of stored ?? []) {
    if (known.has(key) && !seen.has(key)) {
      out.push(key);
      seen.add(key);
    }
  }
  for (const key of canonical) {
    if (!seen.has(key)) out.push(key);
  }
  return out;
}

/** Resolve a stored layout into the concrete groups/favorites the sidebar renders. */
export function resolveLayout(layout: SidebarLayout): ResolvedLayout {
  const byHref = indexItems();
  const canonicalGroupKeys = NAV_GROUPS.map((_, i) => groupKeyOf(i));

  // Favorites: keep stored order, skip unknown hrefs, de-dup.
  const favSeen = new Set<string>();
  const favorites: { item: NavItem; group: NavGroup }[] = [];
  for (const href of layout.favorites ?? []) {
    const entry = byHref.get(href);
    if (entry && !favSeen.has(href)) {
      favorites.push({ item: entry.item, group: entry.group });
      favSeen.add(href);
    }
  }

  const groupOrder = mergeOrder(layout.groupOrder, canonicalGroupKeys);
  const groups: ResolvedGroup[] = groupOrder.map((key) => {
    const gi = canonicalGroupKeys.indexOf(key);
    const group = NAV_GROUPS[gi];
    const canonicalItemHrefs = group.items.map((it) => it.href);
    const orderedHrefs = mergeOrder(layout.itemOrder?.[key], canonicalItemHrefs);
    const items = orderedHrefs
      .filter((href) => !favSeen.has(href)) // pinned items live in Favorites only
      .map((href) => group.items.find((it) => it.href === href)!)
      .filter(Boolean);
    return { key, group, items };
  });

  return { favorites, groups };
}

/** Every item of a group in the user's order — favorites included (used by the section tabs). */
export function groupItemsInOrder(groupIndex: number, layout: SidebarLayout): NavItem[] {
  const group = NAV_GROUPS[groupIndex];
  const hrefs = mergeOrder(layout.itemOrder?.[groupKeyOf(groupIndex)], group.items.map((it) => it.href));
  return hrefs.map((href) => group.items.find((it) => it.href === href)!).filter(Boolean);
}

/**
 * A value persisted in localStorage, exposed as an external store for `useSyncExternalStore`
 * (server snapshot = the default, so SSR / hydration always render the default first).
 * The snapshot is cached per raw string so it stays referentially stable; when storage is
 * unavailable a write is kept in memory instead.
 */
export function createStoredValue<T>(key: string, parse: (raw: string | null) => T, fallback: T, event: string) {
  let cachedRaw: string | null | undefined;
  let cached = fallback;
  let memory: { value: T } | null = null;

  const subscribe = (onChange: () => void) => {
    window.addEventListener(event, onChange);
    return () => window.removeEventListener(event, onChange);
  };
  const getSnapshot = (): T => {
    if (memory) return memory.value;
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        cached = parse(raw);
      } catch {
        cached = fallback; // corrupted — start fresh
      }
    }
    return cached;
  };
  const getServerSnapshot = () => fallback;
  /** Persist `value` (`raw` = its serialised form, null removes the key) and notify subscribers. */
  const set = (value: T, raw: string | null) => {
    try {
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
      memory = null;
    } catch {
      memory = { value }; // storage unavailable — keep in-memory state
    }
    window.dispatchEvent(new Event(event));
  };
  return { subscribe, getSnapshot, getServerSnapshot, set };
}

function parseLayout(raw: string | null): SidebarLayout {
  if (!raw) return EMPTY_LAYOUT;
  const parsed = JSON.parse(raw) as Partial<SidebarLayout>;
  return {
    groupOrder: Array.isArray(parsed.groupOrder) ? parsed.groupOrder : [],
    itemOrder: parsed.itemOrder && typeof parsed.itemOrder === 'object' ? parsed.itemOrder : {},
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
  };
}

const layoutStore = createStoredValue(LAYOUT_KEY, parseLayout, EMPTY_LAYOUT, LAYOUT_EVENT);

const noopSubscribe = () => () => {};
/** False during SSR / hydration, true once rendering on the client. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** True when the layout has no user overrides (i.e. equals the built-in default). */
export function isDefaultLayout(layout: SidebarLayout): boolean {
  return (
    layout.groupOrder.length === 0 &&
    layout.favorites.length === 0 &&
    Object.keys(layout.itemOrder).length === 0
  );
}

/**
 * Layout state hook. Reads from localStorage via an external store (SSR-safe), persists on
 * every mutation, and exposes the resolved structure plus mutators.
 */
export function useSidebarLayout() {
  const layout = useSyncExternalStore(layoutStore.subscribe, layoutStore.getSnapshot, layoutStore.getServerSnapshot);
  const hydrated = useHydrated();

  const persist = useCallback((next: SidebarLayout) => {
    layoutStore.set(next, isDefaultLayout(next) ? null : JSON.stringify(next));
  }, []);

  const resolved = useMemo(() => resolveLayout(layout), [layout]);

  const reset = useCallback(() => persist(EMPTY_LAYOUT), [persist]);

  const setGroupOrder = useCallback(
    (groupOrder: string[]) => persist({ ...layout, groupOrder }),
    [layout, persist],
  );

  const setItemOrder = useCallback(
    (groupKey: string, hrefs: string[]) =>
      persist({ ...layout, itemOrder: { ...layout.itemOrder, [groupKey]: hrefs } }),
    [layout, persist],
  );

  const setFavorites = useCallback(
    (favorites: string[]) => persist({ ...layout, favorites }),
    [layout, persist],
  );

  const toggleFavorite = useCallback(
    (href: string) => {
      const has = layout.favorites.includes(href);
      const favorites = has
        ? layout.favorites.filter((h) => h !== href)
        : [...layout.favorites, href];
      persist({ ...layout, favorites });
    },
    [layout, persist],
  );

  return {
    hydrated,
    layout,
    resolved,
    isDefault: isDefaultLayout(layout),
    reset,
    setGroupOrder,
    setItemOrder,
    setFavorites,
    toggleFavorite,
  };
}

/** groupKey → href of the page last opened in that group (the group button reopens it). */
export const LAST_VISITED_KEY = 'astro.sidebar.lastVisited';
const NO_LAST_VISITED: Record<string, string> = {};
export const lastVisitedStore = createStoredValue<Record<string, string>>(
  LAST_VISITED_KEY,
  (raw) => JSON.parse(raw ?? '{}'),
  NO_LAST_VISITED,
  'astro:sidebar-last-visited',
);

/** Last page opened in each nav group (SSR-safe: empty until hydrated). */
export function useLastVisited(): Record<string, string> {
  return useSyncExternalStore(lastVisitedStore.subscribe, lastVisitedStore.getSnapshot, lastVisitedStore.getServerSnapshot);
}
