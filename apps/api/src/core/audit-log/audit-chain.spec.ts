import { bodyDigest, ChainRow, ChainVerifier, GENESIS_HASH, rowHash } from './audit-chain';

/** Builds a valid chain of `n` rows the way the trigger does. */
function chain(n: number, start = { seq: 0, hash: GENESIS_HASH }): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev = start;
  for (let i = 1; i <= n; i++) {
    const after = JSON.stringify({ firstName: `Name ${i}` });
    const base = {
      id: `row${i}`,
      seq: prev.seq + 1,
      organizationId: 'org1',
      actorId: 'u1',
      action: 'PATCH /api/v1/hr/employees/:id',
      entityType: 'Employee',
      entityId: 'e1',
      ip: '10.0.0.1',
      userAgent: 'jest',
      impersonatedById: null,
      createdAt: `2026-11-01T10:00:0${i % 10}.000`,
      bodyDigest: bodyDigest(null, after),
      prevHash: prev.hash,
    };
    const row: ChainRow = { ...base, before: null, after, hash: rowHash(base), redacted: false };
    rows.push(row);
    prev = { seq: row.seq, hash: row.hash };
  }
  return rows;
}

const verify = (rows: ChainRow[], seals: { kind: string; seq: number; hash: string }[] = [], start?: { seq: number; hash: string }) => {
  const v = new ChainVerifier(start, new Set(seals.map((s) => s.seq)));
  rows.forEach((r) => v.push(r));
  return v.finish(seals);
};

describe('audit chain verifier', () => {
  it('accepts an untouched chain and reports its head', () => {
    const rows = chain(5);
    const res = verify(rows);
    expect(res.ok).toBe(true);
    expect(res.entries).toBe(5);
    expect(res.head).toEqual({ seq: 5, hash: rows[4].hash });
  });

  it('detects an edited field (hash)', () => {
    const rows = chain(5);
    rows[2] = { ...rows[2], action: 'DELETE /api/v1/hr/employees/:id' };
    expect(verify(rows).firstBreak).toEqual({ seq: 3, id: 'row3', reason: 'hash' });
  });

  it('detects an edited body that kept its digest (body)', () => {
    const rows = chain(5);
    rows[1] = { ...rows[1], after: JSON.stringify({ firstName: 'Someone else' }) };
    expect(verify(rows).firstBreak).toMatchObject({ seq: 2, reason: 'body' });
  });

  it('detects a removed row (gap)', () => {
    const rows = chain(5);
    rows.splice(2, 1);
    expect(verify(rows).firstBreak).toMatchObject({ seq: 3, reason: 'gap' });
  });

  it('detects a re-hashed history that no longer links (link)', () => {
    const rows = chain(5);
    // attacker rewrites row 3 and recomputes its own hash, but row 4 still points at the old one
    const forged = { ...rows[2], action: 'forged' };
    rows[2] = { ...forged, hash: rowHash(forged) };
    expect(verify(rows).firstBreak).toMatchObject({ seq: 4, reason: 'link' });
  });

  it('catches a fully re-hashed chain with a seal kept outside', () => {
    const original = chain(5);
    const seal = { kind: 'DAILY', seq: 5, hash: original[4].hash };
    // attacker rewrites row 2 and recomputes every following hash: links all hold…
    const rewritten = chain(5).map((r) => ({ ...r }));
    let prev = { seq: 1, hash: rewritten[0].hash };
    for (let i = 1; i < 5; i++) {
      const r = rewritten[i];
      const after = i === 1 ? JSON.stringify({ firstName: 'Forged' }) : r.after;
      const base = { ...r, prevHash: prev.hash, after, bodyDigest: bodyDigest(null, after) };
      rewritten[i] = { ...base, hash: rowHash(base) };
      prev = { seq: r.seq, hash: rewritten[i].hash };
    }
    expect(verify(rewritten).ok).toBe(true); // …so only the seal can tell
    expect(verify(rewritten, [seal]).firstBreak).toMatchObject({ seq: 5, reason: 'seal' });
  });

  it('detects a cut tail through a seal past the head', () => {
    const rows = chain(5);
    const seal = { kind: 'EXPORT', seq: 5, hash: rows[4].hash };
    expect(verify(rows.slice(0, 3), [seal]).firstBreak).toMatchObject({ seq: 5, reason: 'seal' });
  });

  it('accepts an erased body: the digest is still in the hash', () => {
    const rows = chain(3);
    rows[1] = { ...rows[1], after: null, redacted: true };
    const res = verify(rows);
    expect(res.ok).toBe(true);
    expect(res.redacted).toBe(1);
  });

  it('resumes from a retention anchor', () => {
    const rows = chain(6);
    const anchor = { kind: 'ANCHOR', seq: 3, hash: rows[2].hash };
    const res = verify(rows.slice(3), [anchor], { seq: 3, hash: rows[2].hash });
    expect(res.ok).toBe(true);
    expect(res.entries).toBe(3);
  });
});
