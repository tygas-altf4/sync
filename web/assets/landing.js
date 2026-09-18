import { captchaToken, loadPublicConfig, mountCaptcha } from './captcha.js';

const form = document.getElementById('lead-form');
const statusEl = document.getElementById('form-status');
const cnpjInput = document.getElementById('cnpj');
const cnpjPendente = document.getElementById('cnpj_pendente');
const planInterest = document.getElementById('plan_interest');
const postLead = document.getElementById('post-lead');
const signupBtn = document.getElementById('btn-signup');

let publicConfig;
try {
  publicConfig = await loadPublicConfig();
} catch {
  publicConfig = { turnstileMode: 'stub' };
}
mountCaptcha(document.getElementById('lead-captcha'), document.getElementById('turnstile_token'), publicConfig);

if (window.location.pathname === '/planos') {
  document.getElementById('planos')?.scrollIntoView({ block: 'start' });
}

const params = new URLSearchParams(window.location.search);
for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
  const field = document.getElementById(key);
  if (field) field.value = params.get(key) ?? '';
}

if (params.get('plan')) {
  planInterest.value = params.get('plan');
}

function maskCnpj(value) {
  const d = value.replace(/\D/g, '').slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `/${p4}`;
  if (p5) out += `-${p5}`;
  return out;
}

cnpjInput?.addEventListener('input', () => {
  cnpjInput.value = maskCnpj(cnpjInput.value);
});

function syncCnpjPending() {
  if (!cnpjInput || !cnpjPendente) return;
  const pending = cnpjPendente.checked;
  cnpjInput.disabled = pending;
  if (pending) {
    cnpjInput.value = '';
    cnpjInput.placeholder = 'Completo no onboarding';
  } else {
    cnpjInput.placeholder = '00.000.000/0000-00';
  }
}

cnpjPendente?.addEventListener('change', syncCnpjPending);
syncCnpjPending();

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `form-status ${kind}`;
}

function payloadFromForm() {
  const data = new FormData(form);
  return {
    nome: data.get('nome'),
    email: data.get('email'),
    cnpj: data.get('cnpj'),
    cnpj_pendente: data.get('cnpj_pendente') === 'on',
    volume_mensal: data.get('volume_mensal'),
    perfil: data.get('perfil'),
    lgpd: data.get('lgpd') === 'on',
    utm_source: data.get('utm_source'),
    utm_medium: data.get('utm_medium'),
    utm_campaign: data.get('utm_campaign'),
    plan_interest: data.get('plan_interest'),
    origem: 'hotsite',
    turnstile_token: captchaToken(form),
  };
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Enviando…', '');
  postLead.hidden = true;
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadFromForm()),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? 'Não deu pra salvar agora. Tenta de novo em instantes.', 'err');
      return;
    }
    sessionStorage.setItem('sync_lead_id', result.lead_id);
    const email = form.querySelector('#email')?.value ?? '';
    const nome = form.querySelector('#nome')?.value ?? '';
    if (email) sessionStorage.setItem('sync_lead_email', email);
    if (nome) sessionStorage.setItem('sync_lead_nome', nome);
    setStatus(result.message, 'ok');
    postLead.hidden = false;
    if (signupBtn) signupBtn.href = '/cadastro';
  } catch {
    setStatus('Não deu pra salvar agora. Tenta de novo em instantes.', 'err');
  }
});

async function falarUpgrade(planCode) {
  planInterest.value = planCode;
  const leadId = sessionStorage.getItem('sync_lead_id');
  try {
    await fetch('/api/upgrade-handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: leadId,
        plan_interest: planCode,
        plan_code_current: 'free50',
        stage: leadId ? 'teste' : 'novo',
        source: 'hotsite_plan_cta',
        notes_used: 0,
        notes_quota: 50,
      }),
    });
  } catch {
    /* handoff é stub se o banco não estiver no ar */
  }
  window.location.hash = 'comecar';
  setStatus(
    `Upgrade ${planCode} registrado pra o Dinheiro Bot. Sem cobrança nesta página — deixa seu contato no form.`,
    'ok',
  );
}

for (const button of document.querySelectorAll('[data-upgrade]')) {
  button.addEventListener('click', () => {
    void falarUpgrade(button.getAttribute('data-upgrade'));
  });
}

for (const link of document.querySelectorAll('[data-plan="free50"]')) {
  link.addEventListener('click', () => {
    planInterest.value = '';
  });
}
