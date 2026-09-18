import { NotImplementedError } from '../errors.js';

export const EVENTO_CANCELAMENTO = '101101' as const;
export const EVENTO_SUBSTITUICAO_SISTEMA = '105102' as const;

/**
 * Eventos P0: cancelamento contribuinte `101101`.
 *
 * Substituição: emitir **nova DPS** com a chave da nota original no POST `/nfse`
 * — o sistema gera `105102`. Não inventar POST de substituição separado.
 *
 * Wire: `{ "pedidoRegistroEventoXmlGZipB64": "..." }` em
 * `POST /nfse/{chaveAcesso}/eventos` (mTLS; não neste scaffold).
 */
export class Eventos {
  async cancelar(_chaveAcesso: string, _justificativa: string): Promise<never> {
    throw new NotImplementedError(
      'Eventos',
      'cancelar stub — pedRegEvento 101101 / POST .../eventos',
    );
  }

  /**
   * Substituição = nova DPS referenciando a chave original (não POST 105102 manual).
   */
  async substituir(_chaveOriginal: string): Promise<never> {
    throw new NotImplementedError(
      'Eventos',
      'substituir stub — nova DPS no POST /nfse (105102 gerado pelo sistema)',
    );
  }
}
