/** Platform staff — self-hosted licenses signed by the SaaS (/platform/licenses). */
export interface IssuedLicense {
  id: string;
  reference: string;
  customer: string;
  organizationId: string | null;
  plan: string;
  seatLimit: number;
  orgLimit: number;
  addons: string[];
  storageLimitMb: number | null;
  startsAt: string;
  expiresAt: string;
  graceDays: number;
  instanceId: string | null;
  updatesUntil: string | null;
  notes: string | null;
  supersedesId: string | null;
  issuedByEmail: string | null;
  createdAt: string;
  token?: string;
}

export const LICENSE_PHASE_STYLE = {
  active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  expiring: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  grace: 'bg-red-500/10 text-red-600 border-red-500/20',
  expired: 'bg-muted text-muted-foreground',
  upcoming: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
} as const;

/** Same phases as the API's evaluateLicense (30-day warning, then grace). */
export function licensePhase(l: Pick<IssuedLicense, 'startsAt' | 'expiresAt' | 'graceDays'>, now = Date.now()): keyof typeof LICENSE_PHASE_STYLE {
  const DAY = 86_400_000;
  const expires = Date.parse(l.expiresAt);
  if (Date.parse(l.startsAt) > now + DAY) return 'upcoming';
  if (now >= expires + l.graceDays * DAY) return 'expired';
  if (now >= expires) return 'grace';
  return (expires - now) / DAY <= 30 ? 'expiring' : 'active';
}
