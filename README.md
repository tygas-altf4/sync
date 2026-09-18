# SyncNFe.NFSeNacional (Plvria Sync)

Núcleo TypeScript da **NFS-e Nacional** (SEFIN) da Plvria.

| | |
|---|---|
| Produto | SyncNFe / Plvria Sync |
| Host canônico | `sync.plvria.com.br` |
| Apex | `plvria.com.br` é **gestão escolar** — não misturar produto, DNS nem deploy |
| Stack | Node.js 20+ / TypeScript |
| Persistência | Supabase (`establishments`, `nfse_docs`, `quota_usage` + Storage) |

Este repositório é o **scaffold** do cliente SEFIN. **Não emite NFS-e real ainda** (sem mTLS / A1 neste PR).

## Arquitetura

Decisões não negociáveis (schema, SEFIN, cota, A1, wire, fronteira de auth, rate limit): [ADR-001 — Arquitetura NFS-e](docs/ADR-001-arquitetura-nfse.md).

Agentes Cursor: [AGENTS.md](AGENTS.md).

---

## Como rodar

```bash
npm install
npm test
npm run build
npm run lint
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
├── persistencia/     # Supabase: establishments, nfse_docs; só vault_ref
├── retry/            # RetryStore — 429 / 5xx / timeout + replay DPS
└── config/           # ProducaoRestrita | Producao + bases URL
schemas/xsd/          # XSD oficiais (ainda não baixados)
tests/                # node:test — Quota (sem cert real, sem rede)
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

- `establishments`: CNPJ, `channel` (`nacional` na 1ª fatia), `certificate_vault_ref`, `certificate_expires_at`
- `nfse_docs`: metadados (`dps_id`, `chave_acesso`, `status`, `environment` `restrita`\|`producao`, `xml_storage_path`)
- `quota_usage`: Unique `(account_id, period_yyyymm)`
- Storage `nfse-xml` (XML) e `certificates` (PFX criptografado, service-role)

**Nunca** gravar PFX/PEM em coluna texto — só `certificate_vault_ref`.

---

## Fora deste scaffold

- Spike mTLS / emissão SEFIN real
- Hotsite, pricing, billing (Vitrine / Dinheiro)
- DNS / Cloudflare (`sync.plvria.com.br` já é o host canônico no papel; **não configurar daqui**)

---

## Próximos passos

1. **A1 ICP-Brasil** — PFX/P12 com EKU Autenticação Cliente; senha em secret store; mesmo cert para mTLS da conexão e XMLDSig. Não versionar o arquivo.
2. **Swagger SEFIN Restrita com A1** — abrir o portal e confirmar `basePath` real (com/sem `/API`). Colar o path canônico em `src/config/ambientes.ts`.
3. **Schema Supabase** — aplicar o SQL mínimo (`establishments`, `nfse_docs`, `quota_usage`, buckets `nfse-xml` + `certificates`). Worker SEFIN usa service role.
4. Baixar XSD/anexos atuais (DPS / Eventos / RTC) para `schemas/xsd/`.
5. Só então: implementar `Certificado.load` + spike `POST /nfse` em Produção Restrita + persistir `nfse_docs` / `quota_usage`.
