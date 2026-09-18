/**
 * Rate limit dia 1 — form de lead, cadastro e login.
 *
 * Por que existe: captcha sozinho não segura retry automático. O ponto de
 * enforcement é sempre a rota do servidor (nunca o browser).
 *
 * Sem UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN usamos memória do
 * processo (`mode=memory`, stub=true). Serve pra draft/local; não compartilha
 * entre instâncias. Com Upstash, o contador é compartilhado.
 */
export type RateLimitRoute = 'leads' | 'signup' | 'login';

export type RateLimitMode = 'memory' | 'upstash';

export type RateLimitBucket = {
  max: number;
  windowSec: number;
};

/** Tetos conservadores; ajustar com o Dinheiro Bot se o Auth reclamar. */
export const RATE_LIMIT_POLICY: Record<
  RateLimitRoute,
  { ip: RateLimitBucket; email: RateLimitBucket }
> = {
  leads: { ip: { max: 8, windowSec: 15 * 60 }, email: { max: 3, windowSec: 15 * 60 } },
  signup: { ip: { max: 5, windowSec: 15 * 60 }, email: { max: 3, windowSec: 60 * 60 } },
  login: { ip: { max: 10, windowSec: 15 * 60 }, email: { max: 8, windowSec: 15 * 60 } },
};

export type RateLimitInput = {
  route: RateLimitRoute;
  ip: string;
  email?: string | null;
};

export type RateLimitDecision = {
  allowed: boolean;
  stub: boolean;
  mode: RateLimitMode;
  remaining: number;
  retryAfterSec: number;
  limitedBy: 'ip' | 'email' | null;
};

export interface RateLimiter {
  readonly mode: RateLimitMode;
  consume(input: RateLimitInput): Promise<RateLimitDecision>;
}

type Counter = { count: number; resetAtMs: number };

function clampIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed === '' ? 'unknown' : trimmed.slice(0, 128);
}

export function clientIp(headers: {
  'x-forwarded-for'?: string | string[];
  'x-real-ip'?: string | string[];
}, remoteAddress?: string): string {
  const forwarded = headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw && raw.trim() !== '') {
    return clampIp(raw.split(',')[0] ?? 'unknown');
  }
  const real = headers['x-real-ip'];
  const realRaw = Array.isArray(real) ? real[0] : real;
  if (realRaw && realRaw.trim() !== '') {
    return clampIp(realRaw);
  }
  return clampIp(remoteAddress ?? 'unknown');
}

function remainingOf(count: number, max: number): number {
  return Math.max(0, max - count);
}

export class MemoryRateLimiter implements RateLimiter {
  readonly mode = 'memory' as const;
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(input: RateLimitInput): Promise<RateLimitDecision> {
    const policy = RATE_LIMIT_POLICY[input.route];
    const ipHit = this.hit(`ip:${input.route}:${clampIp(input.ip)}`, policy.ip);
    const email = input.email?.trim().toLowerCase() ?? '';
    const emailHit =
      email === '' ? { count: 0, retryAfterSec: 0, max: policy.email.max } : this.hit(`email:${input.route}:${email}`, policy.email);

    if (ipHit.count > policy.ip.max) {
      return {
        allowed: false,
        stub: true,
        mode: this.mode,
        remaining: 0,
        retryAfterSec: ipHit.retryAfterSec,
        limitedBy: 'ip',
      };
    }
    if (email !== '' && emailHit.count > policy.email.max) {
      return {
        allowed: false,
        stub: true,
        mode: this.mode,
        remaining: 0,
        retryAfterSec: emailHit.retryAfterSec,
        limitedBy: 'email',
      };
    }
    return {
      allowed: true,
      stub: true,
      mode: this.mode,
      remaining: Math.min(
        remainingOf(ipHit.count, policy.ip.max),
        remainingOf(emailHit.count, policy.email.max),
      ),
      retryAfterSec: 0,
      limitedBy: null,
    };
  }

  private hit(key: string, bucket: RateLimitBucket): { count: number; retryAfterSec: number; max: number } {
    const now = this.now();
    const current = this.counters.get(key);
    if (current === undefined || current.resetAtMs <= now) {
      const next = { count: 1, resetAtMs: now + bucket.windowSec * 1000 };
      this.counters.set(key, next);
      return { count: 1, retryAfterSec: bucket.windowSec, max: bucket.max };
    }
    current.count += 1;
    return {
      count: current.count,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)),
      max: bucket.max,
    };
  }
}

type UpstashRow = { result?: number | string | null };

export class UpstashRateLimiter implements RateLimiter {
  readonly mode = 'upstash' as const;

  constructor(
    private readonly restUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fallback: RateLimiter = new MemoryRateLimiter(),
  ) {}

  async consume(input: RateLimitInput): Promise<RateLimitDecision> {
    try {
      const policy = RATE_LIMIT_POLICY[input.route];
      const ipCount = await this.incr(`vitrine:rl:ip:${input.route}:${clampIp(input.ip)}`, policy.ip.windowSec);
      const email = input.email?.trim().toLowerCase() ?? '';
      const emailCount =
        email === ''
          ? 0
          : await this.incr(`vitrine:rl:email:${input.route}:${email}`, policy.email.windowSec);

      if (ipCount > policy.ip.max) {
        return {
          allowed: false,
          stub: false,
          mode: this.mode,
          remaining: 0,
          retryAfterSec: policy.ip.windowSec,
          limitedBy: 'ip',
        };
      }
      if (email !== '' && emailCount > policy.email.max) {
        return {
          allowed: false,
          stub: false,
          mode: this.mode,
          remaining: 0,
          retryAfterSec: policy.email.windowSec,
          limitedBy: 'email',
        };
      }
      return {
        allowed: true,
        stub: false,
        mode: this.mode,
        remaining: Math.min(
          remainingOf(ipCount, policy.ip.max),
          remainingOf(emailCount, policy.email.max),
        ),
        retryAfterSec: 0,
        limitedBy: null,
      };
    } catch (error) {
      console.warn('[vitrine] Upstash falhou; caindo no limiter em memória', error);
      return this.fallback.consume(input);
    }
  }

  private async incr(key: string, windowSec: number): Promise<number> {
    const response = await this.fetchImpl(`${this.restUrl.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, windowSec, 'NX'],
      ]),
    });
    if (!response.ok) {
      throw new Error(`upstash ${response.status}`);
    }
    const rows = (await response.json()) as UpstashRow[];
    const count = rows[0]?.result;
    if (typeof count !== 'number') {
      throw new Error('upstash INCR sem número');
    }
    return count;
  }
}

export function createRateLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const url = env['UPSTASH_REDIS_REST_URL']?.trim();
  const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim();
  if (url && token) {
    return new UpstashRateLimiter(url, token);
  }
  return new MemoryRateLimiter();
}

export const RATE_LIMIT_MESSAGE = 'Muitas tentativas. Espera um pouco e tenta de novo.';
