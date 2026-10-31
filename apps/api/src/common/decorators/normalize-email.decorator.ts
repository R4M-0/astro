import { Transform } from 'class-transformer';

/** Trims and lowercases an e-mail field so `Owner@…` and `owner@… ` match the stored address. */
export const NormalizeEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
