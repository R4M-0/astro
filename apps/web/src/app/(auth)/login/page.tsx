'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { PasswordInput } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiPost } from '@/lib/api';
import { useSession } from '@/stores/session';
import { SELF_HOSTED } from '@/lib/deployment';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

type LoginResponse =
  | { accessToken: string }
  | { twoFactorRequired: true; challengeToken: string };

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const loginSuccess = useSession((s) => s.loginSuccess);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const errorMessage = (err: unknown) => {
    const code = err instanceof ApiError ? (err.details as { error?: string } | undefined)?.error : undefined;
    if (code === 'EMAIL_NOT_VERIFIED') return t('emailNotVerified');
    if (code === 'ACCOUNT_LOCKED') return t('accountLocked');
    if (err instanceof ApiError && err.status === 401) return t('invalidCredentials');
    // anything else is not a wrong password: server down / blocked origin, or a failure after sign-in
    console.error(err);
    if (err instanceof ApiError) return err.message;
    return err instanceof TypeError ? t('serverUnreachable') : (err as Error)?.message ?? t('serverUnreachable');
  };

  const finish = async (accessToken: string) => {
    await loginSuccess(accessToken);
    router.push('/dashboard');
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await apiPost<LoginResponse>('/auth/login', values);
      if ('twoFactorRequired' in res) {
        setChallengeToken(res.challengeToken);
      } else {
        await finish(res.accessToken);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    setSubmitting(true);
    try {
      const res = await apiPost<{ accessToken: string }>('/auth/login/2fa', {
        challengeToken,
        code,
      });
      await finish(res.accessToken);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const errors = form.formState.errors;

  if (challengeToken) {
    return (
      <form onSubmit={onSubmit2fa} className="flex flex-col gap-6">
        <div>
          <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="size-6" strokeWidth={1.75} />
          </span>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{t('twoFactorTitle')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('twoFactorHint')}</p>
        </div>
        <Input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={20}
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          className="h-14 text-center font-mono text-2xl tracking-[0.5em] md:text-2xl"
          aria-label={t('twoFactorTitle')}
        />
        <Button type="submit" size="lg" className="h-11" disabled={submitting || code.length < 6}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? t('verifying') : t('verify')}
        </Button>
        <button
          type="button"
          onClick={() => {
            setChallengeToken(null);
            setCode('');
          }}
          className="inline-flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('twoFactorBack')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-primary">{t('loginWelcome')}</p>
        <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{t('loginTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('loginSubtitle')}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder={t('emailPlaceholder')}
          className="h-11"
          aria-invalid={!!errors.email}
          {...form.register('email')}
        />
        {errors.email && <p className="text-xs text-destructive">{t('invalidEmail')}</p>}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('password')}</Label>
          <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
            {t('forgotPassword')}
          </Link>
        </div>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          className="h-11"
          aria-invalid={!!errors.password}
          {...form.register('password')}
        />
        {errors.password && <p className="text-xs text-destructive">{t('required')}</p>}
      </div>

      <Button type="submit" size="lg" className="h-11 shadow-md shadow-primary/20" disabled={submitting}>
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? t('signingIn') : t('login')}
      </Button>

      {!SELF_HOSTED && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t('noAccount')}
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="outline" size="lg" className="h-11" asChild>
            <Link href="/register">{t('register')}</Link>
          </Button>
        </>
      )}
    </form>
  );
}
