import { NotImplementedError } from '../errors.js';

export type PfxSource = string | Buffer;

export type LoadedCertificate = {
  keyPem: string;
  certPem: string;
  notAfter: Date;
  cnpjOrCpf: string;
};

/**
 * Stub: parse PFX/P12 A1 + mTLS **não** implementados neste scaffold.
 *
 * Contrato futuro:
 * `loadPfx(path|buf, pwd) → { keyPem, certPem, notAfter, cnpjOrCpf }`
 * Falha se sem EKU clientAuth / vencido.
 *
 * Runtime: `establishments.certificate_vault_ref` → Storage `certificates`
 * (service-role) → bytes → PEM **em memória**. Nunca logar material.
 * Nunca persistir PFX/PEM em coluna texto.
 */
export class Certificado {
  async loadPfx(_source: PfxSource, _password: string): Promise<LoadedCertificate> {
    throw new NotImplementedError(
      'Certificado',
      'loadPfx stub — parse A1 / mTLS fora deste scaffold',
    );
  }

  async loadFromVaultRef(_vaultRef: string): Promise<LoadedCertificate> {
    throw new NotImplementedError(
      'Certificado',
      'loadFromVaultRef stub — resolver certificate_vault_ref ainda não implementado',
    );
  }
}
