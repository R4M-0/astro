'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { RequestDetail } from '@/components/compliance/request-detail';

export default function ComplianceRequestRoute() {
  const params = useParams();
  return (
    <Suspense>
      <RequestDetail id={params.id as string} />
    </Suspense>
  );
}
