import { currentPeriodYyyymm, PLAN_QUOTAS } from '../quota/Quota.js';
import { createVitrineStore, type StoreMode, type VitrineStore } from './store.js';
import type { AccountRow, CrmEventRow, LeadRow, QuotaUsageRow } from './types.js';

export type SignupInput = {
  lead_id?: unknown;
};

export type SignupResult = {
  ok: true;
  stub: boolean;
  lead: LeadRow;
  account: AccountRow;
  quota: QuotaUsageRow;
  event: CrmEventRow;
};

/**
 * Conta free50 + quota_usage do mês + lead `teste`.
 * Sem Supabase Auth neste draft (`owner_user_id` fica null).
 * Vitrine nunca marca `ativo`.
 */
export async function provisionFreeAccount(
  input: SignupInput,
  deps: { store?: VitrineStore; mode?: StoreMode } = {},
): Promise<SignupResult | { ok: false; error: string }> {
  const leadId = typeof input.lead_id === 'string' ? input.lead_id.trim() : '';
  if (leadId === '') {
    return { ok: false, error: 'lead_id é obrigatório.' };
  }

  const resolved = deps.store
    ? { store: deps.store, mode: deps.mode ?? 'stub' }
    : createVitrineStore();

  try {
    const lead = await resolved.store.getLead(leadId);
    if (lead === null) {
      return { ok: false, error: 'Lead não encontrado.' };
    }

    const account = await resolved.store.insertAccount({
      name: lead.nome,
      plan_code: 'free50',
      plan_status: 'trialing',
      lead_id: lead.id,
      owner_user_id: null,
    });

    const period = currentPeriodYyyymm();
    const quota = await resolved.store.insertQuotaUsage({
      account_id: account.id,
      period_yyyymm: period,
      notes_used: 0,
      notes_quota: PLAN_QUOTAS.free50,
    });

    const updated = await resolved.store.updateLead(lead.id, {
      account_id: account.id,
      stage: 'teste',
    });

    const event = await resolved.store.insertCrmEvent({
      lead_id: lead.id,
      account_id: account.id,
      type: 'stage_change',
      payload: { from: 'novo', to: 'teste' },
    });

    return { ok: true, stub: resolved.mode === 'stub', lead: updated, account, quota, event };
  } catch (error) {
    console.error('[vitrine] signup falhou', error);
    return { ok: false, error: 'Não deu pra liberar a cota free agora. Tenta de novo em instantes.' };
  }
}
