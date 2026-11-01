import {
  Activity,
  Award,
  BarChart3,
  Building2,
  CircleUserRound,
  ClipboardCheck,
  FileUp,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  Network,
  Route,
  ScrollText,
  Send,
  Settings2,
  Sparkles,
  ShieldHalf,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { ADDONS, type AddonKey } from '@astro/shared';
import { useSession } from '@/stores/session';

export interface NavItem {
  key: string; // i18n key under "nav"
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Other route prefixes that belong to this page (e.g. its records' detail pages). */
  match?: string[];
  /** Permission(s) needed to open the page — any of them. Items the user can't open are not shown. */
  permission?: string | readonly string[];
}

export interface NavGroup {
  key: string | null; // i18n key for the group label (null = ungrouped)
  /** Sidebar button icon of a named group (its pages show as tabs on top of the page). */
  icon?: React.ComponentType<{ className?: string }>;
  /** paid add-on module: the group only shows when the organization subscribes to it */
  addon?: AddonKey;
  color: string; // per-family accent hue (oklch) used across the sidebar
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: null,
    color: 'oklch(0.62 0.21 275)', // indigo — home
    items: [
      { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard:read' },
      { key: 'hrMe', href: '/hr/me', icon: CircleUserRound },
    ],
  },
  {
    key: 'people',
    icon: Users,
    color: 'oklch(0.6 0.14 165)', // emerald — people
    items: [
      { key: 'hrEmployees', href: '/hr/employees', icon: Users, permission: 'employees:read' },
      { key: 'galaxy', href: '/hr/galaxy', icon: Sparkles, permission: 'employees:read' },
      { key: 'hrInbox', href: '/hr/inbox', icon: Inbox, permission: 'audit-log:read' },
      { key: 'orgChart', href: '/hr/org-chart', icon: Network, permission: 'employees:read' },
      { key: 'hrJourneys', href: '/hr/journeys', icon: Route, permission: 'employees:read' },
      { key: 'hrImport', href: '/hr/import', icon: FileUp, permission: ['employees:create', 'competency-evaluations:update'] },
    ],
  },
  {
    key: 'competencies',
    icon: Award,
    color: 'oklch(0.63 0.2 300)', // violet
    items: [
      { key: 'hrSkills', href: '/hr/skills', icon: Award, permission: 'skills:read' },
      { key: 'hrJobDescriptions', href: '/hr/job-descriptions', icon: ScrollText, permission: 'job-descriptions:read' },
      { key: 'hrCompetencyEvaluation', href: '/hr/competency-evaluation', icon: ClipboardCheck, permission: 'competency-evaluations:read' },
      { key: 'hrCompetencyDashboard', href: '/hr/competency-evaluation/dashboard', icon: LayoutGrid, permission: 'competency-evaluations:read' },
      { key: 'hrCoverage', href: '/hr/competency-evaluation/polyvalence', icon: ShieldHalf, permission: 'competency-evaluations:read' },
    ],
  },
  {
    key: 'trainings',
    icon: GraduationCap,
    color: 'oklch(0.72 0.18 70)', // amber
    items: [
      { key: 'hrTrainingPlan', href: '/hr/trainings', icon: GraduationCap, permission: 'hr-trainings:read' },
      { key: 'hrTrainingEvaluation', href: '/hr/trainings/evaluation', icon: Send, permission: 'hr-trainings:read' },
      { key: 'hrTrainingDashboard', href: '/hr/trainings/dashboard', icon: BarChart3, permission: 'hr-trainings:read' },
    ],
  },
  {
    key: null,
    color: 'oklch(0.66 0.16 190)', // cyan — tools
    items: [
      { key: 'hrSurveys', href: '/hr/surveys', icon: MessageSquareText, permission: 'hr-surveys:read' },
      { key: 'admin', href: '/admin', icon: Building2, permission: ['organization:read', 'users:read', 'roles:read', 'audit-log:read'] },
    ],
  },
];

export const SECONDARY_ICONS = { Activity, ListChecks, Settings2 };

export interface NavLocation {
  group: NavGroup;
  groupIndex: number;
  item: NavItem;
}

/**
 * The nav item (and its group) a route belongs to: exact href, else the longest href the path
 * sits under — so `/hr/trainings/123` → Formations › Plan de formation while `/hr/trainings/dashboard`
 * keeps its own tab.
 */
export function locateNav(pathname: string): NavLocation | null {
  let best: NavLocation | null = null;
  let bestLen = 0;
  NAV_GROUPS.forEach((group, groupIndex) => {
    for (const item of group.items) {
      for (const href of [item.href, ...(item.match ?? [])]) {
        if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
        if (!best || href.length > bestLen) {
          best = { group, groupIndex, item };
          bestLen = href.length;
        }
      }
    }
  });
  return best;
}

/** Nav groups the organization may use: add-on modules it does not subscribe to are left out. */
export function isNavGroupAvailable(group: NavGroup, addons: readonly string[]): boolean {
  return !group.addon || addons.includes(group.addon);
}

/** Whether the user may open a nav item's page (no permission = open to every member). */
export function canOpenNavItem(item: NavItem, permissions: readonly string[]): boolean {
  if (!item.permission) return true;
  const needed = typeof item.permission === 'string' ? [item.permission] : item.permission;
  return needed.some((p) => permissions.includes(p));
}

/**
 * Visibility predicates for the menus: a page shows only when the user may open it, and a group
 * only when its add-on is subscribed and at least one of its pages is open to the user.
 */
export function useNavVisibility() {
  const addons = useSession((s) => s.addons);
  const permissions = useSession((s) => s.permissions);
  return useMemo(() => {
    const item = (it: NavItem) => canOpenNavItem(it, permissions);
    const group = (g: NavGroup) => isNavGroupAvailable(g, addons) && g.items.some(item);
    return { item, group };
  }, [addons, permissions]);
}

/** Nav groups shown to the user, each reduced to the pages they may open. */
export function useAvailableNavGroups(): NavGroup[] {
  const visible = useNavVisibility();
  return useMemo(
    () => NAV_GROUPS.filter(visible.group).map((g) => ({ ...g, items: g.items.filter(visible.item) })),
    [visible],
  );
}

/** The add-on module a route belongs to, when the organization does not subscribe to it. */
export function lockedAddonOf(pathname: string, addons: readonly string[]): AddonKey | null {
  for (const addon of Object.values(ADDONS)) {
    const p = addon.routePrefix;
    if ((pathname === p || pathname.startsWith(`${p}/`)) && !addons.includes(addon.key)) return addon.key;
  }
  return null;
}
