import { PersistenciaError } from '../errors.js';
import type { Channel, NfseDocStatus, NfseEnvironment } from '../types.js';

export type Establishment = {
  id: string;
  account_id: string;
  cnpj: string;
  inscricao_municipal?: string;
  codigo_municipio_ibge?: string;
  channel: Channel;
  /** Path/ref no Storage `certificates` ou secret manager — nunca PFX/PEM raw. */
  certificate_vault_ref: string;
  certificate_expires_at?: Date;
  active: boolean;
};

export type NfseDoc = {
  id: string;
  account_id: string;
  establishment_id: string;
  environment: NfseEnvironment;
  channel: Channel;
  dps_id?: string;
  chave_acesso?: string;
  status: NfseDocStatus;
  rejection_code?: string;
  rejection_msg?: string;
  xml_storage_path?: string;
  emitted_at?: Date;
};

export type SaveEstablishmentInput = Omit<Establishment, 'id'> & { id?: string };

/**
 * Detecta material de certificado (PEM/DER) tentando ir para coluna texto.
 * Path de Storage tipo `certificates/{account}/a1.pfx` é ref válida — não é o binário.
 */
export function looksLikeCertificateMaterial(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.includes('-----BEGIN')) {
    return true;
  }
  return /^MII[A-Za-z0-9+/=\s]{80,}$/.test(trimmed);
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Persistência Supabase (contrato Nota Bot) — stub em memória.
 *
 * Tabelas: `establishments`, `nfse_docs`, `quota_usage`.
 * Storage: `nfse-xml` (XML), `certificates` (PFX criptografado, service-role).
 *
 * Regra dura: **nunca** persistir PFX/PEM em coluna texto — só `certificate_vault_ref`.
 */
export class Persistencia {
  private readonly establishments = new Map<string, Establishment>();
  private readonly docs = new Map<string, NfseDoc>();

  saveEstablishment(input: SaveEstablishmentInput): Establishment {
    if (looksLikeCertificateMaterial(input.certificate_vault_ref)) {
      throw new PersistenciaError(
        'Nunca persistir PFX/PEM em coluna texto — use certificate_vault_ref',
      );
    }
    const row: Establishment = {
      id: input.id ?? newId(),
      account_id: input.account_id,
      cnpj: input.cnpj,
      channel: input.channel,
      certificate_vault_ref: input.certificate_vault_ref,
      active: input.active,
      ...(input.inscricao_municipal !== undefined
        ? { inscricao_municipal: input.inscricao_municipal }
        : {}),
      ...(input.codigo_municipio_ibge !== undefined
        ? { codigo_municipio_ibge: input.codigo_municipio_ibge }
        : {}),
      ...(input.certificate_expires_at !== undefined
        ? { certificate_expires_at: input.certificate_expires_at }
        : {}),
    };
    this.establishments.set(row.id, row);
    return row;
  }

  getEstablishment(id: string): Establishment | undefined {
    return this.establishments.get(id);
  }

  saveNfseDoc(input: Omit<NfseDoc, 'id'> & { id?: string }): NfseDoc {
    const row: NfseDoc = {
      id: input.id ?? newId(),
      account_id: input.account_id,
      establishment_id: input.establishment_id,
      environment: input.environment,
      channel: input.channel,
      status: input.status,
      ...(input.dps_id !== undefined ? { dps_id: input.dps_id } : {}),
      ...(input.chave_acesso !== undefined ? { chave_acesso: input.chave_acesso } : {}),
      ...(input.rejection_code !== undefined
        ? { rejection_code: input.rejection_code }
        : {}),
      ...(input.rejection_msg !== undefined ? { rejection_msg: input.rejection_msg } : {}),
      ...(input.xml_storage_path !== undefined
        ? { xml_storage_path: input.xml_storage_path }
        : {}),
      ...(input.emitted_at !== undefined ? { emitted_at: input.emitted_at } : {}),
    };
    this.docs.set(row.id, row);
    return row;
  }

  getNfseDoc(id: string): NfseDoc | undefined {
    return this.docs.get(id);
  }
}
