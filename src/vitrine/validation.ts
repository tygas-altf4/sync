import { isValidCnpj, digitsOnly } from './cnpj.js';
import {
  PAID_PLAN_CODES,
  PERFIL_VALUES,
  VOLUME_MENSAL_VALUES,
  type LeadInsert,
  type PaidPlanCode,
  type Perfil,
  type VolumeMensal,
} from './types.js';

export type LeadFormInput = {
  nome?: unknown;
  email?: unknown;
  cnpj?: unknown;
  cnpj_pendente?: unknown;
  volume_mensal?: unknown;
  perfil?: unknown;
  lgpd?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  plan_interest?: unknown;
};

export type ValidatedLead = {
  row: LeadInsert;
  plan_interest: PaidPlanCode | 'unset';
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isVolumeMensal(value: string): value is VolumeMensal {
  return (VOLUME_MENSAL_VALUES as readonly string[]).includes(value);
}

export function isPerfil(value: string): value is Perfil {
  return (PERFIL_VALUES as readonly string[]).includes(value);
}

export function isPaidPlanCode(value: string): value is PaidPlanCode {
  return (PAID_PLAN_CODES as readonly string[]).includes(value);
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalText(value: unknown): string | null {
  const text = asTrimmed(value);
  return text === '' ? null : text;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

export function validateLeadInput(input: LeadFormInput):
  | { ok: true; value: ValidatedLead }
  | { ok: false; error: string } {
  const nome = asTrimmed(input.nome);
  if (nome.length < 2) {
    return { ok: false, error: 'Nome é obrigatório.' };
  }

  const email = asTrimmed(input.email).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: 'E-mail inválido.' };
  }

  const cnpjPendente = asBoolean(input.cnpj_pendente);
  const cnpjRaw = asTrimmed(input.cnpj);
  let cnpj: string | null = null;
  if (cnpjPendente) {
    cnpj = null;
  } else if (cnpjRaw !== '') {
    if (!isValidCnpj(cnpjRaw)) {
      return { ok: false, error: 'CNPJ inválido.' };
    }
    cnpj = digitsOnly(cnpjRaw);
  }

  const volume = asTrimmed(input.volume_mensal);
  if (!isVolumeMensal(volume)) {
    return { ok: false, error: 'Volume mensal inválido.' };
  }

  const perfil = asTrimmed(input.perfil);
  if (!isPerfil(perfil)) {
    return { ok: false, error: 'Perfil inválido.' };
  }

  if (!asBoolean(input.lgpd)) {
    return { ok: false, error: 'Aceite LGPD é obrigatório.' };
  }

  const planInterestRaw = asTrimmed(input.plan_interest);
  const plan_interest: PaidPlanCode | 'unset' =
    planInterestRaw === '' || planInterestRaw === 'unset' || planInterestRaw === 'free50'
      ? 'unset'
      : isPaidPlanCode(planInterestRaw)
        ? planInterestRaw
        : 'unset';

  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      plan_interest,
      row: {
        nome,
        email,
        cnpj,
        cnpj_pendente: cnpjPendente,
        volume_mensal: volume,
        perfil,
        lgpd_at: now,
        origem: 'hotsite',
        utm_source: asOptionalText(input.utm_source),
        utm_medium: asOptionalText(input.utm_medium),
        utm_campaign: asOptionalText(input.utm_campaign),
        stage: 'novo',
        account_id: null,
      },
    },
  };
}
