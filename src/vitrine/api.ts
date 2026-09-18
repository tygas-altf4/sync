/**
 * Rotas `/api/*` da Vitrine. Compartilhado entre o servidor Node (`npm run web`)
 * e o Worker de preview Cloudflare — mesmo stub/live, sem API fiscal.
 */
import { captureLead, LEAD_ERROR_MESSAGE } from './leads.js';
import { writeUpgradeHandoff } from './handoff.js';
import { provisionFreeAccount } from './signup.js';
import { createVitrineStore, type VitrineStore } from './store.js';
import { createAuthService, mfaRequired, normalizeEmail, type AuthService } from './auth.js';
import { createTurnstileVerifier, type CaptchaVerifier } from './captcha.js';
import { assertNoSecrets, loadPublicConfig, type PublicVitrineConfig } from './public-config.js';
import {
  createRateLimiter,
  RATE_LIMIT_MESSAGE,
  type RateLimiter,
  type RateLimitRoute,
} from './rate-limit.js';
import { readSessionTokenFromHeader } from './session.js';

export const MAX_BODY_BYTES = 32_768;

export type VitrineRuntime = {
  store: VitrineStore;
  mode: 'supabase' | 'stub';
  auth: AuthService;
  captcha: CaptchaVerifier;
  publicConfig: PublicVitrineConfig;
  rateLimiter: RateLimiter;
};

export type VitrineHttpOptions = {
  store?: VitrineStore;
  mode?: 'supabase' | 'stub';
  auth?: AuthService;
  captcha?: CaptchaVerifier;
  publicConfig?: PublicVitrineConfig;
  rateLimiter?: RateLimiter;
};

export type VitrineApiRequest = {
  method: string;
  pathname: string;
  cookieHeader?: string | null;
  ip: string;
  readJsonBody: () => Promise<unknown>;
};

export type VitrineApiResponse = {
  status: number;
  body: unknown;
  extraHeaders?: Record<string, string>;
  /** token para gravar cookie; `null` limpa; omitido = sem mudança */
  sessionToken?: string | null;
};

export function createVitrineRuntime(options: VitrineHttpOptions = {}): VitrineRuntime {
  const resolvedStore =
    options.store !== undefined
      ? { store: options.store, mode: options.mode ?? 'stub' }
      : createVitrineStore();
  return {
    store: resolvedStore.store,
    mode: resolvedStore.mode,
    auth: options.auth ?? createAuthService(),
    captcha: options.captcha ?? createTurnstileVerifier(),
    publicConfig: options.publicConfig ?? loadPublicConfig(),
    rateLimiter: options.rateLimiter ?? createRateLimiter(),
  };
}

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function jsonResult(
  status: number,
  body: unknown,
  extra: { extraHeaders?: Record<string, string>; sessionToken?: string | null } = {},
): VitrineApiResponse {
  return {
    status,
    body,
    extraHeaders: extra.extraHeaders,
    sessionToken: extra.sessionToken,
  };
}

async function enforceRateLimit(
  req: VitrineApiRequest,
  runtime: VitrineRuntime,
  route: RateLimitRoute,
  email: unknown,
): Promise<VitrineApiResponse | null> {
  const decision = await runtime.rateLimiter.consume({
    route,
    ip: req.ip,
    email: typeof email === 'string' ? email : null,
  });
  if (decision.allowed) {
    return null;
  }
  return jsonResult(
    429,
    { ok: false, error: RATE_LIMIT_MESSAGE, stub: decision.stub, limitedBy: decision.limitedBy },
    { extraHeaders: { 'Retry-After': String(decision.retryAfterSec) } },
  );
}

/**
 * `null` = não é rota de API (o adapter serve estático).
 */
