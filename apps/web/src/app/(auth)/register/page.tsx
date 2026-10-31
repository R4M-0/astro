'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { PasswordInput, PasswordStrength } from '@/components/auth/password-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiPost } from '@/lib/api';
import { LEGAL_ROUTES, LEGAL_VERSION } from '@/lib/legal/company';
import { useSession } from '@/stores/session';

const schema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(10),
  organizationName: z.string().trim().min(2),
  acceptTerms: z.literal(true),
});
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const loginSuccess = useSession((s) => s.loginSuccess);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { acceptTerms: false as unknown as true },
  });
  const perks = t.raw('registerPerks') as string[];

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await apiPost<{ accessToken: string } | { verificationRequired: true }>('/auth/register', {
        ...values,
        termsVersion: LEGAL_VERSION,
      });
      if ('verificationRequired' in res) {
        toast.success(t('checkYourEmail'));
        router.push('/login');
        return;
      }
      await loginSuccess(res.accessToken);
      router.push('/dashboard');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('serverUnreachable'));
    } finally {
      setSubmitting(false);
    }
  };

  const err = form.formState.errors;
  const password = form.watch('password') ?? '';
  const legalLink = (href: string) =>
    function LegalLink(chunks: React.ReactNode) {
      return (
        <Link href={href} target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
          {chunks}
        </Link>
      );
    };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{t('registerTitle')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('registerSubtitle')}</p>
        <ul className="mt-4 space-y-1.5">
          {perks.map((p) => (
            <li key={p} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="size-3.5 shrink-0 text-primary" strokeWidth={2.5} />
              {p}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldBox id="firstName" label={t('firstName')} error={err.firstName && t('required')}>
          <Input id="firstName" autoComplete="given-name" autoFocus className="h-11" {...form.register('firstName')} aria-invalid={!!err.firstName} />
        </FieldBox>
        <FieldBox id="lastName" label={t('lastName')} error={err.lastName && t('required')}>
          <Input id="lastName" autoComplete="family-name" className="h-11" {...form.register('lastName')} aria-invalid={!!err.lastName} />
        </FieldBox>
      </div>

      <FieldBox
        id="organizationName"
        label={t('organizationName')}
        hint={t('orgHint')}
        error={err.organizationName && t('required')}
      >
        <Input
          id="organizationName"
          autoComplete="organization"
          className="h-11"
          {...form.register('organizationName')}
          aria-invalid={!!err.organizationName}
        />
      </FieldBox>

      <FieldBox id="email" label={t('email')} error={err.email && t('invalidEmail')}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          className="h-11"
          {...form.register('email')}
          aria-invalid={!!err.email}
        />
      </FieldBox>

      <FieldBox id="password" label={t('password')} error={err.password && t('passwordTooShort')}>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          className="h-11"
          {...form.register('password')}
          aria-invalid={!!err.password}
          aria-describedby="password-hint"
        />
        <PasswordStrength value={password} />
        <p id="password-hint" className="text-xs text-muted-foreground">
          {t('passwordHint')}
        </p>
      </FieldBox>

      <div className="grid gap-1.5">
        <div className="flex items-start gap-3">
          <Controller
            control={form.control}
            name="acceptTerms"
            render={({ field }) => (
              <Checkbox
                id="acceptTerms"
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
                aria-invalid={!!err.acceptTerms}
                className="mt-0.5"
              />
            )}
          />
          <Label htmlFor="acceptTerms" className="block text-sm font-normal leading-relaxed text-muted-foreground">
            {t.rich('acceptTerms', { terms: legalLink(LEGAL_ROUTES.terms), privacy: legalLink(LEGAL_ROUTES.privacy) })}
          </Label>
        </div>
        {err.acceptTerms && <p className="pl-7 text-xs text-destructive">{t('mustAcceptTerms')}</p>}
      </div>

      <Button type="submit" size="lg" className="h-11 shadow-md shadow-primary/20" disabled={submitting}>
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? t('creatingAccount') : t('register')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('hasAccount')}{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('login')}
        </Link>
      </p>
    </form>
  );
}

function FieldBox({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | false;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
