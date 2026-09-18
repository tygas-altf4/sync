import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aalFromAccessToken,
  MemoryAuthService,
  MFA_EMAIL_GATE,
  SupabaseAuthService,
} from '../src/vitrine/auth.ts';
import { createVitrineServer } from '../src/vitrine/http.ts';
import { loadPublicConfig } from '../src/vitrine/public-config.ts';
import { MemoryRateLimiter, RATE_LIMIT_POLICY } from '../src/vitrine/rate-limit.ts';
import { totpCode, verifyTotpCode } from '../src/vitrine/totp.ts';
import { MemoryVitrineStore } from '../src/vitrine/store.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cookieFrom(response: Response): string {
  const first = response.headers.getSetCookie()[0] ?? '';
  return first.split(';')[0] ?? '';
}

function fakeJwt(aal: 'aal1' | 'aal2'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aal, role: 'authenticated' })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('TOTP stub', () => {
  it('gera código de 6 dígitos e aceita o passo vizinho', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const now = Date.parse('2026-09-18T12:00:00.000Z');
    const code = totpCode(secret, now);
    assert.match(code, /^\d{6}$/);
    assert.equal(verifyTotpCode(secret, code, now), true);
    assert.equal(verifyTotpCode(secret, code, now + 30_000), true);
    assert.equal(verifyTotpCode(secret, '000000', now), false);
  });

  it('lê aal do JWT do GoTrue', () => {
    assert.equal(aalFromAccessToken(fakeJwt('aal2')), 'aal2');
    assert.equal(aalFromAccessToken(fakeJwt('aal1')), 'aal1');
    assert.equal(aalFromAccessToken('not-a-jwt'), 'aal1');
  });
});

describe('HTTP MFA TOTP', () => {
  const store = new MemoryVitrineStore();
  const auth = new MemoryAuthService();
  const server = createVitrineServer({
    store,
    mode: 'stub',
    auth,
    publicConfig: loadPublicConfig({}),
  });
  let base = '';

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('UI documenta o caminho TOTP em /app /entrar /cadastro', async () => {
    const app = await (await fetch(`${base}/app`)).text();
    assert.match(app, /2FA \(TOTP\)/);
    assert.match(app, /Supabase Auth MFA/);
    assert.doesNotMatch(app, /dashboard fiscal|Stripe|faturamento/i);
    const alias = await fetch(`${base}/conta`);
    assert.equal(alias.status, 200);
    const entrar = await (await fetch(`${base}/entrar`)).text();
    assert.match(entrar, /2FA \(TOTP\)/);
    const cadastro = await (await fetch(`${base}/cadastro`)).text();
    assert.match(cadastro, /2FA \(TOTP\)/);
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /\/api\/auth\/mfa\/enroll/);
  });

  it('enroll só depois do e-mail; verify sobe aal2; login seguinte exige código', async () => {
    const signup = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana MFA',
        email: 'ana.mfa@empresa.com.br',
        password: 'senha-segura',
        turnstile_token: 'stub',
      }),
    });
    assert.equal(signup.status, 200);
    const pendingCookie = cookieFrom(signup);

    const blocked = await fetch(`${base}/api/auth/mfa/enroll`, {
      method: 'POST',
      headers: { Cookie: pendingCookie },
    });
    assert.equal(blocked.status, 403);
    const blockedBody = (await blocked.json()) as { error: string };
    assert.equal(blockedBody.error, MFA_EMAIL_GATE);

    const confirm = await fetch(`${base}/api/auth/confirm-email`, {
      method: 'POST',
      headers: { Cookie: pendingCookie },
    });
    assert.equal(confirm.status, 200);
    const confirmedCookie = cookieFrom(confirm) || pendingCookie;

    const enroll = await fetch(`${base}/api/auth/mfa/enroll`, {
      method: 'POST',
      headers: { Cookie: confirmedCookie },
    });
    assert.equal(enroll.status, 200);
    const enrolled = (await enroll.json()) as {
      ok: boolean;
      stub: boolean;
      factor_id: string;
      secret: string;
      uri: string;
      qr_code: string | null;
    };
    assert.equal(enrolled.ok, true);
    assert.equal(enrolled.stub, true);
    assert.equal(enrolled.qr_code, null);
    assert.match(enrolled.uri, /^otpauth:\/\/totp\//);
    assert.ok(enrolled.secret);

    const verify = await fetch(`${base}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: confirmedCookie },
      body: JSON.stringify({ code: totpCode(enrolled.secret), factor_id: enrolled.factor_id }),
    });
    assert.equal(verify.status, 200);
    const verified = (await verify.json()) as {
      ok: boolean;
      aal: string;
      mfa_required: boolean;
      user: { mfa_enrolled: boolean };
    };
    assert.equal(verified.aal, 'aal2');
    assert.equal(verified.mfa_required, false);
    assert.equal(verified.user.mfa_enrolled, true);

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ana.mfa@empresa.com.br',
        password: 'senha-segura',
        turnstile_token: 'stub',
      }),
    });
    assert.equal(login.status, 200);
    const logged = (await login.json()) as { mfa_required: boolean; aal: string };
    assert.equal(logged.mfa_required, true);
    assert.equal(logged.aal, 'aal1');
    const loginCookie = cookieFrom(login);

    const session = await fetch(`${base}/api/auth/session`, { headers: { Cookie: loginCookie } });
    const sessionBody = (await session.json()) as { mfa_required: boolean; mfa_enrolled: boolean; aal: string };
    assert.equal(sessionBody.mfa_required, true);
    assert.equal(sessionBody.mfa_enrolled, true);
    assert.equal(sessionBody.aal, 'aal1');

    const wrong = await fetch(`${base}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({ code: '000000' }),
    });
    assert.equal(wrong.status, 401);

    const ok = await fetch(`${base}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({ code: totpCode(enrolled.secret) }),
    });
    assert.equal(ok.status, 200);
    const lifted = (await ok.json()) as { aal: string; mfa_required: boolean };
    assert.equal(lifted.aal, 'aal2');
    assert.equal(lifted.mfa_required, false);
  });

  it('rate limit no verify MFA', async () => {
    const limiter = new MemoryRateLimiter(() => 0);
    const authLocal = new MemoryAuthService();
    const locked = createVitrineServer({
      store: new MemoryVitrineStore(),
      mode: 'stub',
      auth: authLocal,
      rateLimiter: limiter,
    });
    await new Promise<void>((resolve) => locked.listen(0, '127.0.0.1', () => resolve()));
    const port = (locked.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const signup = await fetch(`${origin}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rate.mfa@empresa.com.br',
        password: 'senha-segura',
        turnstile_token: 'stub',
      }),
    });
    const cookie = cookieFrom(signup);
    await fetch(`${origin}/api/auth/confirm-email`, { method: 'POST', headers: { Cookie: cookie } });
    let last = 200;
    for (let i = 0; i < RATE_LIMIT_POLICY.mfa.email.max + 1; i += 1) {
      const res = await fetch(`${origin}/api/auth/mfa/enroll`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      last = res.status;
    }
    assert.equal(last, 429);
    await new Promise<void>((resolve, reject) => {
      locked.close((err) => (err ? reject(err) : resolve()));
    });
  });
});

