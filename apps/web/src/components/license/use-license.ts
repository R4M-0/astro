'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { SELF_HOSTED } from '@/lib/deployment';

export type LicenseStatus = 'active' | 'expiring' | 'grace' | 'expired' | 'missing' | 'invalid' | 'clock_tampered';

export interface LicenseStatusView {
  mode: 'saas' | 'self-hosted';
  status: LicenseStatus;
  readOnly: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  graceEndsAt: string | null;
  renewalInstalled: boolean;
}

export interface LicenseDetails extends LicenseStatusView {
  source: 'database' | 'file' | 'env' | null;
  error: { code: string; message: string } | null;
  instanceId: string | null;
  upcoming: { lid: string; startsAt: string; expiresAt: string } | null;
  checkedAt: string;
  license: {
    reference: string;
    customer: string;
    plan: string;
    seatLimit: number;
    orgLimit: number;
    addons: string[];
    storageLimitMb: number | null;
    issuedAt: string;
    startsAt: string;
    expiresAt: string;
    graceDays: number;
    boundToInstance: boolean;
    updatesUntil: string | null;
  } | null;
  usage: { seatsUsed: number; organizations: number };
}

/** Banner state — only fetched by self-hosted builds. */
export function useLicenseStatus() {
  return useQuery({
    queryKey: ['license-status'],
    queryFn: () => apiGet<LicenseStatusView>('/license/status'),
    enabled: SELF_HOSTED,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}
