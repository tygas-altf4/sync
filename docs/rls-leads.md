# RLS — `leads` (expectativa day-1)

**Draft.** Aplicar no projeto Supabase compartilhado. Este repo não publica política sozinho.

## Regra

| Papel | `leads` SELECT | `leads` INSERT/UPDATE/DELETE |
|---|---|---|
| `anon` | **não** | **não** |
| `authenticated` | não lista a tabela de leads de terceiros | não |
| `service_role` | sim (só servidor / Edge Function) | sim, **depois** do captcha |

O browser **nunca** recebe `SUPABASE_SERVICE_ROLE_KEY`. No cliente só entram:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TURNSTILE_SITE_KEY`

Insert do hotsite: `POST /api/leads` → valida Turnstile (ou stub se as chaves faltarem) → insert com service role.

Signup Auth: anon key no servidor (`/api/auth/*`). Confirmação de e-mail obrigatória antes de `accounts` + `quota_usage`.

## SQL mínimo esperado

```sql
alter table public.leads enable row level security;

-- sem policy de SELECT/INSERT para anon ou authenticated
-- (ausência de policy = deny no Postgres RLS)

-- service_role ignora RLS no Supabase; é o único caminho de escrita do hotsite.
```

Se existir policy antiga `anon insert leads`, **remover**. Captcha no cliente sem RLS não basta.

`crm_events` e `accounts`: mesma ideia — anon não select. Escritas pelo server path.
