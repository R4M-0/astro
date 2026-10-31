'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiPost } from '@/lib/api';

function ResetPasswordForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost('/auth/password/reset', { token, password });
      toast.success(t('passwordReset'));
      router.push('/login');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('emailVerifyFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{t('resetTitle')}</h1>
      <div className="grid gap-2">
        <Label htmlFor="password">{t('newPassword')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={submitting || !token}>
        {t('resetTitle')}
      </Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        ← {t('login')}
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
