'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ComplianceHolds } from './compliance-holds';
import { ComplianceOverview } from './compliance-overview';
import { ComplianceRegister } from './compliance-register';
import { ComplianceRequests } from './compliance-requests';
import { ComplianceRetention } from './compliance-retention';

const TABS = ['overview', 'requests', 'retention', 'holds', 'register'] as const;
type Tab = (typeof TABS)[number];

/** « Conformité »: audit integrity, data subject requests, retention, legal holds, record of processing. */
export function CompliancePage() {
  const t = useTranslations('compliance');
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'overview';

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('title')} description={t('desc')} />
      <Tabs value={tab} onValueChange={(v) => router.replace(`/compliance?tab=${v}`, { scroll: false })}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>{t(`tabs.${k}`)}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-4"><ComplianceOverview /></TabsContent>
        <TabsContent value="requests" className="mt-4"><ComplianceRequests /></TabsContent>
        <TabsContent value="retention" className="mt-4"><ComplianceRetention /></TabsContent>
        <TabsContent value="holds" className="mt-4"><ComplianceHolds /></TabsContent>
        <TabsContent value="register" className="mt-4"><ComplianceRegister /></TabsContent>
      </Tabs>
    </div>
  );
}
