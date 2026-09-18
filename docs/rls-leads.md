# RLS — `leads`

SQL + RLS **já estão no projeto** (`leads`, `accounts`, `establishments`, `subscriptions`, `quota_usage`, `nfse_docs`, `crm_events`; buckets `nfse-xml` e `certificates` privados). Este hotsite **não** grava pelo browser.

## Caminho do form (server-only)

`POST /api/leads` → rate limit → captcha (Turnstile) → `insertLead(createSupabaseClient())` (#5).

Colunas gravadas: `nome`, `email`, `cnpj` / `cnpj_pendente`, `volume_mensal` (`ate_50`|`51_200`|`201_500`|`500_mais`|`nao_sei`), `perfil` (`empresa`|`contador`|`outro`), `lgpd_at`, `origem=hotsite`, UTMs, `stage=novo`, `account_id=null`.

Env **só no servidor** (nunca commit, nunca bundle):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (JWT `service_role` **ou** `sb_secret_…`; alias `SUPABASE_SECRET_KEY`)

Sem essas duas, o insert **stuba** em memória. O browser só vê `SUPABASE_ANON_KEY` + `TURNSTILE_SITE_KEY` via `/api/public-config`.

## Regra RLS

| Papel | `leads` SELECT | `leads` INSERT/UPDATE/DELETE |
|---|---|---|
| `anon` | **não** | **não** |
| `authenticated` | não lista leads de terceiros | não |
| `service_role` | sim (só servidor) | sim, **depois** do captcha |

Signup Auth: anon key no servidor (`/api/auth/*`). E-mail confirmado antes de `accounts` + `quota_usage`. MFA TOTP em `/app` depois do e-mail.

Policy `leads_owner_select` só libera SELECT depois de `account_id` + owner. **Não há policy de INSERT para anon.** Se existir policy antiga `anon insert leads`, **remover**.

`crm_events` e `accounts`: anon não select. Escritas pelo server path.
