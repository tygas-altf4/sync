import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config/ambientes.ts';
import { PersistenciaError } from '../src/errors.ts';
import {
  insertNfseDoc,
  readQuotaUsage,
  upsertEstablishment,
} from '../src/persistencia/helpers.ts';
import {
  createSupabaseClient,
  fetchSecretAsApikeyOnly,
  isNewFormatApiKey,
  readSupabaseSecretKey,
  readSupabaseUrl,
  requireSupabaseSecretKey,
  requireSupabaseUrl,
} from '../src/persistencia/supabaseClient.ts';

const ACCOUNT = '11111111-1111-1111-1111-111111111111';
const ESTABLISHMENT = '22222222-2222-2222-2222-222222222222';
const PERIOD = '2026-09';
const URL = 'https://sync-plvria.supabase.co';
const SECRET = 'sb_secret_testkey_not_a_jwt';
const LEGACY_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig';

type Captured = { url: string; method: string; headers: Headers; body: string | null };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function capturingFetch(onRequest: (req: Captured) => Response): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : init?.body
            ? String(init.body)
            : null;
    return onRequest({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body,
    });
  };
}

describe('isNewFormatApiKey', () => {
  it('reconhece sb_secret_ e sb_publishable_', () => {
    assert.equal(isNewFormatApiKey('sb_secret_abc'), true);
    assert.equal(isNewFormatApiKey('sb_publishable_abc'), true);
    assert.equal(isNewFormatApiKey(LEGACY_JWT), false);
  });
});

describe('env Supabase', () => {
  it('lê URL e prefere SERVICE_ROLE_KEY sobre SECRET_KEY', () => {
    const env = {
      SUPABASE_URL: ` ${URL} `,
      SUPABASE_SERVICE_ROLE_KEY: ` ${SECRET} `,
      SUPABASE_SECRET_KEY: 'sb_secret_ignored',
    };
    assert.equal(readSupabaseUrl(env), URL);
    assert.equal(readSupabaseSecretKey(env), SECRET);
  });

  it('cai para SUPABASE_SECRET_KEY quando SERVICE_ROLE_KEY está vazio', () => {
    const env = {
      SUPABASE_URL: URL,
      SUPABASE_SERVICE_ROLE_KEY: '  ',
      SUPABASE_SECRET_KEY: SECRET,
    };
    assert.equal(readSupabaseSecretKey(env), SECRET);
  });

  it('exige URL e secret no factory', () => {
    assert.throws(() => requireSupabaseUrl({}), PersistenciaError);
    assert.throws(() => requireSupabaseSecretKey({ SUPABASE_URL: URL }), PersistenciaError);
    assert.throws(() => createSupabaseClient({ env: {} }), PersistenciaError);
  });

  it('loadConfig resolve o alias SUPABASE_SECRET_KEY', () => {
    const cfg = loadConfig({
      SUPABASE_URL: URL,
      SUPABASE_SECRET_KEY: SECRET,
    });
    assert.equal(cfg.supabaseUrl, URL);
    assert.equal(cfg.supabaseServiceRoleKey, SECRET);
  });
});

describe('fetchSecretAsApikeyOnly', () => {
  it('remove Authorization Bearer quando a secret é sb_secret_', async () => {
    let captured: Headers | undefined;
    const wrapped = fetchSecretAsApikeyOnly(
      SECRET,
      capturingFetch((req) => {
        captured = req.headers;
        return jsonResponse({});
      }),
    );

    await wrapped('https://example.test/rest/v1/quota_usage', {
      headers: {
        apikey: SECRET,
        Authorization: `Bearer ${SECRET}`,
      },
    });

    assert.equal(captured?.get('apikey'), SECRET);
    assert.equal(captured?.get('Authorization'), null);
  });

  it('mantém Bearer na JWT service_role legada', async () => {
    let captured: Headers | undefined;
    const wrapped = fetchSecretAsApikeyOnly(
      LEGACY_JWT,
      capturingFetch((req) => {
        captured = req.headers;
        return jsonResponse({});
      }),
    );

    await wrapped('https://example.test/rest/v1/quota_usage', {
      headers: {
        apikey: LEGACY_JWT,
        Authorization: `Bearer ${LEGACY_JWT}`,
      },
    });

    assert.equal(captured?.get('apikey'), LEGACY_JWT);
    assert.equal(captured?.get('Authorization'), `Bearer ${LEGACY_JWT}`);
  });
});

