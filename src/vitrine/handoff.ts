import { currentPeriodYyyymm, isPlanCode } from '../quota/Quota.js';
import { createVitrineStore, type StoreMode, type VitrineStore } from './store.js';
import { isPaidPlanCode, isPerfil, isVolumeMensal } from './validation.js';
import type {
  CrmEventRow,
  CrmStage,
  PaidPlanCode,
  Perfil,
  UpgradeHandoffPayload,
  VolumeMensal,
} from './types.js';

export type HandoffInput = {
  lead_id?: unknown;
  account_id?: unknown;
  email?: unknown;
  cnpj?: unknown;
  perfil?: unknown;
  volume_mensal?: unknown;
  stage?: unknown;
  plan_interest?: unknown;
  plan_code_current?: unknown;
  notes_used?: unknown;
  notes_quota?: unknown;
  period_yyyymm?: unknown;
  source?: unknown;
};

const CRM_STAGES: readonly CrmStage[] = ['novo', 'teste', 'ativo', 'perdido'];

function asText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function buildHandoffPayload(input: HandoffInput, now: Date = new Date()): UpgradeHandoffPayload {
  const planInterestRaw = asText(input.plan_interest);
  const plan_interest: PaidPlanCode | 'unset' =
    planInterestRaw !== null && isPaidPlanCode(planInterestRaw) ? planInterestRaw : 'unset';

  const currentRaw = asText(input.plan_code_current);
  const plan_code_current =
    currentRaw !== null && isPlanCode(currentRaw) ? currentRaw : 'free50';

  const stageRaw = asText(input.stage);
  const stage: CrmStage =
    stageRaw !== null && (CRM_STAGES as readonly string[]).includes(stageRaw)
      ? (stageRaw as CrmStage)
      : asText(input.lead_id)
        ? 'teste'
        : 'novo';

  const perfilRaw = asText(input.perfil);
  const volumeRaw = asText(input.volume_mensal);

  return {
    lead_id: asText(input.lead_id),
    account_id: asText(input.account_id),
    email: asText(input.email),
    cnpj: asText(input.cnpj),
    perfil: perfilRaw !== null && isPerfil(perfilRaw) ? (perfilRaw as Perfil) : null,
    volume_mensal:
      volumeRaw !== null && isVolumeMensal(volumeRaw) ? (volumeRaw as VolumeMensal) : null,
    stage,
    plan_interest,
    plan_code_current,
    notes_used: asNumber(input.notes_used, 0),
    notes_quota: asNumber(input.notes_quota, 50),
    period_yyyymm: asText(input.period_yyyymm) ?? currentPeriodYyyymm(now),
    source: asText(input.source) ?? 'hotsite_onboarding_limit',
  };
}

export async function writeUpgradeHandoff(
  input: HandoffInput,
  deps: { store?: VitrineStore; mode?: StoreMode } = {},
): Promise<{ ok: true; stub: boolean; event: CrmEventRow; payload: UpgradeHandoffPayload }> {
  const payload = buildHandoffPayload(input);
  const resolved = deps.store
    ? { store: deps.store, mode: deps.mode ?? 'stub' }
    : createVitrineStore();

  if (resolved.mode === 'stub') {
    console.info('[vitrine] stub upgrade_handoff', payload);
  }

  const event = await resolved.store.insertCrmEvent({
    lead_id: payload.lead_id,
    account_id: payload.account_id,
    event_type: 'upgrade_handoff',
    payload,
  });

  return { ok: true, stub: resolved.mode === 'stub', event, payload };
}
