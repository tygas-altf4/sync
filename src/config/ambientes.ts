import type { Ambiente, NfseEnvironment } from '../types.js';

/**
 * Bases SEFIN (do plano técnico SyncNFe.NFSeNacional).
 *
 * | Ambiente           | Base runtime (libs / mirror OpenAPI)                          | Swagger UI (portal) |
 * |--------------------|---------------------------------------------------------------|---------------------|
 * | ProducaoRestrita   | https://sefin.producaorestrita.nfse.gov.br/SefinNacional      | https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index |
 * | Producao           | https://sefin.nfse.gov.br/SefinNacional                       | https://sefin.nfse.gov.br/SefinNacional/docs/index |
 *
 * O portal lista `/API/` no path do **docs** em restrita; o mirror OpenAPI usa
 * `basePath: /SefinNacional/`. open-nfse opera **sem** `/API` no host de API.
 * Confirmar o prefixo real no swagger oficial com certificado A1.
 *
 * Paths relativos à base SEFIN — **não chamar neste scaffold** (sem mTLS):
 * - P0 POST `/nfse`                          emissão síncrona DPS→NFS-e
 * - P0 GET  `/nfse/{chaveAcesso}`            consulta por chave (~50 pos.)
 * - P0 GET  `/dps/{id}`                      reconciliação Id DPS → chave
 * - P0 HEAD `/dps/{id}`                      existe NFS-e para o Id DPS?
 * - P0 POST `/nfse/{chaveAcesso}/eventos`    pedRegEvento (cancel. 101101)
 * - P1 GET  `/nfse/{chaveAcesso}/eventos`    lista (confirmar no swagger)
 *
 * ADN (P1, não SEFIN legado):
 * - Contribuintes:  https://adn.{producaorestrita.}nfse.gov.br/contribuintes
 * - Parametrização: .../parametrizacao
 *
 * Índice: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao/apis-prod-restrita-e-producao
 */
export const SEFIN_BASE_URL = {
  ProducaoRestrita: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  Producao: 'https://sefin.nfse.gov.br/SefinNacional',
} as const satisfies Record<Ambiente, string>;

export const SEFIN_SWAGGER_URL = {
  ProducaoRestrita:
    'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index',
  Producao: 'https://sefin.nfse.gov.br/SefinNacional/docs/index',
} as const satisfies Record<Ambiente, string>;

export const DEFAULT_PUBLIC_HOST = 'sync.plvria.com.br';

export type SyncNfeConfig = {
  ambiente: Ambiente;
  publicHost: string;
  sefinBaseUrl: string;
  sefinSwaggerUrl: string;
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
};

export function ambienteToNfseEnvironment(ambiente: Ambiente): NfseEnvironment {
  return ambiente === 'Producao' ? 'producao' : 'restrita';
}

export function parseAmbiente(raw: string | undefined): Ambiente {
  if (raw === 'Producao' || raw === 'ProducaoRestrita') {
    return raw;
  }
  if (raw === undefined || raw === '') {
    return 'ProducaoRestrita';
  }
  throw new Error(
    `SYNCNFE_AMBIENTE inválido: ${raw}. Use ProducaoRestrita | Producao.`,
  );
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): SyncNfeConfig {
  const ambiente = parseAmbiente(env['SYNCNFE_AMBIENTE']);
  return {
    ambiente,
    publicHost: env['SYNCNFE_PUBLIC_HOST'] ?? DEFAULT_PUBLIC_HOST,
    sefinBaseUrl: SEFIN_BASE_URL[ambiente],
    sefinSwaggerUrl: SEFIN_SWAGGER_URL[ambiente],
    supabaseUrl: env['SUPABASE_URL'],
    supabaseServiceRoleKey: env['SUPABASE_SERVICE_ROLE_KEY'],
  };
}