describe('helpers persistência (fetch mock, sem rede)', () => {
  const quotaRow = {
    id: '33333333-3333-3333-3333-333333333333',
    account_id: ACCOUNT,
    period_yyyymm: PERIOD,
    notes_used: 3,
    notes_quota: 50,
    updated_at: '2026-09-18T00:00:00.000Z',
  };

  const establishmentRow = {
    id: ESTABLISHMENT,
    account_id: ACCOUNT,
    cnpj: '12345678000199',
    inscricao_municipal: null,
    codigo_municipio_ibge: '3550308',
    channel: 'nacional' as const,
    channel_provider: null,
    certificate_vault_ref: 'certificates/acct/a1.pfx',
    certificate_expires_at: null,
    active: true,
  };

  const nfseRow = {
    id: '44444444-4444-4444-4444-444444444444',
    account_id: ACCOUNT,
    establishment_id: ESTABLISHMENT,
    environment: 'restrita' as const,
    channel: 'nacional' as const,
    dps_id: null,
    chave_acesso: null,
    status: 'pendente' as const,
    rejection_code: null,
    rejection_msg: null,
    xml_storage_path: 'nfse-xml/acct/doc.xml',
    emitted_at: null,
    created_at: '2026-09-18T00:00:00.000Z',
  };

  it('readQuotaUsage envia apikey e não Bearer sb_secret_', async () => {
    const calls: Captured[] = [];
    const client = createSupabaseClient({
      env: { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET },
      fetch: capturingFetch((req) => {
        calls.push(req);
        return jsonResponse(quotaRow);
      }),
    });

    const row = await readQuotaUsage(client, ACCOUNT, PERIOD);
    assert.equal(row?.notes_used, 3);
    assert.equal(row?.notes_quota, 50);

    const rest = calls.find((c) => c.url.includes('/rest/v1/quota_usage'));
    assert.ok(rest, 'esperava chamada REST em quota_usage');
    assert.equal(rest.headers.get('apikey'), SECRET);
    assert.equal(rest.headers.get('Authorization'), null);
    assert.match(rest.url, /account_id=eq\./);
    assert.match(rest.url, /period_yyyymm=eq\./);
  });

  it('insertNfseDoc POSTa o row tipado', async () => {
    const calls: Captured[] = [];
    const client = createSupabaseClient({
      env: { SUPABASE_URL: URL, SUPABASE_SECRET_KEY: SECRET },
      fetch: capturingFetch((req) => {
        calls.push(req);
        return jsonResponse(nfseRow);
      }),
    });

    const inserted = await insertNfseDoc(client, {
      account_id: ACCOUNT,
      establishment_id: ESTABLISHMENT,
      environment: 'restrita',
      channel: 'nacional',
      xml_storage_path: 'nfse-xml/acct/doc.xml',
    });
    assert.equal(inserted.status, 'pendente');

    const rest = calls.find((c) => c.url.includes('/rest/v1/nfse_docs'));
    assert.ok(rest);
    assert.equal(rest.method, 'POST');
    assert.equal(rest.headers.get('apikey'), SECRET);
    assert.equal(rest.headers.get('Authorization'), null);
    assert.ok(rest.body);
    const payload = JSON.parse(rest.body) as { account_id: string };
    assert.equal(payload.account_id, ACCOUNT);
  });

  it('upsertEstablishment recusa PFX/PEM em certificate_vault_ref', async () => {
    const client = createSupabaseClient({
      env: { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET },
      fetch: capturingFetch(() => jsonResponse({})),
    });

    await assert.rejects(
      () =>
        upsertEstablishment(client, {
          account_id: ACCOUNT,
          cnpj: '12345678000199',
          certificate_vault_ref: '-----BEGIN CERTIFICATE-----\nMII',
        }),
      PersistenciaError,
    );
  });

  it('upsertEstablishment usa onConflict account_id,cnpj', async () => {
    const calls: Captured[] = [];
    const client = createSupabaseClient({
      env: { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET },
      fetch: capturingFetch((req) => {
        calls.push(req);
        return jsonResponse(establishmentRow);
      }),
    });

    const row = await upsertEstablishment(client, {
      account_id: ACCOUNT,
      cnpj: '12345678000199',
      channel: 'nacional',
      certificate_vault_ref: 'certificates/acct/a1.pfx',
    });
    assert.equal(row.cnpj, '12345678000199');

    const rest = calls.find((c) => c.url.includes('/rest/v1/establishments'));
    assert.ok(rest);
    assert.equal(rest.method, 'POST');
    assert.match(
      rest.headers.get('Prefer') ?? '',
      /resolution=merge-duplicates/,
    );
  });
});
