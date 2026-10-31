'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** History-back button; falls back to `fallbackHref` when there is no previous page. */
export function BackButton({
  label,
  icon,
  fallbackHref = '/dashboard',
}: {
  label: string;
  icon?: ReactNode;
  fallbackHref?: string;
}) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallbackHref))}
    >
      {icon}
      {label}
    </Button>
  );
}
