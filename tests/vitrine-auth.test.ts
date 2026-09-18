import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryAuthService } from '../src/vitrine/auth.ts';
import { createTurnstileVerifier } from '../src/vitrine/captcha.ts';
import { createVitrineServer } from '../src/vitrine/http.ts';
import { assertNoSecrets, loadPublicConfig } from '../src/vitrine/public-config.ts';
import { MemoryRateLimiter, RATE_LIMIT_POLICY } from '../src/vitrine/rate-limit.ts';
import { provisionFreeAccount } from '../src/vitrine/signup.ts';
import { createVitrineStore, MemoryVitrineStore } from '../src/vitrine/store.ts';
import { insertLead } from '../src/persistencia/helpers.ts';
import { createSupabaseClient } from '../src/persistencia/supabaseClient.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function cookieFrom(response: Response): string {
  const first = response.headers.getSetCookie()[0] ?? '';
  return first.split(';')[0] ?? '';
}

describe('public config', () => {
  it('não expõe service role nem secret do Turnstile', () => {
    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-public',
      SUPABASE_SERVICE_ROLE_KEY: 'super-secret-service-role',
      TURNSTILE_SITE_KEY: 'site-public',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
    } as NodeJS.ProcessEnv;
    const config = loadPublicConfig(env);
    assert.equal(config.supabaseAnonKey, 'anon-public');
    assert.equal(config.turnstileSiteKey, 'site-public');
    assert.equal(config.turnstileMode, 'live');
    assert.equal(config.authMode, 'supabase');
    assert.equal('supabaseServiceRoleKey' in config, false);
    assertNoSecrets(config, env);
  });
});

describe('Turnstile', () => {
  it('stuba quando falta TURNSTILE_SECRET_KEY', async () => {
    const verify = createTurnstileVerifier({ secretKey: null });
    const result = await verify('');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.stub, true);
  });

  it('em live rejeita token vazio e aceita siteverify ok', async () => {
    const live = createTurnstileVerifier({ secretKey: 'secret' });
    const missing = await live('');
    assert.equal(missing.ok, false);

    const verify = createTurnstileVerifier({
      secretKey: 'secret',
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const ok = await verify('token-ok');
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.stub, false);
  });
});

describe('e-mail verification gate', () => {
  it('não provisiona conta free sem e-mail confirmado', async () => {
    const store = new MemoryVitrineStore();
    const lead = await store.insertLead({
      nome: 'Ana Souza',
      email: 'ana@empresa.com.br',
      cnpj: null,
      cnpj_pendente: true,
      volume_mensal: 'ate_50',
      perfil: 'empresa',
      lgpd_at: new Date().toISOString(),
      origem: 'hotsite',
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      stage: 'novo',
      account_id: null,
    });

    const blocked = await provisionFreeAccount(
      { lead_id: lead.id },
      {
        store,
        mode: 'stub',
        user: {
          id: 'u1',
          email: lead.email,
          nome: lead.nome,
          lead_id: lead.id,
          email_confirmed: false,
        },
      },
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /Confirme o e-mail/);
  });
});

describe('HTTP auth + captcha', () => {
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

  it('GET /api/public-config e /entrar existem; payload sem service role', async () => {
    const res = await fetch(`${base}/api/public-config`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(res.status, 200);
    assert.equal(Object.hasOwn(body, 'supabaseAnonKey'), true);
    assert.equal(Object.hasOwn(body, 'supabaseServiceRoleKey'), false);
    assert.match(JSON.stringify(body), /turnstileMode/);
    assert.doesNotMatch(JSON.stringify(body), /service_role/i);

    const page = await fetch(`${base}/entrar`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Criar conta/);
  });

  it('signup → e-mail pendente bloqueia /api/signup; confirm libera owner_user_id', async () => {
    const leadRes = await fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana Souza',
        email: 'ana@empresa.com.br',
        cnpj_pendente: true,
        volume_mensal: 'ate_50',
        perfil: 'empresa',
        lgpd: true,
        turnstile_token: 'stub',
      }),
    });
    const leadBody = (await leadRes.json()) as { lead_id: string };
    assert.equal(leadRes.status, 200);

    const signupRes = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana Souza',
        email: 'ana@empresa.com.br',
        password: 'senha-segura',
        lead_id: leadBody.lead_id,
        turnstile_token: 'stub',
      }),
    });
    const signupBody = (await signupRes.json()) as {
      ok: boolean;
      email_confirmed: boolean;
    };
    assert.equal(signupRes.status, 200);
    assert.equal(signupBody.email_confirmed, false);
    const cookie = cookieFrom(signupRes);
    assert.match(cookie, /sync_session=/);

    const blocked = await fetch(`${base}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ lead_id: leadBody.lead_id }),
    });
    assert.equal(blocked.status, 403);

    const confirm = await fetch(`${base}/api/auth/confirm-email`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const confirmBody = (await confirm.json()) as { ok: boolean; user: { email_confirmed: boolean } };
    assert.equal(confirm.status, 200);
    assert.equal(confirmBody.user.email_confirmed, true);
    const confirmedCookie = cookieFrom(confirm) || cookie;

    const provisioned = await fetch(`${base}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: confirmedCookie },
      body: JSON.stringify({ lead_id: leadBody.lead_id }),
    });
    const provisionedBody = (await provisioned.json()) as {
      ok: boolean;
      stage: string;
      owner_user_id: string;
    };
    assert.equal(provisioned.status, 200);
    assert.equal(provisionedBody.stage, 'teste');
    assert.ok(provisionedBody.owner_user_id);
  });

  it('live captcha recusa lead sem token', async () => {
    const locked = createVitrineServer({
      store: new MemoryVitrineStore(),
      mode: 'stub',
      captcha: createTurnstileVerifier({ secretKey: 'test-secret' }),
    });
    await new Promise<void>((resolve) => locked.listen(0, '127.0.0.1', () => resolve()));
    const port = (locked.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana Souza',
        email: 'ana@empresa.com.br',
        cnpj_pendente: true,
        volume_mensal: 'ate_50',
        perfil: 'empresa',
        lgpd: true,
      }),
    });
    assert.equal(res.status, 400);
    await new Promise<void>((resolve, reject) => {
      locked.close((err) => (err ? reject(err) : resolve()));
    });
  });
});

