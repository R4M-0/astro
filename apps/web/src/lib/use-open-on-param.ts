'use client';

import { useEffect } from 'react';

/**
 * Opens a create dialog when the page is reached with `?new=1` (dashboard quick
 * actions, deep links), then strips the param so a refresh or back doesn't reopen it.
 * Reads `window.location` directly to avoid the Suspense boundary `useSearchParams` needs.
 */
export function useOpenOnParam(open: () => void, enabled = true, param = 'new') {
  useEffect(() => {
    if (!enabled) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(param) !== '1') return;
    open();
    url.searchParams.delete(param);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    // run once on mount (and when permission resolves)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, param]);
}
