import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureLead, LEAD_ERROR_MESSAGE } from './leads.js';
import { writeUpgradeHandoff } from './handoff.js';
import { provisionFreeAccount } from './signup.js';
import { createVitrineStore, type VitrineStore } from './store.js';

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
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
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
  const pageMap: Record<string, string> = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/privacidade': 'privacidade.html',
    '/privacidade.html': 'privacidade.html',
    '/termos': 'termos.html',
    '/termos.html': 'termos.html',
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
  const resolved =
    options.store !== undefined
      ? { store: options.store, mode: options.mode ?? 'stub' }
      : createVitrineStore();

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, webRoot, resolved.store, resolved.mode);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  webRoot: string,
  store: VitrineStore,
  mode: 'supabase' | 'stub',
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  try {
    if (method === 'POST' && pathname === '/api/leads') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const result = await captureLead(body, { store, mode });
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
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/signup') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const result = await provisionFreeAccount(body, { store, mode });
      if (!result.ok) {
        json(res, 400, { ok: false, error: result.error });
        return;
      }
      json(res, 200, {
        ok: true,
        stub: result.stub,
        lead_id: result.lead.id,
        account_id: result.account.id,
        stage: result.lead.stage,
        plan_code: result.account.plan_code,
        notes_used: result.quota.notes_used,
        notes_quota: result.quota.notes_quota,
        period_yyyymm: result.quota.period_yyyymm,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/upgrade-handoff') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const result = await writeUpgradeHandoff(body, { store, mode });
      json(res, 200, {
        ok: true,
        stub: result.stub,
        event_id: result.event.id,
        type: result.event.type,
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
