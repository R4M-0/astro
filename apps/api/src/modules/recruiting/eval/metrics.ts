/** Evaluation metrics (docs/recruiting, evaluation framework): pure, no I/O. */

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Graded relevance (0-3) → DCG gain. */
const gain = (rel: number) => 2 ** rel - 1;

/** nDCG@k of a ranking against graded labels (missing id = 0). */
export function ndcgAtK(ranked: string[], rel: Record<string, number>, k: number): number {
  const dcg = (gains: number[]) => gains.slice(0, k).reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
  const ideal = dcg(Object.values(rel).map(gain).sort((a, b) => b - a));
  return ideal ? round(dcg(ranked.map((id) => gain(rel[id] ?? 0))) / ideal) : 1;
}

/** Share of the relevant ids found in the first n. */
export function recallAtN(ranked: string[], relevant: Set<string>, n: number): number {
  if (!relevant.size) return 1;
  return round(ranked.slice(0, n).filter((id) => relevant.has(id)).length / relevant.size);
}

export function precisionAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const top = ranked.slice(0, k);
  return top.length ? round(top.filter((id) => relevant.has(id)).length / top.length) : 0;
}

/** Reciprocal rank of the first relevant id. */
export function mrr(ranked: string[], relevant: Set<string>): number {
  const i = ranked.findIndex((id) => relevant.has(id));
  return i < 0 ? 0 : round(1 / (i + 1));
}

/** Kendall τ-b between two paired score lists (handles the ties of graded labels). */
export function kendallTau(a: number[], b: number[]): number {
  let concordant = 0, discordant = 0, tiesA = 0, tiesB = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) {
      const x = Math.sign(a[i] - a[j]), y = Math.sign(b[i] - b[j]);
      if (!x && !y) continue;
      if (!x) tiesA++;
      else if (!y) tiesB++;
      else if (x === y) concordant++;
      else discordant++;
    }
  const d = Math.sqrt((concordant + discordant + tiesA) * (concordant + discordant + tiesB));
  return d ? round((concordant - discordant) / d) : 0;
}

/** Per-class precision / recall / F1 and macro-F1 over the classes that occur. */
export function classification<T extends string>(pairs: { gold: T; pred: T }[]) {
  const classes = [...new Set(pairs.flatMap((p) => [p.gold, p.pred]))];
  const perClass = Object.fromEntries(
    classes.map((c) => {
      const tp = pairs.filter((p) => p.gold === c && p.pred === c).length;
      const precision = tp / (pairs.filter((p) => p.pred === c).length || 1);
      const recall = tp / (pairs.filter((p) => p.gold === c).length || 1);
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      return [c, { precision: round(precision), recall: round(recall), f1: round(f1) }];
    }),
  ) as Record<T, { precision: number; recall: number; f1: number }>;
  const f1s = Object.values<{ f1: number }>(perClass).map((x) => x.f1);
  return { perClass, macroF1: round(f1s.reduce((s, x) => s + x, 0) / (f1s.length || 1)), accuracy: round(pairs.filter((p) => p.gold === p.pred).length / (pairs.length || 1)) };
}

/** Precision / recall / F1 of extracted values vs hand labels; `same` decides when two values match. */
export function setF1(pred: string[], gold: string[], same: (a: string, b: string) => boolean = (a, b) => a === b) {
  const precision = pred.length ? pred.filter((p) => gold.some((g) => same(p, g))).length / pred.length : 1;
  const recall = gold.length ? gold.filter((g) => pred.some((p) => same(p, g))).length / gold.length : 1;
  return { precision: round(precision), recall: round(recall), f1: round(precision + recall ? (2 * precision * recall) / (precision + recall) : 0) };
}

/** Adverse impact ratio (4/5 rule): lowest group selection rate / highest. ≥ 0.8 passes. */
export function adverseImpactRatio(groups: Record<string, { selected: number; total: number }>): number {
  const rates = Object.values(groups).filter((g) => g.total).map((g) => g.selected / g.total);
  const max = Math.max(...rates);
  return max > 0 ? round(Math.min(...rates) / max) : 1;
}

export const mean = (xs: number[]) => round(xs.reduce((s, x) => s + x, 0) / (xs.length || 1));

export function stdDev(xs: number[]) {
  const m = xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  return round(Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length || 1)));
}
