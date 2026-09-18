# SyncNFe.NFSeNacional (Plvria Sync)

Núcleo TypeScript da **NFS-e Nacional** (SEFIN) da Plvria.

| | |
|---|---|
| Produto | SyncNFe / Plvria Sync |
| Host canônico | `sync.plvria.com.br` |
| Apex | `plvria.com.br` é **gestão escolar** — não misturar produto, DNS nem deploy |
| Stack | Node.js 20+ / TypeScript |
| Persistência | Supabase projeto **sync plvria** (`establishments`, `nfse_docs`, `quota_usage` + Storage) |

Este repositório é o **scaffold** do cliente SEFIN. **Não emite NFS-e real ainda** (sem mTLS / A1 neste PR).

## Arquitetura

Decisões não negociáveis (schema, SEFIN, cota, A1, wire, fronteira de auth, MFA, rate limit): [ADR-001 — Arquitetura NFS-e](docs/ADR-001-arquitetura-nfse.md).

Agentes Cursor: [AGENTS.md](AGENTS.md).

---

## Hotsite + CRM (Vitrine) — DRAFT

Landing de captura em `web/` + API em `src/vitrine/`. **Não é publicação em produção.**

| | |
|---|---|
| Host canônico / CTAs / og:url | `https://sync.plvria.com.br` |
| Público | empresa (ME/Simples/serviço) e contador — **não escolas**, sem cross-sell escolar |
| CTA primário | Começar grátis |
| Planos pagos | Falar com upgrade (handoff; **sem cobrança** nesta UI) |
| Form → | captcha → `leads` (`origem=hotsite`, `stage=novo`, `lgpd_at`) |
| Auth → | `/entrar` signup/login (Supabase Auth ou stub). Cookie httpOnly |
| Onboarding → | só com e-mail **confirmado** → `accounts` free50 + `quota_usage` + lead `teste` |
| Upgrade stub → | `crm_events` `upgrade_handoff` (payload do mapa Vitrine↔Supabase) |

```bash
npm run web
# http://127.0.0.1:3000
```

**Env (não commitar segredos):**

