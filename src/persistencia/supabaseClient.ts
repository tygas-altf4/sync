import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PersistenciaError } from '../errors.js';
import type { Database } from './database.js';

/**
 * Env do worker Nota Bot. `SUPABASE_SERVICE_ROLE_KEY` é o nome histórico;
 * o valor pode ser a JWT `service_role` legada **ou** a chave nova `sb_secret_…`.
 * `SUPABASE_SECRET_KEY` é o alias da documentação atual do Supabase.
 */
export type SupabaseEnv = {
  SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
  SUPABASE_SECRET_KEY?: string | undefined;
};

export type CreateSupabaseClientOptions = {
  env?: SupabaseEnv;
  /** Fetch injetável (testes). O wrapper de apikey envolve este fetch. */
  fetch?: typeof fetch;
};

function trimEnv(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function readSupabaseUrl(env: SupabaseEnv = process.env): string | undefined {
  return trimEnv(env.SUPABASE_URL);
}

/**
 * Prefere `SUPABASE_SERVICE_ROLE_KEY` (legado + sb_secret no mesmo slot)
 * e cai para `SUPABASE_SECRET_KEY` se o primeiro estiver vazio.
 */
export function readSupabaseSecretKey(
  env: SupabaseEnv = process.env,
): string | undefined {
  return (
    trimEnv(env.SUPABASE_SERVICE_ROLE_KEY) ?? trimEnv(env.SUPABASE_SECRET_KEY)
  );
}

/** Chaves novas (`sb_secret_` / `sb_publishable_`) não são JWT. */
export function isNewFormatApiKey(key: string): boolean {
  return key.startsWith('sb_secret_') || key.startsWith('sb_publishable_');
}

/**
 * supabase-js (REST/Storage/Realtime) ainda envia **dual-header**:
 * `apikey` + `Authorization: Bearer <key>` quando não há sessão.
 * Só o client de Edge Functions omite o Bearer para chaves `sb_*`.
 *
 * Chaves `sb_secret_…` no Bearer quebram o gateway ("invalid token format").
 * Este fetch garante: secret nova vai **somente** em `apikey`.
 * JWT `service_role` legada (`eyJ…`) mantém os dois headers — o PostgREST
 * precisa do claim `role` no Bearer.
 *
 * @see https://supabase.com/docs/guides/getting-started/api-keys
 */
export function fetchSecretAsApikeyOnly(
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has('apikey')) {
      headers.set('apikey', secretKey);
    }
    const authorization = headers.get('Authorization');
    if (
      isNewFormatApiKey(secretKey) &&
      authorization === `Bearer ${secretKey}`
    ) {
      headers.delete('Authorization');
    }
    return fetchImpl(input, { ...init, headers });
  };
}

export function requireSupabaseUrl(env: SupabaseEnv = process.env): string {
  const url = readSupabaseUrl(env);
  if (url === undefined) {
    throw new PersistenciaError(
      'SUPABASE_URL ausente — configure o env do worker Nota Bot',
    );
  }
  return url;
}

export function requireSupabaseSecretKey(env: SupabaseEnv = process.env): string {
  const key = readSupabaseSecretKey(env);
  if (key === undefined) {
    throw new PersistenciaError(
      'SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SECRET_KEY) ausente — só no servidor',
    );
  }
  return key;
}

/**
 * Cliente privilegiado do Nota Bot (service role / secret).
 * Nunca usar no browser, bundle ou `NEXT_PUBLIC_*`.
 */
export function createSupabaseClient(
  options: CreateSupabaseClientOptions = {},
): SupabaseClient<Database> {
  const env = options.env ?? process.env;
  const url = requireSupabaseUrl(env);
  const secretKey = requireSupabaseSecretKey(env);

  return createClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchSecretAsApikeyOnly(secretKey, options.fetch ?? fetch),
    },
  });
}

export type NotaBotSupabaseClient = SupabaseClient<Database>;
