'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiPost } from '@/lib/api';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost('/auth/password/forgot', { email });
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{t('resetTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('resetSent')}</p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          ← {t('login')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{t('resetTitle')}</h1>
      <div className="grid gap-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Button type="submit" disabled={submitting}>
        {t('sendResetLink')}
      </Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        ← {t('login')}
      </Link>
    </form>
  );
}
