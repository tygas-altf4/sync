import type { SupabaseClient } from '@supabase/supabase-js';
import { PersistenciaError } from '../errors.js';
import type {
  Database,
  EstablishmentInsert,
  EstablishmentRow,
  NfseDocInsert,
  NfseDocRow,
  QuotaUsageRow,
} from './database.js';
import { looksLikeCertificateMaterial } from './Persistencia.js';

export type PersistenciaClient = SupabaseClient<Database>;

function throwPersistencia(
  action: string,
  error: { message: string } | null,
): never {
  throw new PersistenciaError(
    `${action}: ${error?.message ?? 'sem retorno do PostgREST'}`,
  );
}

/**
 * Lê o snapshot de cota do período (`unique (account_id, period_yyyymm)`).
 * Stub fino — o lock `SELECT … FOR UPDATE` de `Quota.assert` vem depois.
 */
export async function readQuotaUsage(
  client: PersistenciaClient,
  accountId: string,
  periodYyyymm: string,
): Promise<QuotaUsageRow | null> {
  const { data, error } = await client
    .from('quota_usage')
    .select('*')
    .eq('account_id', accountId)
    .eq('period_yyyymm', periodYyyymm)
    .maybeSingle();

  if (error) {
    throwPersistencia('Falha ao ler quota_usage', error);
  }
  return data;
}

/** Insere metadados de NFS-e. XML vive no bucket `nfse-xml` (`xml_storage_path`). */
export async function insertNfseDoc(
  client: PersistenciaClient,
  row: NfseDocInsert,
): Promise<NfseDocRow> {
  const { data, error } = await client.from('nfse_docs').insert(row).select().single();

  if (error || data === null) {
    throwPersistencia('Falha ao inserir nfse_docs', error);
  }
  return data;
}

/**
 * Upsert em `establishments` pela unique `(account_id, cnpj)`.
 * Recusa PFX/PEM em `certificate_vault_ref` — só path de Storage / secret manager.
 */
export async function upsertEstablishment(
  client: PersistenciaClient,
  row: EstablishmentInsert,
): Promise<EstablishmentRow> {
  if (
    row.certificate_vault_ref != null &&
    looksLikeCertificateMaterial(row.certificate_vault_ref)
  ) {
    throw new PersistenciaError(
      'Nunca persistir PFX/PEM em coluna texto — use certificate_vault_ref',
    );
  }

  const { data, error } = await client
    .from('establishments')
    .upsert(row, { onConflict: 'account_id,cnpj' })
    .select()
    .single();

  if (error || data === null) {
    throwPersistencia('Falha ao upsert establishment', error);
  }
  return data;
}
