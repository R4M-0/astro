'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { SurveyDetail } from '@/components/hr/survey-detail';

export default function SurveyDetailRoute() {
  const params = useParams();
  return (
    <Suspense>
      <SurveyDetail id={params.id as string} />
    </Suspense>
  );
}