describe('rate limit', () => {
  it('enforcement em memória por IP mesmo sem Upstash', async () => {
    const limiter = new MemoryRateLimiter();
    const ip = '203.0.113.9';
    const max = RATE_LIMIT_POLICY.leads.ip.max;
    for (let i = 0; i < max; i += 1) {
      const ok = await limiter.consume({ route: 'leads', ip, email: `n${i}@x.com` });
      assert.equal(ok.allowed, true);
      assert.equal(ok.stub, true);
      assert.equal(ok.mode, 'memory');
    }
    const blocked = await limiter.consume({ route: 'leads', ip, email: 'last@x.com' });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.limitedBy, 'ip');
  });

  it('HTTP 429 no form quando o limiter recusa', async () => {
    const limiter = new MemoryRateLimiter(() => 0);
    const server = createVitrineServer({
      store: new MemoryVitrineStore(),
      mode: 'stub',
      rateLimiter: limiter,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const payload = {
      nome: 'Ana Souza',
      email: 'ana@empresa.com.br',
      cnpj_pendente: true,
      volume_mensal: 'ate_50',
      perfil: 'empresa',
      lgpd: true,
    };
    let last = 200;
    for (let i = 0; i < RATE_LIMIT_POLICY.leads.email.max + 1; i += 1) {
      const res = await fetch(`http://127.0.0.1:${port}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      last = res.status;
    }
    assert.equal(last, 429);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});

describe('form→leads via helpers #5', () => {
  it('insertLead usa createSupabaseClient e POSTa /rest/v1/leads com apikey', async () => {
    const SECRET = 'sb_secret_testkey_not_a_jwt';
    const URL = 'https://sync-plvria.supabase.co';
    const calls: { url: string; method: string; apikey: string | null; auth: string | null }[] = [];
    const row = {
      id: 'lead-db',
      created_at: '2026-09-18T00:00:00.000Z',
      nome: 'Ana Souza',
      email: 'ana@empresa.com.br',
      cnpj: null,
      cnpj_pendente: true,
      volume_mensal: 'ate_50',
      perfil: 'empresa',
      lgpd_at: '2026-09-18T00:00:00.000Z',
      origem: 'hotsite',
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      stage: 'novo',
      account_id: null,
      notes: null,
    };
    const client = createSupabaseClient({
      env: { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          method: (init?.method ?? 'GET').toUpperCase(),
          apikey: headers.get('apikey'),
          auth: headers.get('Authorization'),
        });
        return new Response(JSON.stringify(row), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const saved = await insertLead(client, {
      nome: 'Ana Souza',
      email: 'ana@empresa.com.br',
      cnpj_pendente: true,
      volume_mensal: 'ate_50',
      perfil: 'empresa',
      lgpd_at: row.lgpd_at,
      origem: 'hotsite',
    });
    assert.equal(saved.id, 'lead-db');
    const rest = calls.find((c) => c.url.includes('/rest/v1/leads'));
    assert.ok(rest);
    assert.equal(rest.method, 'POST');
    assert.equal(rest.apikey, SECRET);
    assert.equal(rest.auth, null);
    const wired = createVitrineStore({
      SUPABASE_URL: URL,
      SUPABASE_SERVICE_ROLE_KEY: SECRET,
    } as NodeJS.ProcessEnv);
    assert.equal(wired.mode, 'supabase');
  });
});

describe('docs RLS', () => {
  it('documenta que anon não select leads', () => {
    const doc = readFileSync(path.join(ROOT, 'docs/rls-leads.md'), 'utf8');
    assert.match(doc, /anon/i);
    assert.match(doc, /não/);
    assert.match(doc, /service_role/);
    assert.match(doc, /Turnstile|captcha/i);
  });
});
