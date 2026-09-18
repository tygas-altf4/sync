export async function loadPublicConfig() {
  const response = await fetch('/api/public-config', { cache: 'no-store' });
  return response.json();
}

export function mountCaptcha(slot, tokenInput, config) {
  if (!slot || !tokenInput) return;
  if (config.turnstileMode === 'live' && config.turnstileSiteKey) {
    const widget = document.createElement('div');
    widget.className = 'cf-turnstile';
    slot.append(widget);
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.addEventListener('load', () => {
      if (!window.turnstile) return;
      window.turnstile.render(widget, {
        sitekey: config.turnstileSiteKey,
        callback: (token) => {
          tokenInput.value = token;
        },
      });
    });
    document.head.append(script);
    return;
  }

  // Sem site key: checkbox honesto. Não inventar Turnstile nem expor nome de env.
  slot.innerHTML = `
    <label class="check stub-captcha">
      <input type="checkbox" id="${slot.id}-stub" />
      <span>Não sou um robô <small>(rascunho — captcha real entra quando as chaves de produção estiverem no ar)</small></span>
    </label>
  `;
  const box = slot.querySelector('input[type="checkbox"]');
  box?.addEventListener('change', () => {
    tokenInput.value = box.checked ? 'stub' : '';
  });
}

export function captchaToken(form) {
  const field = form?.querySelector('[name="turnstile_token"]');
  return field?.value ?? '';
}
