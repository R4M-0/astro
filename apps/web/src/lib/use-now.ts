'use client';

import { useSyncExternalStore } from 'react';

/**
 * Current time (ms) for render-time date logic — overdue flags, days left, "date is in the past".
 * A shared ticker re-renders subscribers every `intervalMs` (default 30 s), so the value stays
 * current (e.g. across midnight) while render stays pure: it reads a store snapshot, never Date.now().
 */
const listeners = new Map<number, Set<() => void>>();
const snapshots = new Map<number, number>();
const timers = new Map<number, ReturnType<typeof setInterval>>();

function subscribe(intervalMs: number, onChange: () => void) {
  let set = listeners.get(intervalMs);
  if (!set) {
    set = new Set();
    listeners.set(intervalMs, set);
    snapshots.set(intervalMs, Date.now());
    timers.set(
      intervalMs,
      setInterval(() => {
        snapshots.set(intervalMs, Date.now());
        listeners.get(intervalMs)?.forEach((l) => l());
      }, intervalMs),
    );
  }
  set.add(onChange);
  return () => {
    set.delete(onChange);
    if (set.size === 0) {
      clearInterval(timers.get(intervalMs));
      timers.delete(intervalMs);
      listeners.delete(intervalMs);
      snapshots.delete(intervalMs);
    }
  };
}

// one value per page load for the server render / hydration pass
const serverNow = Date.now();

// One stable subscribe function per interval: an inline arrow would be a new function on
// every render, so React would unsubscribe + resubscribe each time — and when the page is
// the ticker's only subscriber that resets the snapshot to a new Date.now(), re-rendering
// forever ("Maximum update depth exceeded").
const subscribers = new Map<number, (onChange: () => void) => () => void>();
function subscriberFor(intervalMs: number) {
  let fn = subscribers.get(intervalMs);
  if (!fn) {
    fn = (onChange) => subscribe(intervalMs, onChange);
    subscribers.set(intervalMs, fn);
  }
  return fn;
}

export function useNow(intervalMs = 30_000): number {
  return useSyncExternalStore(
    subscriberFor(intervalMs),
    () => {
      let v = snapshots.get(intervalMs);
      if (v === undefined) {
        v = Date.now();
        snapshots.set(intervalMs, v);
      }
      return v;
    },
    () => serverNow,
  );
}
