/**
 * Process role, from APP_ROLE:
 *  - `api`    serves HTTP/WebSocket only — no schedules, no queue consumers (scale these out)
 *  - `worker` also runs the daily schedules and BullMQ consumers (mail, exports) — run one
 *  - `all`    both (default; single-process dev and small installs)
 * Workers still boot the full Nest app so the socket.io Redis adapter is present:
 * notifications they emit reach users connected to any API replica.
 */
export type AppRole = 'api' | 'worker' | 'all';

export const APP_ROLE: AppRole = (() => {
  const v = (process.env.APP_ROLE ?? 'all').toLowerCase();
  return v === 'api' || v === 'worker' ? v : 'all';
})();

/** True when this process runs schedules and queue consumers. */
export const RUNS_JOBS = APP_ROLE !== 'api';