export async function handleVitrineApi(
  req: VitrineApiRequest,
  runtime: VitrineRuntime,
): Promise<VitrineApiResponse | null> {
  const method = req.method;
  const pathname = req.pathname;

  if (method === 'GET' && pathname === '/api/public-config') {
    const payload = runtime.publicConfig;
    assertNoSecrets(payload);
    return jsonResult(200, {
      ...payload,
      rateLimitMode: runtime.rateLimiter.mode,
    });
  }

  if (method === 'GET' && pathname === '/api/auth/session') {
    const token = readSessionTokenFromHeader(req.cookieHeader);
    const user = token ? await runtime.auth.getUser(token) : null;
    return jsonResult(200, {
      ok: true,
      stub: runtime.auth.mode === 'stub',
      user,
      mfa_required: mfaRequired(user),
      mfa_enrolled: user?.mfa_enrolled ?? false,
      aal: user?.aal ?? null,
    });
  }

  if (method === 'POST' && pathname === '/api/auth/signup') {
    const body = asRecord(await req.readJsonBody());
    const limited = await enforceRateLimit(req, runtime, 'signup', body['email']);
    if (limited) {
      return limited;
    }
    const captcha = await runtime.captcha(body['turnstile_token']);
    if (!captcha.ok) {
      return jsonResult(400, { ok: false, error: captcha.error });
    }
    const result = await runtime.auth.signUp({
      email: normalizeEmail(body['email']),
      password: typeof body['password'] === 'string' ? body['password'] : '',
      nome: typeof body['nome'] === 'string' ? body['nome'] : null,
      lead_id: typeof body['lead_id'] === 'string' ? body['lead_id'] : null,
    });
    if (!result.ok) {
      return jsonResult(result.status, { ok: false, error: result.error });
    }
    return jsonResult(
      200,
      {
        ok: true,
        stub: result.stub,
        user: result.session.user,
        email_confirmed: result.session.user.email_confirmed,
        mfa_required: mfaRequired(result.session.user),
        aal: result.session.user.aal,
      },
      { sessionToken: result.session.access_token },
    );
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = asRecord(await req.readJsonBody());
    const limited = await enforceRateLimit(req, runtime, 'login', body['email']);
    if (limited) {
      return limited;
    }
    const captcha = await runtime.captcha(body['turnstile_token']);
    if (!captcha.ok) {
      return jsonResult(400, { ok: false, error: captcha.error });
    }
    const result = await runtime.auth.signIn({
      email: normalizeEmail(body['email']),
      password: typeof body['password'] === 'string' ? body['password'] : '',
    });
    if (!result.ok) {
      return jsonResult(result.status, { ok: false, error: result.error });
    }
    return jsonResult(
      200,
      {
        ok: true,
        stub: result.stub,
        user: result.session.user,
        email_confirmed: result.session.user.email_confirmed,
        mfa_required: mfaRequired(result.session.user),
        aal: result.session.user.aal,
      },
      { sessionToken: result.session.access_token },
    );
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    return jsonResult(200, { ok: true }, { sessionToken: null });
  }

  if (method === 'POST' && pathname === '/api/auth/confirm-email') {
    const token = readSessionTokenFromHeader(req.cookieHeader);
    if (!token) {
      return jsonResult(401, { ok: false, error: 'Entre na conta para confirmar o e-mail.' });
    }
    const result = await runtime.auth.confirmEmail(token);
    if (!result.ok) {
      return jsonResult(result.status, { ok: false, error: result.error });
    }
    return jsonResult(
      200,
      { ok: true, stub: result.stub, user: result.session.user },
      { sessionToken: result.session.access_token },
    );
  }

  if (method === 'POST' && pathname === '/api/auth/mfa/enroll') {
    const token = readSessionTokenFromHeader(req.cookieHeader);
    const user = token ? await runtime.auth.getUser(token) : null;
    if (!token || user === null) {
      return jsonResult(401, { ok: false, error: 'Entre na conta para ativar o 2FA.' });
    }
    const limited = await enforceRateLimit(req, runtime, 'mfa', user.email);
    if (limited) {
      return limited;
    }
    const result = await runtime.auth.enrollTotp(token);
    if (!result.ok) {
      return jsonResult(result.status, { ok: false, error: result.error });
    }
    return jsonResult(200, {
      ok: true,
      stub: result.stub,
      factor_id: result.factor_id,
      secret: result.secret,
      uri: result.uri,
      qr_code: result.qr_code,
    });
  }

  if (method === 'POST' && pathname === '/api/auth/mfa/verify') {
    const token = readSessionTokenFromHeader(req.cookieHeader);
    const user = token ? await runtime.auth.getUser(token) : null;
    if (!token || user === null) {
      return jsonResult(401, { ok: false, error: 'Entre na conta para confirmar o 2FA.' });
    }
    const limited = await enforceRateLimit(req, runtime, 'mfa', user.email);
    if (limited) {
      return limited;
    }
    const body = asRecord(await req.readJsonBody());
    const result = await runtime.auth.verifyTotp(token, {
      code: typeof body['code'] === 'string' ? body['code'] : '',
      factor_id: typeof body['factor_id'] === 'string' ? body['factor_id'] : null,
      challenge_id: typeof body['challenge_id'] === 'string' ? body['challenge_id'] : null,
    });
    if (!result.ok) {
      return jsonResult(result.status, { ok: false, error: result.error });
    }
    return jsonResult(
      200,
      {
        ok: true,
        stub: result.stub,
        user: result.session.user,
        mfa_required: mfaRequired(result.session.user),
        aal: result.session.user.aal,
      },
      { sessionToken: result.session.access_token },
    );
  }

  if (method === 'POST' && pathname === '/api/leads') {
    const body = asRecord(await req.readJsonBody());
    const limited = await enforceRateLimit(req, runtime, 'leads', body['email']);
    if (limited) {
      return limited;
    }
    const captcha = await runtime.captcha(body['turnstile_token']);
    if (!captcha.ok) {
      return jsonResult(400, { ok: false, error: captcha.error });
    }
    const result = await captureLead(body, { store: runtime.store, mode: runtime.mode });
    if (!result.ok) {
      return jsonResult(400, { ok: false, error: result.error });
    }
    return jsonResult(200, {
      ok: true,
      stub: result.stub,
      message: result.message,
      lead_id: result.lead.id,
      stage: result.lead.stage,
      plan_interest: result.plan_interest,
      next: '/entrar',
    });
  }

  if (method === 'POST' && pathname === '/api/signup') {
    const body = asRecord(await req.readJsonBody());
    const token = readSessionTokenFromHeader(req.cookieHeader);
    const user = token ? await runtime.auth.getUser(token) : null;
    const result = await provisionFreeAccount(body, {
      store: runtime.store,
      mode: runtime.mode,
      user,
    });
    if (!result.ok) {
      return jsonResult(result.status ?? 400, { ok: false, error: result.error });
    }
    return jsonResult(200, {
      ok: true,
      stub: result.stub,
      lead_id: result.lead.id,
      account_id: result.account.id,
      stage: result.lead.stage,
      plan_code: result.account.plan_code,
      owner_user_id: result.account.owner_user_id,
      notes_used: result.quota.notes_used,
      notes_quota: result.quota.notes_quota,
      period_yyyymm: result.quota.period_yyyymm,
    });
  }

  if (method === 'POST' && pathname === '/api/upgrade-handoff') {
    const body = asRecord(await req.readJsonBody());
    const result = await writeUpgradeHandoff(body, { store: runtime.store, mode: runtime.mode });
    return jsonResult(200, {
      ok: true,
      stub: result.stub,
      event_id: result.event.id,
      event_type: result.event.event_type,
      payload: result.payload,
    });
  }

  if (pathname.startsWith('/api/')) {
    const status = method === 'GET' || method === 'HEAD' ? 404 : 405;
    return jsonResult(status, {
      ok: false,
      error: status === 404 ? 'Não encontrado.' : 'Método não permitido.',
    });
  }

  return null;
}

export { LEAD_ERROR_MESSAGE };
