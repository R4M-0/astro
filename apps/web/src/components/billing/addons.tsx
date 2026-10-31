'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { Check, ChefHat, HardHat, Leaf, Lock, Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ADDON_BUNDLE, ADDON_BUNDLE_SEPARATE_MONTHLY, ADDONS, type AddonKey } from '@astro/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import { SELF_HOSTED } from '@/lib/deployment';

/** Presentation of each paid add-on (catalogue/prices live in @astro/shared). */
export const ADDON_META: Record<AddonKey, { i18n: 'environment' | 'healthSafety' | 'haccp'; icon: typeof Leaf; color: string }> = {
  environment: { i18n: 'environment', icon: Leaf, color: 'oklch(0.6 0.13 140)' },
  'health-safety': { i18n: 'healthSafety', icon: HardHat, color: 'oklch(0.66 0.19 45)' },
  haccp: { i18n: 'haccp', icon: ChefHat, color: 'oklch(0.6 0.16 25)' },
};

function useRequestAddon() {
  const t = useTranslations('addons');
  return useMutation({
    mutationFn: async (addons: AddonKey[]) => {
      for (const addon of addons) await apiPost('/billing/request-addon', { addon });
    },
    onSuccess: () => toast.success(t('requested')),
    onError: (e) => toast.error((e as Error).message),
  });
}

function FeatureList({ addon, className }: { addon: AddonKey; className?: string }) {
  const t = useTranslations('addons');
  const features = t.raw(`${ADDON_META[addon].i18n}.features`) as string[];
  return (
    <ul className={cn('space-y-1.5 text-sm text-muted-foreground', className)}>
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: ADDON_META[addon].color }} aria-hidden />
          {f}
        </li>
      ))}
    </ul>
  );
}

/** Full-page notice shown instead of an add-on module the organization does not subscribe to. */
export function AddonLocked({ addon }: { addon: AddonKey }) {
  const t = useTranslations('addons');
  const canManage = useHasPermission()('organization:admin');
  const request = useRequestAddon();
  const meta = ADDON_META[addon];
  const Icon = meta.icon;

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-12 text-center sm:py-16">
      <span
        className="relative flex size-14 items-center justify-center rounded-2xl"
        style={{ background: `color-mix(in oklab, ${meta.color} 14%, transparent)`, color: meta.color }}
      >
        <Icon className="size-7" aria-hidden />
        <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
        </span>
      </span>
      <Badge variant="outline" className="mt-5">{t('badge')}</Badge>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t(`${meta.i18n}.name`)}</h1>
      <p className="mt-2 text-muted-foreground">{t(SELF_HOSTED ? 'lockedBodyLicense' : 'lockedBody')}</p>

      <Card className="mt-8 w-full text-left">
        <CardContent className="space-y-4 p-5">
          <p className="text-sm">{t(`${meta.i18n}.tagline`)}</p>
          <FeatureList addon={addon} />
          {SELF_HOSTED ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="max-w-sm text-sm text-muted-foreground">{t(canManage ? 'licenseHint' : 'askAdmin')}</p>
              {canManage && (
                <Button variant="outline" asChild>
                  <Link href="/admin?tab=license">{t('seeLicense')}</Link>
                </Button>
              )}
            </div>
          ) : (
          <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
            <div>
              <p className="text-xl font-semibold tabular-nums">
                {ADDONS[addon].priceMonthly} €<span className="text-sm font-normal text-muted-foreground">{t('perMonth')}</span>
              </p>
              <p className="text-xs text-muted-foreground">{t('bundleHint', { price: ADDON_BUNDLE.priceMonthly })}</p>
            </div>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <Link href="/admin?tab=billing">{t('seeBilling')}</Link>
                </Button>
                <Button disabled={request.isPending} onClick={() => request.mutate([addon])}>
                  {t('request')}
                </Button>
              </div>
            ) : (
              <p className="max-w-xs text-sm text-muted-foreground">{t('askAdmin')}</p>
            )}
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Add-on cards of the Admin → Abonnement tab. */
export function AdminAddons({ active }: { active: string[] }) {
  const t = useTranslations('addons');
  const hasPermission = useHasPermission();
  const canManage = hasPermission('organization:admin');
  const request = useRequestAddon();
  const separate = ADDON_BUNDLE_SEPARATE_MONTHLY;
  const allActive = ADDON_BUNDLE.keys.every((k) => active.includes(k));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Object.values(ADDONS).map((a) => {
          const meta = ADDON_META[a.key];
          const Icon = meta.icon;
          const on = active.includes(a.key);
          return (
            <Card key={a.key} className={on ? 'border-primary' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4" style={{ color: meta.color }} aria-hidden />
                    {t(`${meta.i18n}.short`)}
                  </CardTitle>
                  <Badge variant="outline" className={on ? 'bg-emerald-500/10 text-emerald-600' : ''}>
                    {on ? t('active') : t('inactive')}
                  </Badge>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {a.priceMonthly} €<span className="text-xs font-normal text-muted-foreground">{t('perMonth')}</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <FeatureList addon={a.key} className="text-xs" />
                {on ? (
                  a.resources.every((r) => hasPermission(`${r}:read`)) && (
                    <Button size="sm" variant="outline" className="w-full" asChild>
                      <Link href={a.routePrefix}>{t('open')}</Link>
                    </Button>
                  )
                ) : (
                  canManage && (
                    <Button size="sm" variant="outline" className="w-full" disabled={request.isPending} onClick={() => request.mutate([a.key])}>
                      {t('request')}
                    </Button>
                  )
                )}
              </CardContent>
            </Card>
          );
        })}

        <Card className={allActive ? 'border-primary' : 'border-dashed'}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="size-4 text-primary" aria-hidden />
                {t('bundle')}
              </CardTitle>
              {allActive && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">{t('active')}</Badge>}
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {ADDON_BUNDLE.priceMonthly} €<span className="text-xs font-normal text-muted-foreground">{t('perMonth')}</span>
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('bundleBody', { save: separate - ADDON_BUNDLE.priceMonthly })}</p>
            {!allActive && canManage && (
              <Button
                size="sm"
                className="w-full"
                disabled={request.isPending}
                onClick={() => request.mutate(ADDON_BUNDLE.keys.filter((k) => !active.includes(k)))}
              >
                {t('requestBundle')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
