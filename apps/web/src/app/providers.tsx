'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setOnUnauthorized } from '@/lib/api';
import { setOnIdentityChange, useSession } from '@/stores/session';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  const router = useRouter();
  const clear = useSession((s) => s.clear);

  useEffect(() => {
    setOnUnauthorized(() => {
      clear();
      router.push('/login');
    });
  }, [clear, router]);

  useEffect(() => {
    setOnIdentityChange((kind) => {
      if (kind === 'logout') queryClient.clear();
      else void queryClient.resetQueries();
    });
    return () => setOnIdentityChange(null);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
