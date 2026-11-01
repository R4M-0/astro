'use client';

import { Suspense } from 'react';
import { CompliancePage } from '@/components/compliance/compliance-page';

export default function ComplianceRoute() {
  return (
    <Suspense>
      <CompliancePage />
    </Suspense>
  );
}
