import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/logo';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <Link href="/login" aria-label="Astro">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
