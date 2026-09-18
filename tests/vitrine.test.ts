import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_QUOTAS } from '../src/quota/Quota.ts';
import { isValidCnpj } from '../src/vitrine/cnpj.ts';
import { PLAN_DISPLAY, PLAN_PRICES_BRL } from '../src/vitrine/plans.ts';
import { validateLeadInput } from '../src/vitrine/validation.ts';
import { captureLead } from '../src/vitrine/leads.ts';
import { buildHandoffPayload, writeUpgradeHandoff } from '../src/vitrine/handoff.ts';
import { provisionFreeAccount } from '../src/vitrine/signup.ts';
import { MemoryVitrineStore } from '../src/vitrine/store.ts';
import { createVitrineServer } from '../src/vitrine/http.ts';

const VALID_CNPJ = '11.444.777/0001-61';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const landing = readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');

const baseLead = {
  nome: 'Ana Souza',
  email: 'ana@empresa.com.br',
  volume_mensal: 'ate_50',
  perfil: 'empresa',
  lgpd: true,
};

describe('landing copy', () => {
  it('tem as 5 seções e CTAs do brief, sem escola/ads/checkout', () => {
    assert.match(landing, /Emita NFS-e Nacional sem travar no meio do caminho/);
    assert.match(landing, /id="dor"/);
    assert.match(landing, /id="como-funciona"/);
    assert.match(landing, /id="planos"/);
    assert.match(landing, /id="comecar"/);
    assert.match(landing, /Começar grátis/);
    assert.match(landing, /Falar com upgrade/);
    assert.match(landing, /free50/);
    assert.match(landing, /starter89/);
    assert.match(landing, /pro249/);
    assert.match(landing, /scale549/);
    assert.equal(landing.includes('escola'), false);
    assert.equal(landing.includes('pixel'), false);
    assert.equal(landing.includes('checkout'), false);
    assert.match(landing, /https:\/\/sync\.plvria\.com\.br/);
    assert.match(landing, /mailto:plvria@plvria\.com\.br/);
    assert.match(landing, /id="contato"/);
  });
});

describe('schema compartilhado', () => {
  it('Vitrine não inventa coluna fora de 001_schema_minimo', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/001_schema_minimo.sql'), 'utf8');
    const types = readFileSync(path.join(ROOT, 'src/vitrine/types.ts'), 'utf8');
    assert.match(sql, /create table if not exists public.leads/);
    assert.match(sql, /event_type text not null/);
    assert.doesNotMatch(sql, /upgrade_handoff_at/);
    assert.doesNotMatch(types, /upgrade_handoff_at/);
    assert.match(types, /event_type: CrmEventType/);
  });
});

describe('planos (display)', () => {
  it('usa cotas 50/150/1000/4000 e preços 0/89/249/549', () => {
    assert.deepEqual(
      PLAN_DISPLAY.map((plan) => [plan.plan_code, plan.notes_quota, plan.price_brl, plan.cta]),
      [
        ['free50', 50, 0, 'Começar grátis'],
        ['starter89', 150, 89, 'Falar com upgrade'],
        ['pro249', 1000, 249, 'Falar com upgrade'],
        ['scale549', 4000, 549, 'Falar com upgrade'],
      ],
    );
    assert.deepEqual(PLAN_PRICES_BRL, { free50: 0, starter89: 89, pro249: 249, scale549: 549 });
    assert.equal(PLAN_DISPLAY[0]?.notes_quota, PLAN_QUOTAS.free50);
  });
});

describe('CNPJ', () => {
  it('aceita CNPJ válido mascarado e rejeita inválido', () => {
    assert.equal(isValidCnpj(VALID_CNPJ), true);
    assert.equal(isValidCnpj('11444777000161'), true);
    assert.equal(isValidCnpj('11.444.777/0001-62'), false);
    assert.equal(isValidCnpj('00000000000000'), false);
  });
});

describe('validateLeadInput', () => {
  it('grava lgpd_at, origem hotsite, stage novo e dígitos de CNPJ', () => {
    const parsed = validateLeadInput({
      ...baseLead,
      cnpj: VALID_CNPJ,
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'nov2026',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.row.origem, 'hotsite');
    assert.equal(parsed.value.row.stage, 'novo');
    assert.equal(parsed.value.row.account_id, null);
    assert.equal(parsed.value.row.cnpj, '11444777000161');
    assert.equal(parsed.value.row.cnpj_pendente, false);
    assert.equal(parsed.value.row.utm_source, 'newsletter');
    assert.match(parsed.value.row.lgpd_at, /T/);
    assert.equal(parsed.value.plan_interest, 'unset');
  });

  it('permite CNPJ vazio quando cnpj_pendente', () => {
    const parsed = validateLeadInput({ ...baseLead, cnpj_pendente: true });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.row.cnpj, null);
    assert.equal(parsed.value.row.cnpj_pendente, true);
  });

  it('exige LGPD, e-mail e enums do schema', () => {
    assert.equal(validateLeadInput({ ...baseLead, lgpd: false }).ok, false);
    assert.equal(validateLeadInput({ ...baseLead, email: 'sem-arroba' }).ok, false);
    assert.equal(validateLeadInput({ ...baseLead, volume_mensal: 'mil' }).ok, false);
    assert.equal(validateLeadInput({ ...baseLead, perfil: 'escola' }).ok, false);
  });
});

