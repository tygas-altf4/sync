import type { PlanCode } from '../types.js';

/** Estágios CRM (um ativo por lead). Vitrine nunca seta `ativo` sozinha. */
export type CrmStage = 'novo' | 'teste' | 'ativo' | 'perdido';

export type VolumeMensal = 'ate_50' | '51_200' | '201_500' | '500_mais' | 'nao_sei';

export type Perfil = 'empresa' | 'contador' | 'outro';

export type CrmEventType = 'upgrade_handoff' | 'upgrade_confirmed' | 'stage_change';

export const VOLUME_MENSAL_VALUES = [
  'ate_50',
  '51_200',
  '201_500',
  '500_mais',
  'nao_sei',
] as const satisfies readonly VolumeMensal[];

export const PERFIL_VALUES = ['empresa', 'contador', 'outro'] as const satisfies readonly Perfil[];

export const PAID_PLAN_CODES = ['starter89', 'pro249', 'scale549'] as const satisfies readonly Exclude<
  PlanCode,
  'free50'
>[];

export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number];

export type LeadInsert = {
  nome: string;
  email: string;
  cnpj: string | null;
  cnpj_pendente: boolean;
  volume_mensal: VolumeMensal;
  perfil: Perfil;
  lgpd_at: string;
  origem: 'hotsite';
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  stage: CrmStage;
  account_id: string | null;
};

export type LeadRow = LeadInsert & {
  id: string;
  created_at: string;
};

export type AccountInsert = {
  name: string;
  plan_code: 'free50';
  plan_status: 'trialing';
  lead_id: string;
  owner_user_id: string | null;
};

export type AccountRow = AccountInsert & {
  id: string;
  created_at: string;
};

export type QuotaUsageInsert = {
  account_id: string;
  period_yyyymm: string;
  notes_used: number;
  notes_quota: number;
};

export type QuotaUsageRow = QuotaUsageInsert;

export type UpgradeHandoffPayload = {
  lead_id: string | null;
  account_id: string | null;
  email: string | null;
  cnpj: string | null;
  perfil: Perfil | null;
  volume_mensal: VolumeMensal | null;
  stage: CrmStage;
  plan_interest: PaidPlanCode | 'unset';
  plan_code_current: PlanCode;
  notes_used: number;
  notes_quota: number;
  period_yyyymm: string;
  source: string;
};

export type CrmEventInsert = {
  lead_id: string | null;
  account_id: string | null;
  event_type: CrmEventType;
  payload: Record<string, unknown>;
};

export type CrmEventRow = CrmEventInsert & {
  id: string;
  created_at: string;
};
