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
  const planLabel = { starter89: 'Starter', pro249: 'Pro', scale549: 'Scale' }[planCode] ?? planCode;
  setStatus(
    `Upgrade ${planLabel} registrado pra o Dinheiro Bot. Sem cobrança nesta página — deixa seu contato no form.`,
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

for (const link of document.querySelectorAll('[data-perfil]')) {
  link.addEventListener('click', () => {
    // Prefill do select sem query string (teste da landing recusa href com ?).
    const perfil = document.getElementById('perfil');
    const value = link.getAttribute('data-perfil');
    if (perfil && value) perfil.value = value;
  });
}

/**
 * Véu leve sobre o still do hero. O canvas não pinta o creme por cima —
 * senão some a foto. Pausa fora da viewport; desliga em low-end /
 * reduced-motion / save-data.
 */
function shouldRunHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const connection = navigator.connection;
  if (connection?.saveData) return false;
  if (window.matchMedia('(max-width: 720px)').matches) return false;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 2) return false;
  return true;
}

function mountHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!(canvas instanceof HTMLCanvasElement) || !shouldRunHeroCanvas()) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const accent = '#b5441f';
  const ink = '#1b1916';
  let playing = false;
  let inView = false;
  let raf = 0;
  let start = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pingPong(timeMs) {
    const cycle = 9000;
    const t = (timeMs % (cycle * 2)) / cycle;
    return t <= 1 ? t : 2 - t;
  }

  function frame(now) {
    if (!playing) return;
    const t = pingPong(now - start);
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * (0.42 + (1 - t) * 0.04));
    ctx.bezierCurveTo(w * 0.28, h * 0.22, w * 0.46, h * 0.5, w * 0.94, h * (0.3 + t * 0.06));
    ctx.strokeStyle = 'rgba(181, 68, 31, 0.38)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    const motes = [
      { x: 0.16 + t * 0.08, y: 0.34, r: 2.4, c: accent },
      { x: 0.58 + (1 - t) * 0.05, y: 0.22, r: 1.7, c: ink },
      { x: 0.82 + t * 0.03, y: 0.4, r: 2.1, c: '#243d32' },
    ];
    for (const mote of motes) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = mote.c;
      ctx.beginPath();
      ctx.arc(mote.x * w, mote.y * h, mote.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    raf = window.requestAnimationFrame(frame);
  }

  function play() {
    if (playing || document.hidden || !inView) return;
    playing = true;
    canvas.classList.add('is-on');
    start = performance.now();
    resize();
    raf = window.requestAnimationFrame(frame);
  }

  function pause() {
    playing = false;
    window.cancelAnimationFrame(raf);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.15);
      if (inView) play();
      else pause();
    },
    { threshold: [0, 0.15, 0.4] },
  );
  observer.observe(canvas.parentElement ?? canvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else play();
  });
  window.addEventListener('resize', resize, { passive: true });
}

mountHeroCanvas();
