# Skills (futuras)

Não implementadas. Abrir quando Thiago pedir. Até lá, seguir [`docs/ADR-001-arquitetura-nfse.md`](../../docs/ADR-001-arquitetura-nfse.md) e [`AGENTS.md`](../../AGENTS.md).

| Skill | Quando | Escopo (ainda sem corpo) |
|---|---|---|
| `emit-nfse-spike` | Spike mTLS `POST /nfse` em Produção Restrita | A1 + HTTP/1.1 + dry-run; confirmar `basePath`; **não** emitir em Produção |
| `supabase-migrate` | Aplicar schema mínimo | `establishments`, `nfse_docs`, `quota_usage`, buckets `nfse-xml` / `certificates`, RLS; service role só no worker |

Não inventar outras skills. Não implementar os corpos neste PR.
