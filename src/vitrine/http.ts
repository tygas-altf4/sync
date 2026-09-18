/**
 * HTTP da Vitrine (draft). Fachada de GoTrue + tabelas do schema 001
 * (`leads`, `accounts`, `quota_usage`, `crm_events`). Sem API fiscal paralela,
 * sem `subscriptions`/`price_brl` (Dinheiro), sem SEFIN.
 */
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureLead, LEAD_ERROR_MESSAGE } from './leads.js';
import { writeUpgradeHandoff } from './handoff.js';
import { provisionFreeAccount } from './signup.js';
import { createVitrineStore, type VitrineStore } from './store.js';
import { createAuthService, mfaRequired, normalizeEmail, type AuthService } from './auth.js';
import { createTurnstileVerifier, type CaptchaVerifier } from './captcha.js';
import { assertNoSecrets, loadPublicConfig, type PublicVitrineConfig } from './public-config.js';
import { createRateLimiter, clientIp, RATE_LIMIT_MESSAGE, type RateLimiter, type RateLimitRoute } from './rate-limit.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(MODULE_DIR, '../../web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const MAX_BODY_BYTES = 32_768;

export type VitrineHttpOptions = {
  store?: VitrineStore;
  mode?: 'supabase' | 'stub';
  webRoot?: string;
  auth?: AuthService;
  captcha?: CaptchaVerifier;
  publicConfig?: PublicVitrineConfig;
  rateLimiter?: RateLimiter;
};

type Runtime = {
  store: VitrineStore;
  mode: 'supabase' | 'stub';
  auth: AuthService;
  captcha: CaptchaVerifier;
  publicConfig: PublicVitrineConfig;
  rateLimiter: RateLimiter;
};

function json(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  const cookie = res.getHeader('Set-Cookie');
  const headers: OutgoingHttpHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  if (cookie !== undefined) {
    headers['Set-Cookie'] = cookie;
  }
  res.writeHead(status, headers);
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': type.includes('text/html') ? 'no-store' : 'public, max-age=300',
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('body_too_large');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function safeJoin(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '');
  const relative = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}

async function serveStatic(res: ServerResponse, webRoot: string, urlPath: string): Promise<void> {
  // Rotas curtas HTTPS, sem query. /planos serve a landing e o JS rola até #planos.
  // /app = área logada (alias /conta).
  const pageMap: Record<string, string> = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/planos': 'index.html',
    '/planos.html': 'index.html',
    '/privacidade': 'privacidade.html',
    '/privacidade.html': 'privacidade.html',
    '/termos': 'termos.html',
    '/termos.html': 'termos.html',
    '/entrar': 'entrar.html',
    '/entrar.html': 'entrar.html',
    '/cadastro': 'cadastro.html',
    '/cadastro.html': 'cadastro.html',
    '/app': 'conta.html',
    '/app.html': 'conta.html',
    '/conta': 'conta.html',
    '/conta.html': 'conta.html',
  };
  const mapped = pageMap[urlPath] ?? urlPath;
  const filePath = safeJoin(webRoot, mapped);
  if (filePath === null) {
    sendText(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    sendText(res, 200, MIME[ext] ?? 'application/octet-stream', data);
  } catch {
    sendText(res, 404, 'text/html; charset=utf-8', '<!doctype html><title>404</title><p>Não encontrado.</p>');
  }
}

export function createVitrineServer(options: VitrineHttpOptions = {}): Server {
  const webRoot = options.webRoot ?? WEB_ROOT;
  const resolvedStore =
    options.store !== undefined
      ? { store: options.store, mode: options.mode ?? 'stub' }
      : createVitrineStore();
  const runtime: Runtime = {
    store: resolvedStore.store,
    mode: resolvedStore.mode,
    auth: options.auth ?? createAuthService(),
    captcha: options.captcha ?? createTurnstileVerifier(),
    publicConfig: options.publicConfig ?? loadPublicConfig(),
    rateLimiter: options.rateLimiter ?? createRateLimiter(),
  };

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, webRoot, runtime);
  });
}

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

