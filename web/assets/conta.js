import { loadPublicConfig } from './captcha.js';

const statusEl = document.getElementById('conta-status');
const unverified = document.getElementById('unverified');
const verified = document.getElementById('verified');
const guest = document.getElementById('guest');
const challenge = document.getElementById('mfa-challenge');
const stubBtn = document.getElementById('btn-confirm-stub');
const provisionBtn = document.getElementById('btn-provision');
const logoutBtn = document.getElementById('btn-logout');
const enrollBtn = document.getElementById('btn-mfa-enroll');
const enrollPanel = document.getElementById('mfa-enroll-panel');
const enrollForm = document.getElementById('mfa-enroll-form');
const challengeForm = document.getElementById('mfa-challenge-form');
const mfaOn = document.getElementById('mfa-on');
const params = new URLSearchParams(window.location.search);

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `form-status ${kind}`;
}

async function session() {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
  return response.json();
}

let config;
try {
  config = await loadPublicConfig();
} catch {
  config = { authMode: 'stub', turnstileMode: 'stub' };
}
const state = await session();

if (!state.user) {
  guest.hidden = false;
  setStatus('Sem sessão.', '');
} else if (!state.user.email_confirmed) {
  unverified.hidden = false;
  setStatus(
    `Conta ${state.user.email} ainda sem e-mail confirmado. Onboarding e 2FA bloqueados.`,
    'err',
  );
  if (config.authMode === 'stub') {
    stubBtn.hidden = false;
  }
} else if (state.mfa_required) {
  challenge.hidden = false;
  setStatus(MFA_WAIT(state.user.email), 'err');
} else {
  verified.hidden = false;
  if (state.user.mfa_enrolled) {
    enrollBtn.hidden = true;
    mfaOn.hidden = false;
    setStatus(`E-mail confirmado e 2FA ativo: ${state.user.email}`, 'ok');
  } else {
    setStatus(`E-mail confirmado: ${state.user.email}. Ative o 2FA (TOTP) abaixo.`, 'ok');
  }
}

function MFA_WAIT(email) {
  return `${email} pediu o código do autenticador. Sem aal2 a sessão continua só com a senha.`;
}

stubBtn?.addEventListener('click', async () => {
  const response = await fetch('/api/auth/confirm-email', {
    method: 'POST',
    credentials: 'same-origin',
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    setStatus(result.error ?? 'Não confirmou.', 'err');
    return;
  }
  window.location.reload();
});

enrollBtn?.addEventListener('click', async () => {
  setStatus('Gerando segredo TOTP…', '');
  const response = await fetch('/api/auth/mfa/enroll', {
    method: 'POST',
    credentials: 'same-origin',
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    setStatus(result.error ?? 'Não deu pra iniciar o 2FA.', 'err');
    return;
  }
  enrollPanel.hidden = false;
  enrollBtn.hidden = true;
  document.getElementById('mfa_factor_id').value = result.factor_id ?? '';
  document.getElementById('mfa-secret').textContent = result.secret ?? '';
  document.getElementById('mfa-uri').textContent = result.uri ?? '';
  const qr = document.getElementById('mfa-qr');
  if (result.qr_code) {
    qr.src = result.qr_code;
    qr.hidden = false;
  }
  setStatus('Escaneie o QR (ou copie o segredo) e confirme o código de 6 dígitos.', '');
});

async function postMfaVerify(form) {
  const data = new FormData(form);
  const response = await fetch('/api/auth/mfa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      code: data.get('code'),
      factor_id: data.get('factor_id') || undefined,
    }),
  });
  return { response, result: await response.json() };
}

enrollForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Confirmando 2FA…', '');
  const { response, result } = await postMfaVerify(enrollForm);
  if (!response.ok || !result.ok) {
    setStatus(result.error ?? 'Código 2FA inválido.', 'err');
    return;
  }
  window.location.reload();
});

challengeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Verificando 2FA…', '');
  const { response, result } = await postMfaVerify(challengeForm);
  if (!response.ok || !result.ok) {
    setStatus(result.error ?? 'Código 2FA inválido.', 'err');
    return;
  }
  window.location.reload();
});

provisionBtn?.addEventListener('click', async () => {
  const leadId =
    sessionStorage.getItem('sync_lead_id') || params.get('lead_id') || state.user?.lead_id;
  setStatus('Liberando cota free…', '');
  const response = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ lead_id: leadId }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    setStatus(result.error ?? 'Não deu pra liberar a cota.', 'err');
    return;
  }
  setStatus(
    `Cota free no ar: ${result.notes_used}/${result.notes_quota} em ${result.period_yyyymm}. Sem cartão nesta etapa.`,
    'ok',
  );
});

logoutBtn?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.href = '/entrar';
});
