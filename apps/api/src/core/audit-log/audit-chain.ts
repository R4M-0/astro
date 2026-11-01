import { createHash } from 'crypto';

/**
 * Tamper-evident audit trail (docs/compliance). Postgres computes the chain in the
 * `audit_chain_before_insert` trigger; this file recomputes it independently so a
 * verification never trusts the SQL function it checks.
 *
 *   bodyDigest = sha256(before::text | after::text)
 *   hash       = sha256(prevHash | seq | id | org | actor | action | entityType | entityId
 *                       | ip | userAgent | impersonatedById | createdAt (ms, UTC) | bodyDigest)
 */

export const GENESIS_HASH = '0'.repeat(64);

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** One audit row as read for verification: text columns exactly as Postgres renders them. */
export interface ChainRow {
  id: string;
  seq: number;
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  impersonatedById: string | null;
  /** `to_char(createdAt, 'YYYY-MM-DD"T"HH24:MI:SS.MS')` */
  createdAt: string;
  /** `before::text` / `after::text` (null when absent or redacted) */
  before: string | null;
  after: string | null;
  bodyDigest: string;
  prevHash: string;
  hash: string;
  redacted: boolean;
}

export const bodyDigest = (before: string | null, after: string | null) => sha256(`${before ?? ''}|${after ?? ''}`);

export function rowHash(r: Omit<ChainRow, 'hash' | 'before' | 'after' | 'redacted'>): string {
  return sha256(
    [
      r.prevHash,
      String(r.seq),
      r.id,
      r.organizationId ?? '',
      r.actorId ?? '',
      r.action,
      r.entityType ?? '',
      r.entityId ?? '',
      r.ip ?? '',
      r.userAgent ?? '',
      r.impersonatedById ?? '',
      r.createdAt,
      r.bodyDigest,
    ].join('|'),
  );
}

export type BreakReason = 'link' | 'gap' | 'hash' | 'body' | 'seal';

export interface ChainBreak {
  seq: number;
  id: string | null;
  reason: BreakReason;
}

export interface SealRef {
  kind: string;
  seq: number;
  hash: string;
  createdAt?: Date;
}

/**
 * Incremental verifier: feed rows in `seq` order (any batch size), then `finish()`.
 * `start` is where the chain resumes: genesis, or the ANCHOR left by a retention purge.
 */
export class ChainVerifier {
  private prev: { seq: number; hash: string };
  private readonly hashes = new Map<number, string>();
  entries = 0;
  redacted = 0;
  firstBreak: ChainBreak | null = null;

  constructor(
    start: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH },
    /** seqs whose hash must be remembered to check seals */
    private readonly sealSeqs: Set<number> = new Set(),
  ) {
    this.prev = start;
  }

  private fail(seq: number, id: string | null, reason: BreakReason) {
    if (!this.firstBreak) this.firstBreak = { seq, id, reason };
  }

  push(r: ChainRow) {
    this.entries++;
    if (r.redacted) this.redacted++;
    if (r.seq !== this.prev.seq + 1) this.fail(this.prev.seq + 1, r.id, 'gap');
    else if (r.prevHash !== this.prev.hash) this.fail(r.seq, r.id, 'link');
    if (!r.redacted && bodyDigest(r.before, r.after) !== r.bodyDigest) this.fail(r.seq, r.id, 'body');
    if (rowHash(r) !== r.hash) this.fail(r.seq, r.id, 'hash');
    if (this.sealSeqs.has(r.seq)) this.hashes.set(r.seq, r.hash);
    this.prev = { seq: r.seq, hash: r.hash };
  }

  /** Seals must match the row at their seq; a seal past the head means the tail was cut. */
  finish(seals: SealRef[]) {
    let sealsChecked = 0;
    for (const s of seals) {
      if (s.kind === 'ANCHOR') continue;
      const h = this.hashes.get(s.seq);
      if (h === undefined) {
        // older than the first remaining row (purged by retention): nothing to compare
        if (s.seq > this.prev.seq) this.fail(s.seq, null, 'seal');
        continue;
      }
      sealsChecked++;
      if (h !== s.hash) this.fail(s.seq, null, 'seal');
    }
    return {
      ok: !this.firstBreak,
      entries: this.entries,
      redacted: this.redacted,
      head: { seq: this.prev.seq, hash: this.prev.hash },
      sealsChecked,
      firstBreak: this.firstBreak,
    };
  }
}

export type VerifyResult = ReturnType<ChainVerifier['finish']> & { verifiedAt: string };
