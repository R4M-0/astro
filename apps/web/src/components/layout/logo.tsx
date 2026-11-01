import { cn } from '@/lib/utils';

/** Constella wordmark — a three-star constellation glyph in the brand colour + the name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"
      >
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor">
          <path d="M5 17L12 6L19 14L5 17" fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.4} strokeLinejoin="round" />
          <circle cx="5" cy="17" r="2.2" />
          <circle cx="12" cy="6" r="2.7" />
          <circle cx="19" cy="14" r="2.2" />
        </svg>
      </span>
      <span className="text-[17px] tracking-tight text-foreground">Constella</span>
    </span>
  );
}
