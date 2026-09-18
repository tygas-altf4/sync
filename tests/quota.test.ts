import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InMemoryQuotaUsageStore,
  PLAN_CODES,
  PLAN_QUOTAS,
  Quota,
  QuotaDeniedError,
  currentPeriodYyyymm,
  isPlanCode,
  notesQuotaForPlan,
} from '../src/quota/Quota.ts';

const ACCOUNT = 'acct-test';
const PERIOD = '2026-09';

function quotaWithUsage(notes_used: number, notes_quota: number): Quota {
  const store = new InMemoryQuotaUsageStore([
    {
      account_id: ACCOUNT,
      period_yyyymm: PERIOD,
      notes_used,
      notes_quota,
    },
  ]);
  return new Quota(store);
}

describe('Quota — plan_codes', () => {
  it('mapeia free50|starter89|pro249|scale549 → 50/150/1000/4000', () => {
    assert.deepEqual(PLAN_QUOTAS, {
      free50: 50,
      starter89: 150,
      pro249: 1000,
      scale549: 4000,
    });
    assert.equal(notesQuotaForPlan('free50'), 50);
    assert.equal(notesQuotaForPlan('starter89'), 150);
    assert.equal(notesQuotaForPlan('pro249'), 1000);
    assert.equal(notesQuotaForPlan('scale549'), 4000);
    assert.deepEqual(PLAN_CODES, ['free50', 'starter89', 'pro249', 'scale549']);
    assert.equal(isPlanCode('free50'), true);
    assert.equal(isPlanCode('enterprise'), false);
  });
});

describe('Quota.assert', () => {
  it('bloqueia quando notes_used >= notes_quota', async () => {
    const quota = quotaWithUsage(50, 50);
    await assert.rejects(() => quota.assert(ACCOUNT, PERIOD), (err: unknown) => {
      assert.ok(err instanceof QuotaDeniedError);
      assert.equal(err.status, 429);
      assert.equal(err.code, 'quota.denied');
      return true;
    });
  });

  it('bloqueia quando notes_used ultrapassa a cota', async () => {
    const quota = quotaWithUsage(151, 150);
    await assert.rejects(() => quota.assert(ACCOUNT, PERIOD), QuotaDeniedError);
  });

  it('permite quando notes_used < notes_quota', async () => {
    const quota = quotaWithUsage(49, 50);
    const usage = await quota.assert(ACCOUNT, PERIOD);
    assert.equal(usage.notes_used, 49);
    assert.equal(usage.notes_quota, 50);
  });

  it('sandbox não bloqueia mesmo com cota esgotada', async () => {
    const quota = quotaWithUsage(4000, 4000);
    const usage = await quota.assert(ACCOUNT, PERIOD, { sandbox: true });
    assert.equal(usage.notes_used, 4000);
  });
});

describe('Quota.consumeOnAuthorized', () => {
  it('incrementa notes_used só no caminho de autorização (201)', async () => {
    const store = new InMemoryQuotaUsageStore([
      {
        account_id: ACCOUNT,
        period_yyyymm: PERIOD,
        notes_used: 10,
        notes_quota: 50,
      },
    ]);
    const quota = new Quota(store);

    await quota.assert(ACCOUNT, PERIOD);
    const afterRejectPath = await store.get(ACCOUNT, PERIOD);
    assert.equal(afterRejectPath?.notes_used, 10);

    const after201 = await quota.consumeOnAuthorized(ACCOUNT, PERIOD);
    assert.equal(after201.notes_used, 11);
  });
});

describe('currentPeriodYyyymm', () => {
  it('formata YYYY-MM em UTC-3', () => {
    const period = currentPeriodYyyymm(new Date('2026-09-18T03:00:00.000Z'));
    assert.match(period, /^\d{4}-\d{2}$/);
    assert.equal(period, '2026-09');
  });
});
