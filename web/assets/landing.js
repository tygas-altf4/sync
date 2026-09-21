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
 * Luz de cinema sobre o still: um véu que atravessa e pouca poeira.
 * Não pinta creme opaco — a nota ilustrada precisa continuar visível.
 * Desliga em reduced-motion, save-data, viewport estreito e CPU fraca.
 * ~30 fps, DPR limitado, pausa fora da viewport.
 */
function prefersStill() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  const connection = navigator.connection;
  return Boolean(connection?.saveData);
}

function heroCanvasAllowed() {
  if (prefersStill()) return false;
  if (window.matchMedia('(max-width: 960px)').matches) return false;
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores > 2;
}

function mountHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  const frame = canvas?.parentElement;
  if (!(canvas instanceof HTMLCanvasElement) || !frame) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const motes = [
    { ox: 0.14, oy: 0.28, r: 1.3, c: '#b5441f', v: 0.045 },
    { ox: 0.32, oy: 0.46, r: 1.1, c: '#1b1916', v: 0.03 },
    { ox: 0.58, oy: 0.22, r: 1.5, c: '#243d32', v: 0.038 },
    { ox: 0.74, oy: 0.4, r: 1.2, c: '#b5441f', v: 0.026 },
    { ox: 0.88, oy: 0.3, r: 1.1, c: '#1b1916', v: 0.034 },
    { ox: 0.46, oy: 0.55, r: 1.4, c: '#c4a574', v: 0.022 },
  ];
  let playing = false;
  let inView = false;
  let raf = 0;
  let start = 0;
  let last = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(now) {
    const t = (now - start) / 1000;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const travel = 0.5 + 0.5 * Math.sin(t * 0.42);
    const x = w * (0.16 + 0.68 * travel);
    const y = h * (0.42 + 0.05 * Math.sin(t * 0.27));
    const radius = Math.max(w, h) * 0.62;
    const glow = ctx.createRadialGradient(x, y, radius * 0.04, x, y, radius);
    glow.addColorStop(0, 'rgba(255, 250, 243, 0.32)');
    glow.addColorStop(0.38, 'rgba(181, 68, 31, 0.055)');
    glow.addColorStop(1, 'rgba(243, 239, 230, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const curve = 0.5 + 0.5 * Math.sin(t * 0.35);
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * (0.58 - curve * 0.06));
    ctx.bezierCurveTo(
      w * 0.28,
      h * (0.3 + curve * 0.08),
      w * 0.62,
      h * (0.62 - curve * 0.1),
      w * 0.96,
      h * (0.36 + curve * 0.05),
    );
    ctx.strokeStyle = 'rgba(181, 68, 31, 0.32)';
    ctx.lineWidth = 1.15;
    ctx.stroke();

    for (let i = 0; i < motes.length; i += 1) {
      const mote = motes[i];
      const drift = t * mote.v + i;
      const mx = ((mote.ox + Math.sin(drift) * 0.035) % 1) * w;
      const my = (mote.oy + Math.cos(drift * 0.8) * 0.03) * h;
      ctx.globalAlpha = 0.22 + (i % 3) * 0.08;
      ctx.fillStyle = mote.c;
      ctx.beginPath();
      ctx.arc(mx, my, mote.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const scratch = t % 13;
    if (scratch < 0.28) {
      const sx = w * (0.22 + (scratch / 0.28) * 0.5);
      ctx.strokeStyle = 'rgba(27, 25, 22, 0.14)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx, h * 0.12);
      ctx.lineTo(sx + 6, h * 0.78);
      ctx.stroke();
    }
  }

  function frame(now) {
    if (!playing) return;
    raf = window.requestAnimationFrame(frame);
    if (now - last < 32) return;
    last = now;
    draw(now);
  }

  function play() {
    if (!heroCanvasAllowed() || playing || document.hidden || !inView) return;
    playing = true;
    frame.classList.add('is-live');
    canvas.classList.add('is-on');
    start = performance.now();
    last = 0;
    resize();
    raf = window.requestAnimationFrame(frame);
  }

  function pause() {
    playing = false;
    frame.classList.remove('is-live');
    canvas.classList.remove('is-on');
    window.cancelAnimationFrame(raf);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.2);
      if (inView) play();
      else pause();
    },
    { threshold: [0, 0.2, 0.45] },
  );
  observer.observe(frame);

  function onVisibility() {
    if (document.hidden) pause();
    else play();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', () => {
    if (!heroCanvasAllowed()) pause();
    else if (playing) resize();
    else play();
  }, { passive: true });

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced.addEventListener('change', () => {
    if (prefersStill()) pause();
    else play();
  });
}

/**
 * Microinterações do fluxo só enquanto a faixa está na tela.
 * Reduced-motion e save-data ficam no estado parado (selo, visto, arquivos visíveis).
 */
function mountFlowMotion() {
  const stage = document.querySelector('.flow-stage');
  if (!stage) return;

  let inView = false;
  const sync = () => {
    stage.classList.toggle('is-live', inView && !document.hidden && !prefersStill());
  };

  const observer = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      sync();
    },
    { threshold: 0.25 },
  );
  observer.observe(stage);
  document.addEventListener('visibilitychange', sync);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sync);
}

mountHeroCanvas();
mountFlowMotion();
