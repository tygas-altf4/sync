import { currentPeriodYyyymm, PLAN_QUOTAS } from '../quota/Quota.js';
import { ONBOARDING_VERIFY_MESSAGE, type AuthUser } from './auth.js';
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
 * Exige usuário Auth com e-mail verificado. Vitrine nunca marca `ativo`.
 */
export async function provisionFreeAccount(
  input: SignupInput,
  deps: { store?: VitrineStore; mode?: StoreMode; user?: AuthUser | null } = {},
): Promise<SignupResult | { ok: false; error: string; status?: number }> {
  const user = deps.user;
  if (user == null) {
    return { ok: false, error: 'Entre na conta antes de liberar a cota free.', status: 401 };
  }
  if (!user.email_confirmed) {
    return { ok: false, error: ONBOARDING_VERIFY_MESSAGE, status: 403 };
  }

  const leadId =
    (typeof input.lead_id === 'string' ? input.lead_id.trim() : '') || user.lead_id || '';
  if (leadId === '') {
    return { ok: false, error: 'lead_id é obrigatório.', status: 400 };
  }

  const resolved = deps.store
    ? { store: deps.store, mode: deps.mode ?? 'stub' }
    : createVitrineStore();

  try {
    const lead = await resolved.store.getLead(leadId);
    if (lead === null) {
      return { ok: false, error: 'Lead não encontrado.', status: 404 };
    }
    if (lead.email !== user.email) {
      return { ok: false, error: 'Este lead não pertence à conta logada.', status: 403 };
    }

    const account = await resolved.store.insertAccount({
      name: lead.nome,
      plan_code: 'free50',
      plan_status: 'trialing',
      lead_id: lead.id,
      owner_user_id: user.id,
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
      event_type: 'stage_change',
      payload: { from: 'novo', to: 'teste' },
    });

    return { ok: true, stub: resolved.mode === 'stub', lead: updated, account, quota, event };
  } catch (error) {
    console.error('[vitrine] signup falhou', error);
    return {
      ok: false,
      error: 'Não deu pra liberar a cota free agora. Tenta de novo em instantes.',
      status: 500,
    };
  }
}
