/**
 * Worker de preview da Vitrine. Só `workers.dev` — sem DNS de
 * sync.plvria.com.br e sem publish de produção.
 *
 * GET de HTML/CSS/JS NÃO inicializa o runtime (Auth/store/node:crypto).
 * Assim um crash na API não devolve JSON 500 no lugar da landing — o que
 * no Safari iOS (dark mode) vira tela preta.
 */
import { PAGE_MAP } from '../src/vitrine/pages.js';
import { applyStagingSurface, isExplicitStaging } from '../src/vitrine/staging.js';
import { clientIp } from '../src/vitrine/rate-limit.js';
import { sessionClearCookieValue, sessionSetCookieValue } from '../src/vitrine/session.js';

export type PreviewEnv = {
  ASSETS: { fetch: (input: Request) => Promise<Response> };
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
  /** Só "1" | "true" | "staging" revela banner e hostname. Ausente = build produto. */
  VITRINE_STAGING?: string;
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

const LIGHT_HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};

/** Fallback se o binding ASSETS falhar — canvas claro, sem depender de CSS. */
const LIGHT_ERROR_HTML =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><style>html,body{background:#f3efe6;color:#1b1916;margin:0;padding:24px;font-family:sans-serif}</style><title>Plvria</title></head><body><p>Não foi possível carregar a página agora.</p></body></html>';

let runtime: unknown = null;

function bindingsToEnv(env: PreviewEnv): Record<string, string | undefined> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > maxBytes) {
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
  // O binding só olha o pathname. Host do próprio workers.dev vira fetch da zona (erro 1042).
  const assetUrl = new URL(request.url);
  assetUrl.protocol = 'https:';
  assetUrl.hostname = 'assets.local';
  assetUrl.port = '';
  if (mapped !== undefined) {
    assetUrl.pathname = `/${mapped}`;
    assetUrl.search = '';
  }
  const assetRequest = new Request(assetUrl.toString(), {
    method: 'GET',
    headers: request.headers,
    redirect: 'manual',
  });
  const response = await env.ASSETS.fetch(assetRequest);
  if (response.status === 404) {
    return new Response(
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><style>html,body{background:#f3efe6;color:#1b1916}</style><title>404</title></head><body><p>Não encontrado.</p></body></html>',
      { status: 404, headers: LIGHT_HTML_HEADERS },
    );
  }
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Content-Type-Options', 'nosniff');
  const type = headers.get('content-type') ?? '';
  if (request.method !== 'HEAD' && isExplicitStaging(env.VITRINE_STAGING) && type.includes('text/html')) {
    const html = applyStagingSurface(await response.text(), true);
    return new Response(html, { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    if ((method === 'GET' || method === 'HEAD') && !url.pathname.startsWith('/api/')) {
      try {
        return await serveAsset(request, env, url.pathname);
      } catch (error) {
        console.error('[vitrine] asset', error);
        return new Response(LIGHT_ERROR_HTML, { status: 500, headers: LIGHT_HTML_HEADERS });
      }
    }

    try {
      const api = await import('../src/vitrine/api.js');
      runtime ??= api.createVitrineRuntime({ env: bindingsToEnv(env) });
      const vitrine = runtime as ReturnType<typeof api.createVitrineRuntime>;
      const handled = await api.handleVitrineApi(
        {
          method,
          pathname: url.pathname,
          cookieHeader: request.headers.get('cookie'),
          ip: clientIp(request.headers, request.headers.get('cf-connecting-ip') ?? undefined),
          readJsonBody: () => readJsonBody(request, api.MAX_BODY_BYTES),
        },
        vitrine,
      );
      if (handled !== null) {
        return jsonResponse(handled.status, handled.body, {
          extraHeaders: handled.extraHeaders,
          sessionToken: handled.sessionToken,
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
      const { LEAD_ERROR_MESSAGE } = await import('../src/vitrine/api.js').catch(() => ({
        LEAD_ERROR_MESSAGE: 'Não deu pra salvar agora. Tenta de novo em instantes.',
      }));
      return jsonResponse(500, { ok: false, error: LEAD_ERROR_MESSAGE });
    }
  },
};
