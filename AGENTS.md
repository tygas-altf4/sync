# AGENTS.md — SyncNFe / Plvria Sync

Lei do repo: [`docs/ADR-001-arquitetura-nfse.md`](docs/ADR-001-arquitetura-nfse.md). Conflito → o ADR vence. Regras Cursor: [`.cursor/rules/`](.cursor/rules/).

## Produto

- **SyncNFe** (marca) / **Plvria Sync** (produto). Host: `sync.plvria.com.br`.
- Público: **empresa e contador**. **NUNCA escolas.** Apex `plvria.com.br` = gestão escolar — sem produto, DNS, copy nem deploy compartilhado.
- Este repo = núcleo **Nota** (NFS-e Nacional / SEFIN). Scaffold TS; emissão real ainda não (mTLS/A1 pendente).

## Stack

- Node.js 20+ / TypeScript. Sem PHP no cliente SEFIN.
- SEFIN via wrapper **open-nfse** (MIT): sign, mTLS, gzip, paths. Ownership Sync: cota, persistência, retry. Não reinventar XMLDSig. Sem AGPL.
- Persistência: **um** schema Supabase. Sem API, REST, GraphQL, fila ou segundo banco para o mesmo estado fiscal.

Tabelas do núcleo: `establishments`, `quota_usage`, `nfse_docs`, `accounts` (leitura). Storage: `nfse-xml`, `certificates` (service-role).

## Ownership

| Superfície | Dono | Neste repo? |
|---|---|---|
| SEFIN, quota, `establishments`, `nfse_docs`, vault A1 | **Nota** | sim |
| Landing, leads, CRM, auth UI, captcha, MFA UX | **Vitrine** | draft em `web/` + `src/vitrine/` (dono Vitrine; Nota não emite daqui) |
| Billing, Stripe/Asaas, `subscriptions`, `price_brl` | **Dinheiro** | não — Sync só lê `plan_code` / snapshot de cota |

Publicar 1ª fatia **sem Dinheiro** é ok. Sem Vitrine (auth / e-mail / captcha / MFA / form) ou sem rate limit **não**.

O draft do hotsite neste repo **não** cria schema paralelo: só `leads` / `accounts` / `quota_usage` / `crm_events` de `supabase/migrations/001_schema_minimo.sql` e GoTrue (Auth/MFA). Stub em memória replica a mesma interface quando falta env — não é identidade paralela. Rate limit em `src/vitrine/rate-limit.ts` é o stand-in do throttle de edge (ADR §4) até Cloudflare. Sem `nfse_docs`, cert, `subscriptions` ou UI de billing na Vitrine.

## Segurança (day-1)

- Auth = Supabase Auth (Vitrine). Sem auth paralela neste repo. Sem env, `MemoryAuthService` **stuba GoTrue** (mesma interface, sem tabela `users` nossa).
- E-mail **verificado** antes de emitir, cert, cota ou worker.
- **MFA / 2FA** (Supabase Auth MFA): recomendado day-1; **obrigatório antes de publicar** para titulares que emitem NFS-e. UX = Vitrine. Nota assume sessão/conta autenticada + verificada (e-mail + MFA). MFA **não** é trabalho do SEFIN.
- Captcha (Turnstile ou hCaptcha) no signup e form público — Vitrine implementa; recusar fluxo sem captcha.
- RLS em `accounts`, `establishments`, `quota_usage`, `nfse_docs`, `subscriptions` + buckets. Browser = JWT do usuário + anon/publishable key.
- Service role **só servidor** (Nota worker). Nunca browser, `.env` de front, bundle ou `NEXT_PUBLIC_*`.
- Cert A1 só `establishments.certificate_vault_ref` + Storage `certificates`. Nunca PFX/PEM em coluna, log ou JS.
- Zero secrets no frontend.

## Rate limits (day-1 — obrigatório antes de publicar)

Cota mensal (`quota_usage`) ≠ rate limit. Cota = teto de notas. Rate limit = abuso.

| Superfície | Onde | Regra |
|---|---|---|
| Signup / form público | Vitrine, **edge** | Throttle no edge (Cloudflare / Edge Function) |
| Auth login | Vitrine → Supabase Auth | Rate limit de login |
| `POST` emissão | Nota / Sync | Rate limit **por `account_id`**, além do gate de cota |

## Estilo

- Comentários e docs (**o quê / por quê**) em **português**. Nomes de símbolos em inglês ok (`Quota.assert`, `NfseClient`).
- Sem comentário óbvio. Sem narrar o código.
- Colunas/tabelas: nomes do contrato (`plan_code`, `notes_used`, `certificate_vault_ref`).

## Anti-goals

- API / contrato de dados paralelo ao schema Supabase (Vitrine não inventa coluna; `crm_events.event_type`, sem `leads.upgrade_handoff_at`).
- Inventar protocolo SEFIN / XSD / XMLDSig; dependência AGPL.
- Produto, copy, DNS ou deploy escolar.
- Publicar sem auth + e-mail verify + MFA (emissores) + captcha + RLS + vault + rate limits.
- Publicar sem Dinheiro (billing) **é permitido**.

## Skills futuras

Listadas em [`.cursor/skills/README.md`](.cursor/skills/README.md) (`emit-nfse-spike`, `supabase-migrate`). Não implementar até pedido.