describe('CRM + handoff', () => {
  it('lead novo → conta free50 → teste; nunca marca ativo', async () => {
    const store = new MemoryVitrineStore();
    const captured = await captureLead({ ...baseLead, cnpj_pendente: true }, { store, mode: 'stub' });
    assert.equal(captured.ok, true);
    if (!captured.ok) return;
    assert.equal(captured.stub, true);
    assert.equal(captured.lead.stage, 'novo');
    assert.match(captured.message, /Lead criado/);

    const signed = await provisionFreeAccount(
      { lead_id: captured.lead.id },
      {
        store,
        mode: 'stub',
        user: {
          id: 'user-1',
          email: captured.lead.email,
          nome: captured.lead.nome,
          lead_id: captured.lead.id,
          email_confirmed: true,
          mfa_enrolled: false,
          aal: 'aal1',
        },
      },
    );
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    assert.equal(signed.lead.stage, 'teste');
    assert.equal(signed.account.plan_code, 'free50');
    assert.equal(signed.account.plan_status, 'trialing');
    assert.equal(signed.account.owner_user_id, 'user-1');
    assert.equal(signed.quota.notes_used, 0);
    assert.equal(signed.quota.notes_quota, 50);
    assert.equal(signed.event.event_type, 'stage_change');
    assert.notEqual(signed.lead.stage, 'ativo');
  });

  it('monta payload de upgrade_handoff do mapa e grava crm_events', async () => {
    const store = new MemoryVitrineStore();
    const payload = buildHandoffPayload({
      lead_id: 'lead-1',
      account_id: 'acc-1',
      email: 'ana@empresa.com.br',
      cnpj: '11444777000161',
      perfil: 'empresa',
      volume_mensal: '51_200',
      stage: 'teste',
      plan_interest: 'starter89',
      plan_code_current: 'free50',
      notes_used: 50,
      notes_quota: 50,
      period_yyyymm: '2026-09',
      source: 'hotsite_onboarding_limit',
    });
    assert.deepEqual(payload, {
      lead_id: 'lead-1',
      account_id: 'acc-1',
      email: 'ana@empresa.com.br',
      cnpj: '11444777000161',
      perfil: 'empresa',
      volume_mensal: '51_200',
      stage: 'teste',
      plan_interest: 'starter89',
      plan_code_current: 'free50',
      notes_used: 50,
      notes_quota: 50,
      period_yyyymm: '2026-09',
      source: 'hotsite_onboarding_limit',
    });

    const result = await writeUpgradeHandoff(payload, { store, mode: 'stub' });
    assert.equal(result.ok, true);
    assert.equal(result.stub, true);
    assert.equal(result.event.event_type, 'upgrade_handoff');
    assert.equal(result.payload.plan_interest, 'starter89');
  });
});

describe('HTTP vitrine', () => {
  const store = new MemoryVitrineStore();
  const server = createVitrineServer({ store, mode: 'stub' });
  let base = '';

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET / devolve a landing', async () => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(html, /Começar grátis/);
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
    const cadastro = await fetch(`${base}/cadastro`);
    assert.equal(cadastro.status, 200);
    const cadastroHtml = await cadastro.text();
    assert.match(cadastroHtml, /Criar conta SyncNFe/);
    assert.match(cadastroHtml, /2FA \(TOTP\)/);
    const entrar = await fetch(`${base}/entrar`);
    assert.equal(entrar.status, 200);
  });

  it('POST /api/leads valida e stubba sem service role', async () => {
    const res = await fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseLead, cnpj_pendente: true, lgpd: true }),
    });
    const body = (await res.json()) as { ok: boolean; stub: boolean; stage: string; lead_id: string };
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.stub, true);
    assert.equal(body.stage, 'novo');

    const bad = await fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'A' }),
    });
    assert.equal(bad.status, 400);
  });

  it('POST /api/upgrade-handoff grava tipo upgrade_handoff', async () => {
    const res = await fetch(`${base}/api/upgrade-handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_interest: 'pro249', source: 'hotsite_plan_cta' }),
    });
    const body = (await res.json()) as { ok: boolean; event_type: string; payload: { plan_interest: string } };
    assert.equal(res.status, 200);
    assert.equal(body.event_type, 'upgrade_handoff');
    assert.equal(body.payload.plan_interest, 'pro249');
  });
});
