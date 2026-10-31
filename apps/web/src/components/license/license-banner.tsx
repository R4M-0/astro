'use client';

import { AlertTriangle, Lock } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useHasPermission } from '@/stores/session';
import { useLicenseStatus } from './use-license';

/**
 * Self-hosted only: expiry warning, grace period and read-only notices. Hidden
 * while the license is active and more than 30 days from expiry, or when a
 * renewal is already installed.
 */
export function LicenseBanner() {
  const t = useTranslations('license.banner');
  const format = useFormatter();
  const canManage = useHasPermission()('organization:admin');
  const { data } = useLicenseStatus();
  if (!data || data.mode !== 'self-hosted' || data.status === 'active') return null;
  // an installed renewal takes over before the current license stops working
  if (data.renewalInstalled && !data.readOnly) return null;

  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'long' }) : '');
  const message =
    data.status === 'expiring'
      ? t('expiring', { days: data.daysLeft ?? 0, date: date(data.expiresAt) })
      : data.status === 'grace'
        ? t('grace', { date: date(data.graceEndsAt) })
        : t(data.status);
  const severe = data.readOnly || data.status === 'grace';
  const Icon = data.readOnly ? Lock : AlertTriangle;

  return (
    <div
      role="status"
      className={
        severe
          ? 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-red-600 px-4 py-1.5 text-center text-xs font-medium text-white'
          : 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950'
      }
    >
      <span className="inline-flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {message}
      </span>
      {canManage && (
        <Link href="/admin?tab=license" className="underline underline-offset-2">
          {t('manage')}
        </Link>
      )}
    </div>
  );
}
