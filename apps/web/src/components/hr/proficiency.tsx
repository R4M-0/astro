'use client';

import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { levelTone, PROFICIENCY_LEVELS } from './hr-meta';

/** The reusable 1–5 proficiency scale, used everywhere competency levels are set. */
export function ProficiencyPicker({
  value,
  onChange,
  allowClear,
  size = 'md',
  disabled,
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  allowClear?: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const t = useTranslations('hr.proficiency');
  const dim = size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PROFICIENCY_LEVELS.map((n) => {
        const active = value === n;
        return (
          <Tooltip key={n}>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(allowClear && active ? 0 : n)}
                className={cn(
                  'rounded-md border font-semibold tabular-nums transition-colors disabled:opacity-50',
                  dim,
                  active ? cn(levelTone(n), 'border-current') : 'hover:bg-accent',
                )}
              >
                {n}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56">
              <span className="font-medium">{n}</span> — {t(String(n))}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function ProficiencyBadge({
  level,
  className,
}: {
  level: number | null | undefined;
  className?: string;
}) {
  const t = useTranslations('hr.proficiency');
  if (level == null)
    return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums',
            levelTone(level),
            className,
          )}
        >
          {level}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56">
        <span className="font-medium">{level}</span> — {t(String(level))}
      </TooltipContent>
    </Tooltip>
  );
}

/** Legend explaining the 1–5 scale (for form sections / dashboards). */
export function ProficiencyLegend() {
  const t = useTranslations('hr.proficiency');
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {PROFICIENCY_LEVELS.map((n) => (
        <span key={n}>
          <span className={cn('mr-1 inline-flex size-4 items-center justify-center rounded text-[10px] font-semibold', levelTone(n))}>{n}</span>
          {t(`short${n}`)}
        </span>
      ))}
    </div>
  );
}
