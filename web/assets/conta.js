import { loadPublicConfig } from './captcha.js';

const statusEl = document.getElementById('conta-status');
const unverified = document.getElementById('unverified');
const verified = document.getElementById('verified');
const guest = document.getElementById('guest');
const stubBtn = document.getElementById('btn-confirm-stub');
const provisionBtn = document.getElementById('btn-provision');
const logoutBtn = document.getElementById('btn-logout');
const params = new URLSearchParams(window.location.search);

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `form-status ${kind}`;
}

async function session() {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
  return response.json();
}

const config = await loadPublicConfig();
const state = await session();

if (!state.user) {
  guest.hidden = false;
  setStatus('Sem sessão.', '');
} else if (!state.user.email_confirmed) {
  unverified.hidden = false;
  setStatus(
    `Conta ${state.user.email} ainda sem e-mail confirmado. Onboarding bloqueado.`,
    'err',
  );
  if (config.authMode === 'stub') {
    stubBtn.hidden = false;
  }
} else {
  verified.hidden = false;
  setStatus(`E-mail confirmado: ${state.user.email}`, 'ok');
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

provisionBtn?.addEventListener('click', async () => {
  const leadId = params.get('lead_id') || state.user?.lead_id;
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
