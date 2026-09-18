import { PLAN_QUOTAS } from '../quota/Quota.js';
import type { PlanCode } from '../types.js';

/**
 * Copy de exibição (Dinheiro Bot define preço; Vitrine só mostra).
 * Esta página não processa pagamento.
 */
export const PLAN_PRICES_BRL = {
  free50: 0,
  starter89: 89,
  pro249: 249,
  scale549: 549,
} as const satisfies Record<PlanCode, number>;

export type PlanCta = 'Começar grátis' | 'Falar com upgrade';

export type PlanDisplay = {
  plan_code: PlanCode;
  label: string;
  notes_quota: number;
  price_brl: number;
  blurb: string;
  cta: PlanCta;
  featured: boolean;
};

export const PLAN_DISPLAY: readonly PlanDisplay[] = [
  {
    plan_code: 'free50',
    label: 'Free50',
    notes_quota: PLAN_QUOTAS.free50,
    price_brl: PLAN_PRICES_BRL.free50,
    blurb: 'Pra validar o fluxo de verdade. 50 emissões pra não ficar só no slide.',
    cta: 'Começar grátis',
    featured: true,
  },
  {
    plan_code: 'starter89',
    label: 'Starter',
    notes_quota: PLAN_QUOTAS.starter89,
    price_brl: PLAN_PRICES_BRL.starter89,
    blurb: 'Quando a cota free acabou e a operação já tá rodando.',
    cta: 'Falar com upgrade',
    featured: false,
  },
  {
    plan_code: 'pro249',
    label: 'Pro',
    notes_quota: PLAN_QUOTAS.pro249,
    price_brl: PLAN_PRICES_BRL.pro249,
    blurb: 'Volume médio — menos atrito, mais emissão.',
    cta: 'Falar com upgrade',
    featured: false,
  },
  {
    plan_code: 'scale549',
    label: 'Scale',
    notes_quota: PLAN_QUOTAS.scale549,
    price_brl: PLAN_PRICES_BRL.scale549,
    blurb: 'Operação pesada / escritório com vários CNPJs no radar.',
    cta: 'Falar com upgrade',
    featured: false,
  },
] as const;
