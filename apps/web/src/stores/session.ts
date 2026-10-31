import { create } from 'zustand';
import { apiGet, getStoredOrgId, setAccessToken, setActiveOrgId, tryRefresh } from '@/lib/api';

export interface ImpersonationInfo {
  user: { id: string; email: string; firstName: string; lastName: string };
  organization: { id: string; name: string };
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  locale: string;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  isSuperAdmin: boolean;
  memberships: {
    id: string;
    organizationId: string;
    isDefault: boolean;
    jobTitle: string | null;
    /** main department — records the user creates default to it */
    departmentId?: string | null;
    /** extra departments an admin granted (their records are visible too) */
    extraDepartmentIds?: string[];
    organization: { id: string; name: string; slug: string; logoUrl: string | null };
    /** departmentScoped: the user only sees their department(s)' records (+ involved / shared ones) */
    role: { id: string; key: string; name: string; departmentScoped?: boolean };
  }[];
}

interface SessionState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: SessionUser | null;
  permissions: string[];
  /** paid add-on modules the active organization subscribes to (shared ADDON_KEYS) */
  addons: string[];
  roleKey: string | null;
  organizationId: string | null;
  impersonation: ImpersonationInfo | null;
  /** Bootstraps the session from the refresh cookie on first load. */
  initialize: () => Promise<void>;
  loginSuccess: (accessToken: string) => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  startImpersonation: (payload: { accessToken: string } & ImpersonationInfo) => Promise<void>;
  exitImpersonation: () => Promise<void>;
  clear: () => void;
}

// Fired whenever the identity behind the API token changes. Query keys carry no
// user/org, so Providers drops the React Query cache: `logout` → clear(), `switch`
// (login, org switch, impersonation start/exit — once the new identity is
// loaded) → resetQueries() so mounted views refetch instead of showing the
// previous identity's data.
export type IdentityChange = 'logout' | 'switch';
let onIdentityChange: ((kind: IdentityChange) => void) | null = null;
export function setOnIdentityChange(fn: ((kind: IdentityChange) => void) | null) {
  onIdentityChange = fn;
}
const identityChanged = (kind: IdentityChange) => onIdentityChange?.(kind);

/** Per-user values kept in localStorage — dropped on logout. */
const USER_STORAGE_KEYS = ['astro.orgId', 'astro.exportJob'];

async function loadProfile(set: (partial: Partial<SessionState>) => void) {
  const user = await apiGet<SessionUser>('/me');
  const stored = getStoredOrgId();
  const membership =
    user.memberships.find((m) => m.organizationId === stored) ??
    user.memberships.find((m) => m.isDefault) ??
    user.memberships[0];
  const orgId = membership?.organizationId ?? null;
  setActiveOrgId(orgId);
  const perms = orgId
    ? await apiGet<{ role: { key: string } | null; permissions: string[]; addons?: string[] }>('/me/permissions')
    : { role: null, permissions: [], addons: [] };
  set({
    status: 'authenticated',
    user,
    organizationId: orgId,
    permissions: perms.permissions,
    addons: perms.addons ?? [],
    roleKey: perms.role?.key ?? null,
  });
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  permissions: [],
  addons: [],
  roleKey: null,
  organizationId: null,
  impersonation: null,

  initialize: async () => {
    const ok = await tryRefresh();
    if (!ok) {
      set({ status: 'unauthenticated', user: null, permissions: [] });
      return;
    }
    try {
      await loadProfile(set);
    } catch {
      set({ status: 'unauthenticated', user: null, permissions: [] });
    }
  },

  loginSuccess: async (accessToken: string) => {
    setAccessToken(accessToken);
    await loadProfile(set);
    identityChanged('switch');
  },

  switchOrganization: async (orgId: string) => {
    setActiveOrgId(orgId);
    await loadProfile(set);
    identityChanged('switch');
  },

  // Super Admin support access: swap to the impersonation access token + org, then
  // load that user's profile. Exit restores the Super Admin from the refresh cookie.
  startImpersonation: async ({ accessToken, user, organization }) => {
    setAccessToken(accessToken);
    setActiveOrgId(organization.id);
    await loadProfile(set);
    set({ impersonation: { user, organization } });
    identityChanged('switch');
  },

  exitImpersonation: async () => {
    setAccessToken(null);
    set({ impersonation: null });
    const ok = await tryRefresh();
    if (ok) {
      await loadProfile(set);
      identityChanged('switch');
    } else get().clear();
  },

  clear: () => {
    identityChanged('logout');
    setAccessToken(null);
    try {
      for (const key of USER_STORAGE_KEYS) localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
    set({ status: 'unauthenticated', user: null, permissions: [], roleKey: null, impersonation: null });
  },
}));

/** Whether the active organization subscribes to a paid add-on module. */
export function useHasAddon() {
  const addons = useSession((s) => s.addons);
  return (addon: string) => addons.includes(addon);
}

export function useHasPermission() {
  const permissions = useSession((s) => s.permissions);
  return (permission: string) => permissions.includes(permission);
}

/** The membership of the active organization (department, role…). */
export function useActiveMembership() {
  const user = useSession((s) => s.user);
  const organizationId = useSession((s) => s.organizationId);
  return user?.memberships.find((m) => m.organizationId === organizationId) ?? null;
}
