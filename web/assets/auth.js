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

const config = await loadPublicConfig();
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

if (params.get('lead_id')) {
  const leadField = document.getElementById('lead_id');
  if (leadField) leadField.value = params.get('lead_id');
}
if (params.get('email')) {
  const signupEmail = document.getElementById('signup_email');
  const loginEmail = document.getElementById('login_email');
  if (signupEmail) signupEmail.value = params.get('email');
  if (loginEmail) loginEmail.value = params.get('email');
}
if (params.get('nome')) {
  const nome = document.getElementById('signup_nome');
  if (nome) nome.value = params.get('nome');
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
  setStatus('Criando conta…', '');
  try {
    const { response, result } = await postAuth('/api/auth/signup', signupForm);
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? 'Não deu pra criar a conta.', 'err');
      return;
    }
    const next = new URL('/conta', window.location.origin);
    const leadId = document.getElementById('lead_id')?.value;
    if (leadId) next.searchParams.set('lead_id', leadId);
    window.location.href = next.href;
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
    window.location.href = '/conta';
  } catch {
    setStatus('Não deu pra entrar agora.', 'err');
  }
});
