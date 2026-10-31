'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiPost } from '@/lib/api';

function VerifyEmailInner() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token');
  const [result, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const state = token ? result : 'error';

  useEffect(() => {
    if (!token) return;
    apiPost('/auth/email/verify', { token })
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, [token]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{t('verifyEmailTitle')}</h1>
      {state === 'pending' && <p className="text-sm text-muted-foreground">…</p>}
      {state === 'ok' && (
        <>
          <CheckCircle2 className="size-10 text-success" />
          <p className="text-sm text-muted-foreground">{t('emailVerified')}</p>
        </>
      )}
      {state === 'error' && (
        <>
          <XCircle className="size-10 text-destructive" />
          <p className="text-sm text-muted-foreground">{t('emailVerifyFailed')}</p>
        </>
      )}
      <Link href="/login" className="text-sm text-primary hover:underline">
        {t('login')}
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
