import { NotImplementedError } from '../errors.js';
import type { Ambiente } from '../types.js';
import { SEFIN_BASE_URL } from '../config/ambientes.js';

export type EmitirInput = {
  /** Body SEFIN: `{ "dpsXmlGZipB64": "..." }` — Content-Type application/json. */
  dpsXmlGZipB64: string;
};

export type EmitirResult = {
  status: 201;
  chaveAcesso: string;
  idDps: string;
  nfseXmlGZipB64: string;
};

export type NfseClientOptions = {
  ambiente: Ambiente;
};

/**
 * Cliente SEFIN Nacional — **sem mTLS neste scaffold**.
 *
 * Paths (relativos à base; não executar agora):
 * - POST `/nfse`
 * - GET  `/nfse/{chaveAcesso}`
 * - GET  `/dps/{id}`
 * - HEAD `/dps/{id}`
 *
 * Auth: sem token/API key. Wire futuro = mTLS A1 + HTTP/1.1 (SEFIN rejeita H2).
 */
export class NfseClient {
  readonly ambiente: Ambiente;
  readonly baseUrl: string;

  constructor(options: NfseClientOptions) {
    this.ambiente = options.ambiente;
    this.baseUrl = SEFIN_BASE_URL[options.ambiente];
  }

  async emitir(_input: EmitirInput): Promise<EmitirResult> {
    throw new NotImplementedError(
      'NfseClient',
      'emitir stub — POST /nfse exige mTLS; fora deste scaffold',
    );
  }

  async consultarPorChave(_chaveAcesso: string): Promise<never> {
    throw new NotImplementedError(
      'NfseClient',
      'consultarPorChave stub — GET /nfse/{chaveAcesso}',
    );
  }

  async getDpsStatus(_idDps: string): Promise<never> {
    throw new NotImplementedError(
      'NfseClient',
      'getDpsStatus stub — GET /dps/{id}',
    );
  }

  async headDpsExists(_idDps: string): Promise<never> {
    throw new NotImplementedError(
      'NfseClient',
      'headDpsExists stub — HEAD /dps/{id}',
    );
  }
}
