import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../workers/vitrine.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'web/assets/landing.css'), 'utf8');

function previewEnv(options: { failAssets?: boolean } = {}) {
  return {
    ASSETS: {
      fetch: async (request: Request) => {
        if (options.failAssets) {
          throw new Error('assets_down');
        }
        const url = new URL(request.url);
        if (url.pathname.endsWith('landing.css')) {
          return new Response(CSS, {
            status: 200,
            headers: { 'Content-Type': 'text/css; charset=utf-8' },
          });
        }
        return new Response(INDEX, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    },
    SUPABASE_ANON_KEY: 'preview-anon-placeholder',
  };
}

describe('worker preview (boot)', () => {
  it('GET / devolve HTML 200 com o H1, sem passar pelo runtime da API', async () => {
    const res = await worker.fetch(new Request('https://preview.example/'), previewEnv());
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    assert.match(html, /Emita NFS-e Nacional sem travar no meio do caminho/);
    assert.match(html, /color-scheme" content="light only"/);
  });

  it('GET /assets/landing.css devolve o canvas claro', async () => {
    const res = await worker.fetch(
      new Request('https://preview.example/assets/landing.css'),
      previewEnv(),
    );
    assert.equal(res.status, 200);
    const css = await res.text();
    assert.match(css, /background-color:\s*#f3efe6/);
    assert.match(css, /color-scheme:\s*light only/);
  });

  it('GET / continua HTML claro se o binding ASSETS cair', async () => {
    const res = await worker.fetch(
      new Request('https://preview.example/'),
      previewEnv({ failAssets: true }),
    );
    assert.equal(res.status, 500);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    assert.match(html, /background:#f3efe6/);
    assert.match(html, /color:#1b1916/);
    assert.doesNotMatch(html, /"ok":false/);
  });

  it('GET /api/public-config stubba Auth sem SUPABASE_URL', async () => {
    const res = await worker.fetch(
      new Request('https://preview.example/api/public-config'),
      previewEnv(),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { authMode: string; turnstileMode: string };
    assert.equal(body.authMode, 'stub');
    assert.equal(body.turnstileMode, 'stub');
  });
});
