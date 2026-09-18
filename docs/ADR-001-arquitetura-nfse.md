# ADR-001 — Arquitetura do núcleo NFS-e Nacional

| | |
|---|---|
| Status | Aceito |
| Data | 2026-09-18 |
| Produto | SyncNFe / Plvria Sync |
| Escopo | Cliente SEFIN Nacional (DPS → NFS-e) neste repositório |

## 1. Contexto

SyncNFe (Plvria Sync) é o núcleo TypeScript da **NFS-e Nacional** (SEFIN). Público: **empresa e contador**. Não é produto escolar; o apex `plvria.com.br` é gestão escolar e não compartilha produto, DNS nem deploy.

- Host canônico: `sync.plvria.com.br`
- Stack: Node.js 20+ / TypeScript (já no scaffold)
- Persistência: um schema Supabase (aprovado) — sem API paralela, sem segundo banco
- 1ª fatia: emitir DPS síncrona, consultar chave/DPS, cancelar `101101`. Sem emissão real ainda (mTLS/A1 pendente)

O protocolo SEFIN já existe (Manual Contribuintes v1.2, OpenAPI, open-nfse). Este ADR trava o que o Sync **não** reinventa.

## 2. Decisões (não negociáveis)

### 2.1 Um schema Supabase — sem API paralela

Tabelas/contrato do núcleo:

| Recurso | Papel |
|---|---|
| `establishments` | CNPJ, `channel` (`nacional` na 1ª fatia), `codigo_municipio_ibge`, IM, `certificate_vault_ref`, `certificate_expires_at` |
| `quota_usage` | Gate pré-emissão. Unique `(account_id, period_yyyymm)` |
| `nfse_docs` | Metadados pós-wire: `dps_id`, `chave_acesso`, `status`, `environment` (`restrita`\|`producao`), `channel`, rejeição, `xml_storage_path`, `emitted_at` |
| `accounts` | Lê `account_id` / `plan_code`. Sem ownership de billing |
| Storage `nfse-xml` | XML DPS/NFS-e (privado); path em `nfse_docs.xml_storage_path` |
| Storage `certificates` | PFX criptografado; **service-role only** |

Worker SEFIN usa **service role**. RLS de usuário fica na app. Não criar REST/GraphQL/fila própria para o mesmo estado fiscal.

Canal `nacional` agora. `campinas` / `sao_paulo` = conectores depois, mesmo `establishments.channel`.

### 2.2 SEFIN via wrapper MIT — não inventar protocolo

Preferir **open-nfse** (MIT) como referência/wrapper: sign, mTLS, gzip, paths. Alternativa só se o núcleo virar PHP: `nfse-nacional/nfse-php`. Não misturar duas stacks no cliente SEFIN.

Ownership SyncNFe: cota, persistência, ambientes, retry/reconciliação. Ownership open-nfse (ou extração pontual): XMLDSig, compactação, handshake HTTP.

Não reimplementar XSD/XMLDSig/envelope “do zero”. Não puxar dependência AGPL.

Incerteza residual (confirmar no swagger oficial **com A1**): prefixo `/API` no runtime de Produção Restrita. open-nfse e o mirror OpenAPI operam **sem** `/API` no host de API.

### 2.3 Gate de cota no DB antes do wire SEFIN

`Quota.assert` faz `SELECT … FOR UPDATE` em `quota_usage`. Se `notes_used >= notes_quota` → `QuotaDeniedError` (HTTP 429 SyncNFe, log `quota.denied`) **antes** de qualquer chamada SEFIN.

Cota = limite técnico, não copy de pricing. Snapshot em `quota_usage.notes_quota` alinhado a `subscriptions.notes_quota`:

| `plan_code` | `notes_quota` | período |
|---|---|---|
| `free50` | 50 | `period_yyyymm` (UTC-3) |
| `starter89` | 150 | idem |
| `pro249` | 1000 | idem |
| `scale549` | 4000 | idem |

Sandbox interno não aplica o gate. Incremento atômico **somente** após SEFIN **201** / autorização. Rejeição permanente não consome.

### 2.4 Certificado A1 só via `vault_ref`

- A1 ICP-Brasil (PFX/P12), EKU Autenticação Cliente. SyncNFe assume A1 server-side (A3 existe no padrão, fora do runtime atual).
- Mesmo cert: **mTLS da conexão** + **XMLDSig** da DPS/evento.
- Persistência: só `establishments.certificate_vault_ref` (path Storage / secret manager). **Nunca** PFX/PEM em coluna texto.
- `Certificado.load` = resolver vault_ref → bytes → PEM em memória. Não logar material. Senha no secret store. Alerta `notAfter` < 30 dias.
- Worker = service role no bucket `certificates`.

### 2.5 Ambientes: Produção Restrita primeiro

| `Ambiente` | Persistido em `nfse_docs.environment` | Base runtime |
|---|---|---|
| `ProducaoRestrita` (padrão) | `restrita` | `https://sefin.producaorestrita.nfse.gov.br/SefinNacional` |
| `Producao` | `producao` | `https://sefin.nfse.gov.br/SefinNacional` |

