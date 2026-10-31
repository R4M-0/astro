/**
 * Paid add-on modules, sold on top of any plan. An organization only gets an add-on's RBAC
 * resources — and therefore its routes, menus and crons — when its subscription lists the add-on
 * key in `Subscription.addons`. Enforced server-side by TenantGuard, which strips the resources of
 * inactive add-ons from the caller's permissions. Astro ships no add-on yet: the catalogue is empty
 * and the mechanism is kept as the extension point.
 */
export type AddonKey = string;
export const ADDON_KEYS: readonly AddonKey[] = [];

export interface AddonDefinition {
  key: AddonKey;
  /** RBAC resources that only exist for the org while the add-on is active */
  resources: string[];
  /** web route prefix of the module (locked page shown when inactive) */
  routePrefix: string;
  /** sidebar / nav group key */
  navGroup: string;
  priceMonthly: number;
  priceYearly: number;
}

export const ADDONS: Record<AddonKey, AddonDefinition> = {};

/** Optional discounted bundle of add-ons (none yet). */
export const ADDON_BUNDLE = { keys: [] as AddonKey[], priceMonthly: 0, priceYearly: 0 };

/** Monthly price of the bundle's add-ons bought one by one. */
export const ADDON_BUNDLE_SEPARATE_MONTHLY = ADDON_BUNDLE.keys.reduce((sum, k) => sum + (ADDONS[k]?.priceMonthly ?? 0), 0);

export function isAddonKey(value: unknown): value is AddonKey {
  return typeof value === 'string' && (ADDON_KEYS as readonly string[]).includes(value);
}

/** Keep only known add-on keys, de-duplicated, in catalogue order. */
export function normalizeAddons(values: unknown): AddonKey[] {
  const list = Array.isArray(values) ? values : [];
  return ADDON_KEYS.filter((k) => list.includes(k));
}

/** Resources the org may NOT use given its active add-ons. */
export function lockedAddonResources(active: readonly string[] | null | undefined): Set<string> {
  const on = new Set(active ?? []);
  const locked = new Set<string>();
  for (const addon of Object.values(ADDONS)) {
    if (!on.has(addon.key)) addon.resources.forEach((r) => locked.add(r));
  }
  return locked;
}

/** The add-on that owns an RBAC resource, if any. */
export function addonOfResource(resource: string): AddonKey | null {
  for (const addon of Object.values(ADDONS)) if (addon.resources.includes(resource)) return addon.key;
  return null;
}
