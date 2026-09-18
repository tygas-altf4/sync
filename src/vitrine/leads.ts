import { createVitrineStore, type StoreMode, type VitrineStore } from './store.js';
import type { LeadRow, PaidPlanCode } from './types.js';
import { validateLeadInput, type LeadFormInput } from './validation.js';
import { writeUpgradeHandoff } from './handoff.js';

export const LEAD_SUCCESS_MESSAGE = 'Lead criado. Estamos liberando sua cota free…';
export const LEAD_ERROR_MESSAGE = 'Não deu pra salvar agora. Tenta de novo em instantes.';

export type CaptureLeadResult = {
  ok: true;
  stub: boolean;
  message: string;
  lead: LeadRow;
  plan_interest: PaidPlanCode | 'unset';
};

export async function captureLead(
  input: LeadFormInput,
  deps: { store?: VitrineStore; mode?: StoreMode } = {},
): Promise<CaptureLeadResult | { ok: false; error: string }> {
  const parsed = validateLeadInput(input);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const resolved = deps.store
    ? { store: deps.store, mode: deps.mode ?? 'stub' }
    : createVitrineStore();

  try {
    const lead = await resolved.store.insertLead(parsed.value.row);
    if (parsed.value.plan_interest !== 'unset') {
      await writeUpgradeHandoff(
        {
          lead_id: lead.id,
          email: lead.email,
          cnpj: lead.cnpj,
          perfil: lead.perfil,
          volume_mensal: lead.volume_mensal,
          stage: 'novo',
          plan_interest: parsed.value.plan_interest,
          plan_code_current: 'free50',
          notes_used: 0,
          notes_quota: 50,
          source: 'hotsite_plan_cta',
        },
        { store: resolved.store, mode: resolved.mode },
      );
    }
    return {
      ok: true,
      stub: resolved.mode === 'stub',
      message: LEAD_SUCCESS_MESSAGE,
      lead,
      plan_interest: parsed.value.plan_interest,
    };
  } catch (error) {
    console.error('[vitrine] insert leads falhou', error);
    return { ok: false, error: LEAD_ERROR_MESSAGE };
  }
}
