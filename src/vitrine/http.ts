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
import {
  createVitrineRuntime,
  handleVitrineApi,
  LEAD_ERROR_MESSAGE,
  MAX_BODY_BYTES,
  type VitrineHttpOptions,
  type VitrineRuntime,
} from './api.js';
import { PAGE_MAP } from './pages.js';
import { clientIp } from './rate-limit.js';
import { applyStagingSurface, isExplicitStaging } from './staging.js';
import { sessionClearCookieValue, sessionSetCookieValue } from './session.js';

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

export type { VitrineHttpOptions };

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
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
  const mapped = PAGE_MAP[urlPath] ?? urlPath;
  const filePath = safeJoin(webRoot, mapped);
  if (filePath === null) {
    sendText(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const type = MIME[ext] ?? 'application/octet-stream';
    if (ext === '.html' && isExplicitStaging(process.env['VITRINE_STAGING'])) {
      sendText(res, 200, type, applyStagingSurface(data.toString('utf8'), true));
      return;
    }
    sendText(res, 200, type, data);
  } catch {
    sendText(res, 404, 'text/html; charset=utf-8', '<!doctype html><title>404</title><p>Não encontrado.</p>');
  }
}

export function createVitrineServer(options: VitrineHttpOptions & { webRoot?: string } = {}): Server {
  const webRoot = options.webRoot ?? WEB_ROOT;
  const runtime = createVitrineRuntime(options);

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, webRoot, runtime);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  webRoot: string,
  runtime: VitrineRuntime,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  const cookieHeader = req.headers.cookie;
  const cookie = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;

  try {
    const api = await handleVitrineApi(
      {
        method,
        pathname,
        cookieHeader: cookie,
        ip: clientIp(req.headers, req.socket.remoteAddress),
        readJsonBody: () => readJsonBody(req),
      },
      runtime,
    );
    if (api !== null) {
      if (api.sessionToken === null) {
        res.setHeader('Set-Cookie', sessionClearCookieValue());
      } else if (api.sessionToken !== undefined) {
        res.setHeader('Set-Cookie', sessionSetCookieValue(api.sessionToken));
      }
      json(res, api.status, api.body, api.extraHeaders ?? {});
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