describe('GoTrue MFA (fetch mock)', () => {
  it('enroll POSTa /auth/v1/factors e verify faz challenge+verify', async () => {
    const calls: string[] = [];
    const aal1 = fakeJwt('aal1');
    const aal2 = fakeJwt('aal2');
    const auth = new SupabaseAuthService('https://sync-plvria.supabase.co', 'anon-public', async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${url.replace('https://sync-plvria.supabase.co', '')}`);
      if (url.endsWith('/auth/v1/user')) {
        return new Response(
          JSON.stringify({
            id: 'user-1',
            email: 'ana@empresa.com.br',
            email_confirmed_at: '2026-09-18T00:00:00Z',
            factors: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/auth/v1/factors') && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'factor-1',
            totp: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x', qr_code: 'data:image/svg+xml,qr' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/challenge')) {
        return new Response(JSON.stringify({ id: 'chal-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/verify')) {
        return new Response(
          JSON.stringify({
            access_token: aal2,
            user: {
              id: 'user-1',
              email: 'ana@empresa.com.br',
              email_confirmed_at: '2026-09-18T00:00:00Z',
              factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const enrolled = await auth.enrollTotp(aal1);
    assert.equal(enrolled.ok, true);
    if (!enrolled.ok) return;
    assert.equal(enrolled.factor_id, 'factor-1');
    assert.equal(enrolled.qr_code, 'data:image/svg+xml,qr');
    assert.ok(calls.some((c) => c === 'POST /auth/v1/factors'));

    const verified = await auth.verifyTotp(aal1, { code: '123456', factor_id: 'factor-1' });
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.session.user.aal, 'aal2');
    assert.equal(verified.session.user.mfa_enrolled, true);
    assert.ok(calls.some((c) => c.endsWith('/challenge')));
    assert.ok(calls.some((c) => c.endsWith('/verify')));
  });
});