async function enforceRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: Runtime,
  route: RateLimitRoute,
  email: unknown,
): Promise<boolean> {
  const decision = await runtime.rateLimiter.consume({
    route,
    ip: clientIp(req.headers, req.socket.remoteAddress),
    email: typeof email === 'string' ? email : null,
  });
  if (decision.allowed) {
    return true;
  }
  json(
    res,
    429,
    { ok: false, error: RATE_LIMIT_MESSAGE, stub: decision.stub, limitedBy: decision.limitedBy },
    { 'Retry-After': String(decision.retryAfterSec) },
  );
  return false;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  webRoot: string,
  runtime: Runtime,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  try {
    if (method === 'GET' && pathname === '/api/public-config') {
      const payload = runtime.publicConfig;
      assertNoSecrets(payload);
      json(res, 200, {
        ...payload,
        rateLimitMode: runtime.rateLimiter.mode,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/auth/session') {
      const token = readSessionToken(req);
      const user = token ? await runtime.auth.getUser(token) : null;
      json(res, 200, {
        ok: true,
        stub: runtime.auth.mode === 'stub',
        user,
        mfa_required: mfaRequired(user),
        mfa_enrolled: user?.mfa_enrolled ?? false,
        aal: user?.aal ?? null,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/signup') {
      const body = asRecord(await readJsonBody(req));
      if (!(await enforceRateLimit(req, res, runtime, 'signup', body['email']))) {
        return;
      }
      const captcha = await runtime.captcha(body['turnstile_token']);
      if (!captcha.ok) {
        json(res, 400, { ok: false, error: captcha.error });
        return;
      }
      const result = await runtime.auth.signUp({
        email: normalizeEmail(body['email']),
        password: typeof body['password'] === 'string' ? body['password'] : '',
        nome: typeof body['nome'] === 'string' ? body['nome'] : null,
        lead_id: typeof body['lead_id'] === 'string' ? body['lead_id'] : null,
      });
      if (!result.ok) {
        json(res, result.status, { ok: false, error: result.error });
        return;
      }
      setSessionCookie(res, result.session.access_token);
      json(res, 200, {
        ok: true,
        stub: result.stub,
        user: result.session.user,
        email_confirmed: result.session.user.email_confirmed,
        mfa_required: mfaRequired(result.session.user),
        aal: result.session.user.aal,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = asRecord(await readJsonBody(req));
      if (!(await enforceRateLimit(req, res, runtime, 'login', body['email']))) {
        return;
      }
      const captcha = await runtime.captcha(body['turnstile_token']);
      if (!captcha.ok) {
        json(res, 400, { ok: false, error: captcha.error });
        return;
      }
      const result = await runtime.auth.signIn({
        email: normalizeEmail(body['email']),
        password: typeof body['password'] === 'string' ? body['password'] : '',
      });
      if (!result.ok) {
        json(res, result.status, { ok: false, error: result.error });
        return;
      }
      setSessionCookie(res, result.session.access_token);
      json(res, 200, {
        ok: true,
        stub: result.stub,
        user: result.session.user,
        email_confirmed: result.session.user.email_confirmed,
        mfa_required: mfaRequired(result.session.user),
        aal: result.session.user.aal,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      clearSessionCookie(res);
      json(res, 200, { ok: true });
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/confirm-email') {
      const token = readSessionToken(req);
      if (!token) {
        json(res, 401, { ok: false, error: 'Entre na conta para confirmar o e-mail.' });
        return;
      }
      const result = await runtime.auth.confirmEmail(token);
      if (!result.ok) {
        json(res, result.status, { ok: false, error: result.error });
        return;
      }
      setSessionCookie(res, result.session.access_token);
      json(res, 200, { ok: true, stub: result.stub, user: result.session.user });
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/mfa/enroll') {
      const token = readSessionToken(req);
      const user = token ? await runtime.auth.getUser(token) : null;
      if (!token || user === null) {
        json(res, 401, { ok: false, error: 'Entre na conta para ativar o 2FA.' });
        return;
      }
      if (!(await enforceRateLimit(req, res, runtime, 'mfa', user.email))) {
        return;
      }
      const result = await runtime.auth.enrollTotp(token);
      if (!result.ok) {
        json(res, result.status, { ok: false, error: result.error });
        return;
      }
      json(res, 200, {
        ok: true,
        stub: result.stub,
        factor_id: result.factor_id,
        secret: result.secret,
        uri: result.uri,
        qr_code: result.qr_code,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/mfa/verify') {
      const token = readSessionToken(req);
      const user = token ? await runtime.auth.getUser(token) : null;
      if (!token || user === null) {
        json(res, 401, { ok: false, error: 'Entre na conta para confirmar o 2FA.' });
        return;
      }
      if (!(await enforceRateLimit(req, res, runtime, 'mfa', user.email))) {
        return;
      }
      const body = asRecord(await readJsonBody(req));
      const result = await runtime.auth.verifyTotp(token, {
        code: typeof body['code'] === 'string' ? body['code'] : '',
        factor_id: typeof body['factor_id'] === 'string' ? body['factor_id'] : null,
        challenge_id: typeof body['challenge_id'] === 'string' ? body['challenge_id'] : null,
      });
      if (!result.ok) {
        json(res, result.status, { ok: false, error: result.error });
        return;
      }
      setSessionCookie(res, result.session.access_token);
      json(res, 200, {
        ok: true,
        stub: result.stub,
        user: result.session.user,
        mfa_required: mfaRequired(result.session.user),
        aal: result.session.user.aal,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/leads') {
      const body = asRecord(await readJsonBody(req));
      if (!(await enforceRateLimit(req, res, runtime, 'leads', body['email']))) {
        return;
      }
      const captcha = await runtime.captcha(body['turnstile_token']);
      if (!captcha.ok) {
        json(res, 400, { ok: false, error: captcha.error });
        return;
      }
      const result = await captureLead(body, { store: runtime.store, mode: runtime.mode });
      if (!result.ok) {
        json(res, 400, { ok: false, error: result.error });
        return;
      }
      json(res, 200, {
        ok: true,
        stub: result.stub,
        message: result.message,
        lead_id: result.lead.id,
        stage: result.lead.stage,
        plan_interest: result.plan_interest,
        next: '/entrar',
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/signup') {
      const body = asRecord(await readJsonBody(req));
      const token = readSessionToken(req);
      const user = token ? await runtime.auth.getUser(token) : null;
      const result = await provisionFreeAccount(body, {
        store: runtime.store,
        mode: runtime.mode,
        user,
      });
      if (!result.ok) {
        json(res, result.status ?? 400, { ok: false, error: result.error });
        return;
      }
      json(res, 200, {
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
      return;
    }

    if (method === 'POST' && pathname === '/api/upgrade-handoff') {
      const body = asRecord(await readJsonBody(req));
      const result = await writeUpgradeHandoff(body, { store: runtime.store, mode: runtime.mode });
      json(res, 200, {
        ok: true,
        stub: result.stub,
        event_id: result.event.id,
        event_type: result.event.event_type,
        payload: result.payload,
      });
      return;
    }

    if (method === 'GET' || method === 'HEAD') {
      await serveStatic(res, webRoot, pathname);
      return;
    }

    json(res, 405, { ok: false, error: 'Método não permitido.' });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === 'body_too_large')) {
      json(res, 400, { ok: false, error: 'Pedido inválido.' });
      return;
    }
    console.error('[vitrine] http', error);
    json(res, 500, { ok: false, error: LEAD_ERROR_MESSAGE });
  }
}
