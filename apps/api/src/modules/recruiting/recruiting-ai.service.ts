import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CLAUDE_MODEL = 'claude-opus-5-5';
const COLLECTION = 'astro_candidates';

export interface RetrievalHit {
  id: string;
  score: number;
  /** XQdrant score_explanation: the dimensions that drove the match */
  topDimensions: { dimension: number; contribution: number }[];
}

/**
 * The three external services of pipeline 1: Claude (profile / requirement extractor, judge),
 * OpenAI embeddings (both towers) and XQdrant (explainable vector search).
 */
@Injectable()
export class RecruitingAiService {
  private claudeClient?: Anthropic;
  private collectionReady = false;

  constructor(private readonly config: ConfigService) {}

  // lazy: the API boots without ANTHROPIC_API_KEY; only the pipeline needs it
  private get claude() {
    return (this.claudeClient ??= new Anthropic());
  }

  /** One Claude call constrained to `schema` (structured outputs), parsed. */
  async structured<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
    const res = await this.claude.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      // a safety-classifier decline is re-run server-side on Anthropic's recommended fallback
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined the request');
    if (res.stop_reason === 'max_tokens') throw new Error('Claude output truncated (max_tokens)');
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Claude returned no text');
    return JSON.parse(text.text) as T;
  }

  async embed(input: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.getOrThrow<string>('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify({ model: this.config.get('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'), input }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    return body.data[0].embedding;
  }

  private async xq<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const base = this.config.get('XQDRANT_URL', 'http://localhost:6343');
    const res = await fetch(`${base}/collections/${COLLECTION}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw Object.assign(new Error(`XQdrant ${method} ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
    return ((await res.json()) as { result: T }).result;
  }

  /** Creates the collection (cosine, sized from the first vector) and the tenant payload indexes. */
  private async ensureCollection(size: number) {
    if (this.collectionReady) return;
    try {
      await this.xq('GET', '');
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
      await this.xq('PUT', '', { vectors: { size, distance: 'Cosine' } });
      for (const field of ['organizationId', 'jobOpeningId']) {
        await this.xq('PUT', '/index?wait=true', { field_name: field, field_schema: 'keyword' });
      }
    }
    this.collectionReady = true;
  }

  async upsertCandidate(id: string, vector: number[], payload: { organizationId: string; jobOpeningId: string }) {
    await this.ensureCollection(vector.length);
    await this.xq('PUT', '/points?wait=true', { points: [{ id, vector, payload }] });
  }

  /** Best effort: a stale point is harmless, ranking only keeps hits that are live candidates. */
  async deleteCandidate(id: string) {
    await this.xq('POST', '/points/delete?wait=true', { points: [id] }).catch(() => undefined);
  }

  /** Stage 1 → 2: top-N candidates of one opening for the job vector, with explanations. */
  async searchCandidates(vector: number[], organizationId: string, jobOpeningId: string, limit: number): Promise<RetrievalHit[]> {
    await this.ensureCollection(vector.length);
    const hits = await this.xq<
      { id: string; score: number; score_explanation?: { top_dimensions: RetrievalHit['topDimensions'] } }[]
    >('POST', '/points/search', {
      vector,
      limit,
      filter: {
        must: [
          { key: 'organizationId', match: { value: organizationId } },
          { key: 'jobOpeningId', match: { value: jobOpeningId } },
        ],
      },
      with_explanation: true,
    });
    return hits.map((h) => ({ id: String(h.id), score: h.score, topDimensions: h.score_explanation?.top_dimensions ?? [] }));
  }
}
