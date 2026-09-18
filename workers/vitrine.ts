/**
 * Worker de preview da Vitrine. Só `workers.dev` — sem DNS de
 * sync.plvria.com.br e sem publish de produção. Mesmas rotas `/api` do
 * `npm run web`; sem SUPABASE_URL/service role o store e o Auth ficam stub.
 */
import { createVitrineRuntime, handleVitrineApi, LEAD_ERROR_MESSAGE, MAX_BODY_BYTES } from '../src/vitrine/api.js';
import { PAGE_MAP } from '../src/vitrine/pages.js';
import { clientIp } from '../src/vitrine/rate-limit.js';
import { sessionClearCookieValue, sessionSetCookieValue } from '../src/vitrine/session.js';

export type PreviewEnv = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SYNCNFE_AMBIENTE?: string;
  SYNCNFE_PUBLIC_HOST?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

const ENV_KEYS = [
  'SYNCNFE_AMBIENTE',
  'SYNCNFE_PUBLIC_HOST',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

let runtime: ReturnType<typeof createVitrineRuntime> | null = null;

function applyPreviewEnv(env: PreviewEnv): void {
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }
}

function getRuntime(env: PreviewEnv): ReturnType<typeof createVitrineRuntime> {
  applyPreviewEnv(env);
  runtime ??= createVitrineRuntime();
  return runtime;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new Error('body_too_large');
  }
  if (raw.trim() === '') {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

function jsonResponse(
  status: number,
  body: unknown,
  extra: { extraHeaders?: Record<string, string>; sessionToken?: string | null } = {},
): Response {
  const headers = new Headers({ ...JSON_HEADERS, ...extra.extraHeaders });
  if (extra.sessionToken === null) {
    headers.set('Set-Cookie', sessionClearCookieValue());
  } else if (extra.sessionToken !== undefined) {
    headers.set('Set-Cookie', sessionSetCookieValue(extra.sessionToken));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function serveAsset(request: Request, env: PreviewEnv, pathname: string): Promise<Response> {
  const mapped = PAGE_MAP[pathname];
  const assetUrl = new URL(request.url);
  if (mapped !== undefined) {
    assetUrl.pathname = `/${mapped}`;
  }
  const assetRequest = new Request(assetUrl.toString(), request);
  const response = await env.ASSETS.fetch(assetRequest);
  if (response.status === 404) {
    return new Response('<!doctype html><title>404</title><p>Não encontrado.</p>', {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const vitrine = getRuntime(env);

    try {
      const api = await handleVitrineApi(
        {
          method,
          pathname: url.pathname,
          cookieHeader: request.headers.get('cookie'),
          ip: clientIp(request.headers, request.headers.get('cf-connecting-ip') ?? undefined),
          readJsonBody: () => readJsonBody(request),
        },
        vitrine,
      );
      if (api !== null) {
        return jsonResponse(api.status, api.body, {
          extraHeaders: api.extraHeaders,
          sessionToken: api.sessionToken,
        });
      }

      if (method === 'GET' || method === 'HEAD') {
        return serveAsset(request, env, url.pathname);
      }

      return jsonResponse(405, { ok: false, error: 'Método não permitido.' });
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === 'body_too_large')) {
        return jsonResponse(400, { ok: false, error: 'Pedido inválido.' });
      }
      console.error('[vitrine] worker', error);
      return jsonResponse(500, { ok: false, error: LEAD_ERROR_MESSAGE });
    }
  },
};