Gate `ProducaoRestrita` → `Producao` é **explícito** (feature flag / `SYNCNFE_AMBIENTE`). Só depois do ciclo restrita verde (emitir, consultar, reconciliar DPS, cancelar `101101`, retry/cron, schema). Cada `201` em produção é documento fiscal real.

### 2.6 Wire SEFIN

Sem token/API key. Auth = mTLS A1.

- Envelope: JSON (`Content-Type: application/json`; `application/xml` no envelope → 415 conhecido)
- Payload: XML DPS/evento **XMLDSig** (RSA-SHA256, exc-c14n, enveloped) → **GZip → base64binary**
- `POST /nfse` body: `{ "dpsXmlGZipB64": "..." }`
- Evento: `{ "pedidoRegistroEventoXmlGZipB64": "..." }`
- Forçar **HTTP/1.1** (SEFIN rejeita H2; hang conhecido em cliente HTTP/2)
- TLS 1.2+

P0 relativo à base: `POST /nfse`, `GET /nfse/{chaveAcesso}`, `GET|HEAD /dps/{id}`, `POST /nfse/{chaveAcesso}/eventos` (cancel `101101`). Substituição = nova DPS no `POST /nfse` (sistema gera `105102`); não inventar POST de substituição.

## 3. Rejeição e retry

Fluxo pós-`POST /nfse`:

| Resposta | Ação | Cota | `nDPS` |
|---|---|---|---|
| **201** | Persistir XML em `nfse-xml` + `nfse_docs`; `Quota.consumeOnAuthorized` | Consome | Avança (autorizada) |
| **400** | `ReceitaRejection` tipada (`rejection_code` / `rejection_msg` em `nfse_docs`). **Sem retry cego** | Não consome | Não corromper o contador; regra documentada, sem erro genérico |
| **429 / 5xx / timeout** | Enfileirar `RetryStore` (`Retry-After` se 429). **Não** reenviar DPS às cegas | Não consome até 201 confirmado | Idem |

Reconciliação obrigatória após POST incerto: `HEAD /dps/{id}` (existe?) e/ou `GET /dps/{id}` (chave). Evita segunda autorização. Cron: `replayPendingEvents` + reconciliação DPS.

Id DPS (45): IBGE(7) + tpInscr(1) + IEFed(14) + série(5) + nDPS(15).

## 4. Fora de escopo (explícito)

| Item | Onde vive / por quê |
|---|---|
| Hotsite, CRM, leads, `crm_events` | **Vitrine** — não neste repo |
| Billing, Stripe/Asaas, `price_brl`, ownership de plano comercial | **Dinheiro** — Sync só lê `plan_code` / snapshot de cota |
| ABRASF municipal legado (“puro”) | Fora. Conectores `campinas` / `sao_paulo` são depois, mesmo schema |
| Reinventar protocolo SEFIN / XSD / XMLDSig | Wrapper MIT (open-nfse) ou extração pontual |
| Dependências AGPL | Bloqueado |
| Posicionamento escolar, DNS/deploy no apex | `plvria.com.br` ≠ Sync; host = `sync.plvria.com.br` |
| NF-e produto, gateway comercial (PlugNotas etc.) | Fora |
| ADN distribuição NSU completa, CNC, Painel Municipal, DANFSe online | P2 / PDF local depois |
| IBS/CBS (`IBSCBS` / RTC) como regra bloqueante | DTO extensível; não bloquear P0 |
| UI emissor, marketing de planos | Fora |

## 5. Consequências e próximos spikes

**Consequências**

- Scaffold atual (`src/{certificado,dps,xml,sefin,eventos,parametros,quota,persistencia,retry,config}`) permanece o mapa 1:1; persistência/cota/retry já expressam este ADR em stub.
- Sem segundo contrato de dados. Qualquer tela/API Sync lê as mesmas tabelas.
- Troca de ambiente errada em produção emite NFS-e real — o default **é** `ProducaoRestrita`.
- Timeout sem `GET|HEAD /dps/{id}` pode duplicar autorização.

**Spikes seguintes (sem alargar este ADR)**

1. **Plugar open-nfse** (ou extrair sign/mTLS/gzip) sob `XmlSigner` / `NfseClient`. Confirmar licença MIT no lockfile. Sem AGPL.
2. **Spike A1 mTLS** em Produção Restrita: PFX com EKU clientAuth; HTTP/1.1; `POST /nfse` dry-run; mesmo cert na conexão e no XMLDSig. Confirmar `basePath` real (com/sem `/API`) no swagger com A1 e gravar em `src/config/ambientes.ts`.
3. **Aplicar SQL do schema** (`establishments`, `nfse_docs`, `quota_usage`, buckets `nfse-xml` + `certificates`). Trocar stubs em memória por service role. Só então emissão + `Quota.consumeOnAuthorized` no 201.

Fontes: Manual Contribuintes v1.2 (out/2025); [APIs Prod. Restrita e Produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao/apis-prod-restrita-e-producao); [open-nfse](https://github.com/Fm-s/open-nfse).
