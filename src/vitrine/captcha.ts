export type CaptchaResult = { ok: true; stub: boolean } | { ok: false; error: string };

export type CaptchaVerifier = (token: unknown) => Promise<CaptchaResult>;

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function loadTurnstileSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env['TURNSTILE_SECRET_KEY']?.trim() ?? '';
  return secret === '' ? null : secret;
}

export function createTurnstileVerifier(
  options: {
    secretKey?: string | null;
    fetchImpl?: typeof fetch;
  } = {},
): CaptchaVerifier {
  const secret = options.secretKey === undefined ? loadTurnstileSecret() : options.secretKey;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (token: unknown): Promise<CaptchaResult> => {
    if (!secret) {
      return { ok: true, stub: true };
    }
    const value = typeof token === 'string' ? token.trim() : '';
    if (value === '') {
      return { ok: false, error: 'Captcha obrigatório.' };
    }
    const response = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: value }).toString(),
    });
    if (!response.ok) {
      return { ok: false, error: 'Captcha inválido.' };
    }
    const body = (await response.json()) as { success?: boolean };
    if (body.success !== true) {
      return { ok: false, error: 'Captcha inválido.' };
    }
    return { ok: true, stub: false };
  };
}
