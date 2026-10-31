'use client';

import { Printer } from 'lucide-react';

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground print:hidden"
    >
      <Printer className="size-3.5" />
      {label}
    </button>
  );
}
