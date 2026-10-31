import { BadRequestException } from '@nestjs/common';

/**
 * `Organization.settings` is a JSON bag. Only these keys may be written through
 * `PATCH /organizations/current` (each with its validator); `visibility` has its
 * own endpoint (`PUT /visibility`). Anything else is rejected so the column
 * cannot be used as free storage.
 */
const WRITABLE: Record<string, (v: unknown) => boolean> = {
  allowSelfApproval: (v) => typeof v === 'boolean',
};

/** Keys returned to every member through `/me` (the rest stays server-side). */
const PUBLIC_KEYS = new Set(['allowSelfApproval', 'visibility']);

/** Validates a settings patch and merges it into the stored settings (other keys untouched). */
export function mergeOrgSettings(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(WRITABLE, key)) throw new BadRequestException(`Unknown organization setting: ${key}`);
    if (!WRITABLE[key](value)) throw new BadRequestException(`Invalid value for organization setting: ${key}`);
  }
  const base = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  return { ...base, ...patch };
}

/** The subset of settings safe to hand to any member. */
export function publicOrgSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  return Object.fromEntries(Object.entries(settings as Record<string, unknown>).filter(([k]) => PUBLIC_KEYS.has(k)));
}
