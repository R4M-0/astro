import { cn } from '@/lib/utils';

/** Astro wordmark — a small "A" glyph in the brand colour + the name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-lg bg-primary text-[15px] font-bold text-primary-foreground shadow-sm"
      >
        A
      </span>
      <span className="text-[17px] tracking-tight text-foreground">Astro</span>
    </span>
  );
}
