import type { JobsOptions, Queue } from 'bullmq';

export const QUEUE_MAIL = 'mail';

/**
 * Bounds a queue call. BullMQ connections retry forever while Redis is down;
 * request paths must fail fast so callers can fall back instead of hanging.
 */
export async function withDeadline<T>(work: Promise<T>, label: string, timeoutMs = 3000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} unavailable (timeout)`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** `queue.add` bounded by `withDeadline`. */
export function enqueue<T>(queue: Queue, name: string, data: T, opts?: JobsOptions, timeoutMs = 3000) {
  return withDeadline(queue.add(name, data, opts), `queue ${queue.name}`, timeoutMs);
}
