'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Password field with a show / hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  function PasswordInput({ className, ...props }, ref) {
    const t = useTranslations('auth');
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('hidePassword') : t('showPassword')}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  },
);

/** 0–4 score: length ≥ 10, ≥ 14, mixed case, digit, symbol (capped at 4). */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < 10) s = Math.min(s, 1);
  return Math.min(4, s);
}

const LEVELS = ['weak', 'weak', 'fair', 'good', 'strong'] as const;
const COLORS = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-primary', 'bg-success'];

export function PasswordStrength({ value }: { value: string }) {
  const t = useTranslations('auth.strength');
  const score = passwordScore(value);
  if (!value) return null;
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn('h-1 flex-1 rounded-full transition-colors', i <= Math.max(1, score) ? COLORS[score] : 'bg-muted')}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        <span className="sr-only">{t('label')} </span>
        <span className="font-medium text-foreground">{t(LEVELS[score])}</span>
      </span>
    </div>
  );
}
