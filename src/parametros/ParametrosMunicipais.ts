import { NotImplementedError } from '../errors.js';

export type ParametrosCacheTtlMs = number;

/**
 * Parâmetros municipais via host **ADN parametrizacao** (não SEFIN legado).
 *
 * Paths atuais (P1, confirmar no swagger ADN): `/aliquotas/...`,
 * `/convenios/{cod}`, `/beneficios/...`, `/regimesespeciais/...`, `/retencoes/...`.
 * Diferem do `/parametros_municipais/...` do manual antigo.
 *
 * Hosts ADN:
 * - `https://adn.producaorestrita.nfse.gov.br/parametrizacao`
 * - `https://adn.nfse.gov.br/parametrizacao`
 */
export class ParametrosMunicipais {
  readonly cacheTtlMs: ParametrosCacheTtlMs;

  constructor(cacheTtlMs: ParametrosCacheTtlMs = 60 * 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  async aliquota(_codigoMunicipioIbge: string): Promise<never> {
    throw new NotImplementedError(
      'ParametrosMunicipais',
      'alíquota stub — ADN parametrizacao (P1)',
    );
  }

  async convenio(_codigo: string): Promise<never> {
    throw new NotImplementedError(
      'ParametrosMunicipais',
      'convênio stub — ADN /convenios/{cod}',
    );
  }
}