| Var | Onde | Uso |
|---|---|---|
| `SUPABASE_URL` | server + público via `/api/public-config` | projeto |
| `SUPABASE_ANON_KEY` | server + público via `/api/public-config` | Auth (nunca select `leads`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor** | `createSupabaseClient` — leads/accounts/crm depois do captcha |
| `SUPABASE_SECRET_KEY` | **só servidor** | alias da service role / `sb_secret_` |
| `TURNSTILE_SITE_KEY` | público | widget Cloudflare Turnstile |
| `TURNSTILE_SECRET_KEY` | **só servidor** | siteverify; se faltar, captcha **stuba** |
| `PORT` | server | padrão 3000 |

Sem URL/service role, as rotas **stubam**. Sem chaves Turnstile, o captcha é checkbox de rascunho. Auth sem anon key usa usuários em memória (e-mail começa **não** confirmado).

`GET /api/public-config` devolve só URL + anon + site key. Service role e secret do Turnstile **não** saem do processo Node.

RLS esperado: `docs/rls-leads.md` — anon não select/insert `leads`.

Não inventar API fiscal paralela — SEFIN/DPS continua no núcleo (`src/sefin`, Nota Bot).

**Publicar** o hotsite **somente** depois do ok do **Dinheiro Bot** e do **Thiago**. DNS/Cloudflare de `sync` fica fora deste PR.

---

## Como rodar

```bash
npm install
npm test
npm run build
npm run lint
npm run web
```

Copie `.env.example` para `.env` se for experimentar config local. Não commite `.env`, `*.pfx` nem `*.p12`.

```bash
cp .env.example .env
```

`SYNCNFE_AMBIENTE` aceita `ProducaoRestrita` (padrão) ou `Producao`.

---

## Ambientes SEFIN

| Ambiente | Uso | Base runtime | Swagger (portal) |
|---|---|---|---|
| **ProducaoRestrita** | Homologação oficial — **começar aqui** | `https://sefin.producaorestrita.nfse.gov.br/SefinNacional` | `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index` |
| **Producao** | Documento fiscal real — **gate explícito** | `https://sefin.nfse.gov.br/SefinNacional` | `https://sefin.nfse.gov.br/SefinNacional/docs/index` |

- Troca `ProducaoRestrita` → `Producao` só depois do ciclo restrita verde. Cada `201` em produção é NFS-e de verdade.
- O portal lista `/API/` no path do **docs** em restrita; o mirror OpenAPI e o open-nfse usam base **sem** `/API`. Confirmar no swagger oficial **com certificado A1**.
- Auth SEFIN: **mTLS** A1 ICP-Brasil (sem API key). Envelope JSON + XML DPS/evento XMLDSig + GZip+base64. HTTP/1.1 (SEFIN rejeita H2).
- Índice oficial: [APIs Prod. Restrita e Produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao/apis-prod-restrita-e-producao)

Paths SEFIN (relativos à base; **não chamados neste scaffold**):

| Prioridade | Método | Path | Propósito |
|---|---|---|---|
| P0 | `POST` | `/nfse` | Emissão síncrona DPS→NFS-e |
| P0 | `GET` | `/nfse/{chaveAcesso}` | Consulta por chave |
| P0 | `GET` | `/dps/{id}` | Reconciliação Id DPS |
| P0 | `HEAD` | `/dps/{id}` | Existe NFS-e para o Id? |
| P0 | `POST` | `/nfse/{chaveAcesso}/eventos` | Cancelamento `101101` |

Substituição = nova DPS no `POST /nfse` (sistema gera `105102`). Não inventar POST de substituição.

---

## Módulos

```text
src/
├── certificado/      # Certificado — load PFX/P12 A1 (stub, sem mTLS)
├── dps/              # DpsBuilder — Id DPS (45) + XML sem assinatura
├── xml/              # XmlSigner — XMLDSig stub; toGZipB64 implementado
├── sefin/            # NfseClient — emitir / consultar / GET|HEAD dps (stub)
├── eventos/          # Eventos — cancelar 101101; substituir via nova DPS
├── parametros/       # ParametrosMunicipais — ADN parametrizacao (P1)
├── quota/            # Quota — bloqueia se notes_used >= notes_quota
├── persistencia/     # Cliente service-role + helpers (quota_usage / nfse_docs / establishments)
├── retry/            # RetryStore — 429 / 5xx / timeout + replay DPS
├── vitrine/          # Hotsite DRAFT — leads / Auth / Turnstile / handoff (sem SEFIN)
└── config/           # ProducaoRestrita | Producao + bases URL
web/                  # Landing pt-BR + form (servido por `npm run web`)
schemas/xsd/          # XSD oficiais (ainda não baixados)
tests/                # node:test — Quota + persistência + vitrine (sem cert real, sem rede)
```

### Cotas (limite técnico)

Alinhado a `quota_usage.notes_quota` / `subscriptions.notes_quota`:

| `plan_code` | `notes_quota` | período |
|---|---|---|
| `free50` | 50 | `period_yyyymm` (UTC-3) |
| `starter89` | 150 | idem |
| `pro249` | 1000 | idem |
| `scale549` | 4000 | idem |

`Quota.assert` lê `quota_usage` e, se `notes_used >= notes_quota`, lança `QuotaDeniedError` (HTTP 429, log `quota.denied`) **antes** do wire SEFIN. Incremento só após `201` / autorização. Rejeição permanente não consome. Sandbox não aplica o gate.

### Persistência

Schema mínimo **aplicado** no projeto Supabase **sync plvria**. Fonte versionada: [`supabase/migrations/001_schema_minimo.sql`](supabase/migrations/001_schema_minimo.sql).

O worker Nota Bot e o hotsite Vitrine (`src/persistencia/supabaseClient.ts`) leem `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (alias `SUPABASE_SECRET_KEY`). A chave pode ser JWT `service_role` **ou** `sb_secret_…`. Chaves novas vão no header `apikey` (não como `Authorization: Bearer`) — o SDK ainda dual-header em REST/Storage; o wrapper do cliente remove o Bearer quando a secret é `sb_secret_`.

Form `leads` usa **o mesmo** `createSupabaseClient` (não há cliente REST paralelo). Helpers: `insertLead` / `insertCrmEvent` em `src/persistencia/helpers.ts`.

Helpers finos (tipados no schema): `readQuotaUsage`, `insertNfseDoc`, `upsertEstablishment`. Sem mTLS SEFIN neste wire.

- `establishments`: CNPJ, `channel` (`nacional` na 1ª fatia), `certificate_vault_ref`, `certificate_expires_at`
- `nfse_docs`: metadados (`dps_id`, `chave_acesso`, `status`, `environment` `restrita`\|`producao`, `xml_storage_path`)
- `quota_usage`: Unique `(account_id, period_yyyymm)`
- Storage `nfse-xml` (XML) e `certificates` (PFX criptografado, service-role)

**Nunca** gravar PFX/PEM em coluna texto — só `certificate_vault_ref`.

---

## Fora deste scaffold

- Spike mTLS / emissão SEFIN real
- Fechar cobrança / mudar preço (Dinheiro Bot)
- DNS / Cloudflare (`sync.plvria.com.br` já é o host canônico no papel; **não configurar daqui**)
- Publicar o hotsite em produção (precisa ok Dinheiro Bot + Thiago)

---

## Próximos passos

1. **A1 ICP-Brasil** — PFX/P12 com EKU Autenticação Cliente; senha em secret store; mesmo cert para mTLS da conexão e XMLDSig. Não versionar o arquivo.
2. **Swagger SEFIN Restrita com A1** — abrir o portal e confirmar `basePath` real (com/sem `/API`). Colar o path canônico em `src/config/ambientes.ts`.
3. **Schema Supabase** — SQL em `supabase/migrations/`; já aplicado no projeto **sync plvria**. Confirmar buckets `nfse-xml` + `certificates` (privados, service-role).
4. Baixar XSD/anexos atuais (DPS / Eventos / RTC) para `schemas/xsd/`.
5. Só então: implementar `Certificado.load` + spike `POST /nfse` em Produção Restrita + persistir `nfse_docs` / `quota_usage`.
