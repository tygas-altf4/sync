import { captchaToken, loadPublicConfig, mountCaptcha } from './captcha.js';

const statusEl = document.getElementById('auth-status');
const signupForm = document.getElementById('signup-form');
const loginForm = document.getElementById('login-form');
const params = new URLSearchParams(window.location.search);

function setStatus(message, kind) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `form-status ${kind}`;
}

let config;
try {
  config = await loadPublicConfig();
} catch {
  config = { turnstileMode: 'stub' };
}
mountCaptcha(
  document.getElementById('signup-captcha'),
  document.getElementById('signup_turnstile'),
  config,
);
mountCaptcha(
  document.getElementById('login-captcha'),
  document.getElementById('login_turnstile'),
  config,
);

const leadId = sessionStorage.getItem('sync_lead_id') || params.get('lead_id');
const emailPrefill = sessionStorage.getItem('sync_lead_email') || params.get('email');
const nomePrefill = sessionStorage.getItem('sync_lead_nome') || params.get('nome');
if (leadId) {
  const leadField = document.getElementById('lead_id');
  if (leadField) leadField.value = leadId;
}
if (emailPrefill) {
  const signupEmail = document.getElementById('signup_email');
  const loginEmail = document.getElementById('login_email');
  if (signupEmail) signupEmail.value = emailPrefill;
  if (loginEmail) loginEmail.value = emailPrefill;
}
if (nomePrefill) {
  const nome = document.getElementById('signup_nome');
  if (nome) nome.value = nomePrefill;
}

async function postAuth(path, form) {
  const data = new FormData(form);
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      nome: data.get('nome'),
      email: data.get('email'),
      password: data.get('password'),
      lead_id: data.get('lead_id'),
      turnstile_token: captchaToken(form),
    }),
  });
  return { response, result: await response.json() };
}

signupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const pass = signupForm.querySelector('[name="password"]')?.value ?? '';
  const confirm = signupForm.querySelector('[name="password_confirm"]')?.value;
  if (confirm !== undefined && confirm !== pass) {
    setStatus('As senhas não batem.', 'err');
    return;
  }
  setStatus('Criando conta…', '');
  try {
    const { response, result } = await postAuth('/api/auth/signup', signupForm);
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? 'Não deu pra criar a conta.', 'err');
      return;
    }
    const signedLead = document.getElementById('lead_id')?.value;
    if (signedLead) sessionStorage.setItem('sync_lead_id', signedLead);
    window.location.href = '/app';
  } catch {
    setStatus('Não deu pra criar a conta agora.', 'err');
  }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Entrando…', '');
  try {
    const { response, result } = await postAuth('/api/auth/login', loginForm);
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? 'Não deu pra entrar.', 'err');
      return;
    }
    window.location.href = '/app';
  } catch {
    setStatus('Não deu pra entrar agora.', 'err');
  }
});
