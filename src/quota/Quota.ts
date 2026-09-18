import { QuotaDeniedError } from '../errors.js';
import type { PlanCode } from '../types.js';

export { QuotaDeniedError } from '../errors.js';

/**
 * Limites técnicos (enforcement no app), alinhados a
 * `subscriptions.notes_quota` / snapshot em `quota_usage.notes_quota`.
 * Não é copy de pricing.
 */
export const PLAN_QUOTAS = {
  free50: 50,
  starter89: 150,
  pro249: 1000,
  scale549: 4000,
} as const satisfies Record<PlanCode, number>;

export const PLAN_CODES = Object.keys(PLAN_QUOTAS) as PlanCode[];

export type QuotaUsage = {
  account_id: string;
  period_yyyymm: string;
  notes_used: number;
  notes_quota: number;
};

export type QuotaAssertOptions = {
  /** Sandbox não aplica o gate (homologação interna / testes). */
  sandbox?: boolean;
};

export interface QuotaUsageStore {
  get(accountId: string, periodYyyymm: string): Promise<QuotaUsage | null>;
  /**
   * Equivale a `SELECT … FOR UPDATE` em `quota_usage`
   * Unique `(account_id, period_yyyymm)`.
   */
  lockAndGet(accountId: string, periodYyyymm: string): Promise<QuotaUsage>;
  incrementUsed(accountId: string, periodYyyymm: string): Promise<QuotaUsage>;
}

export function notesQuotaForPlan(planCode: PlanCode): number {
  return PLAN_QUOTAS[planCode];
}

export function isPlanCode(value: string): value is PlanCode {
  return value in PLAN_QUOTAS;
}

/** Período `YYYY-MM` em UTC-3 (America/Sao_Paulo). */
export function currentPeriodYyyymm(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (year === undefined || month === undefined) {
    throw new Error('Falha ao formatar period_yyyymm');
  }
  return `${year}-${month}`;
}

export class InMemoryQuotaUsageStore implements QuotaUsageStore {
  private readonly rows = new Map<string, QuotaUsage>();

  constructor(seed: QuotaUsage[] = []) {
    for (const row of seed) {
      this.rows.set(InMemoryQuotaUsageStore.key(row.account_id, row.period_yyyymm), {
        ...row,
      });
    }
  }

  static key(accountId: string, periodYyyymm: string): string {
    return `${accountId}:${periodYyyymm}`;
  }

  async get(accountId: string, periodYyyymm: string): Promise<QuotaUsage | null> {
    return this.rows.get(InMemoryQuotaUsageStore.key(accountId, periodYyyymm)) ?? null;
  }

  async lockAndGet(accountId: string, periodYyyymm: string): Promise<QuotaUsage> {
    const row = await this.get(accountId, periodYyyymm);
    if (row === null) {
      throw new Error(
        `quota_usage não encontrado para ${accountId} / ${periodYyyymm}`,
      );
    }
    return row;
  }

  async incrementUsed(
    accountId: string,
    periodYyyymm: string,
  ): Promise<QuotaUsage> {
    const row = await this.lockAndGet(accountId, periodYyyymm);
    const next: QuotaUsage = { ...row, notes_used: row.notes_used + 1 };
    this.rows.set(InMemoryQuotaUsageStore.key(accountId, periodYyyymm), next);
    return next;
  }
}

/**
 * Gate pré-emissão: bloqueia se `notes_used >= notes_quota` **antes** do wire SEFIN.
 * Incremento atômico só após SEFIN **201** / autorização.
 * Rejeição permanente **não** consome cota.
 */
export class Quota {
  constructor(private readonly store: QuotaUsageStore) {}

  notesQuotaForPlan(planCode: PlanCode): number {
    return notesQuotaForPlan(planCode);
  }

  /**
   * Lê `quota_usage` e lança `QuotaDeniedError` (HTTP 429, `quota.denied`)
   * se a cota do período estiver esgotada.
   */
  async assert(
    accountId: string,
    periodYyyymm: string = currentPeriodYyyymm(),
    options: QuotaAssertOptions = {},
  ): Promise<QuotaUsage> {
    const usage = await this.store.lockAndGet(accountId, periodYyyymm);
    if (options.sandbox === true) {
      return usage;
    }
    if (usage.notes_used >= usage.notes_quota) {
      console.warn('quota.denied', {
        account_id: accountId,
        period_yyyymm: periodYyyymm,
        notes_used: usage.notes_used,
        notes_quota: usage.notes_quota,
      });
      throw new QuotaDeniedError();
    }
    return usage;
  }

  /** Incrementa `notes_used` somente após autorização SEFIN (HTTP 201). */
  async consumeOnAuthorized(
    accountId: string,
    periodYyyymm: string = currentPeriodYyyymm(),
  ): Promise<QuotaUsage> {
    return this.store.incrementUsed(accountId, periodYyyymm);
  }
}
