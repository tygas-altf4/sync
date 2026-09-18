import type { SupabaseClient } from '@supabase/supabase-js';
import { PersistenciaError } from '../errors.js';
import type {
  AccountInsert,
  AccountRow,
  CrmEventInsert,
  CrmEventRow,
  Database,
  EstablishmentInsert,
  EstablishmentRow,
  LeadInsert,
  LeadRow,
  NfseDocInsert,
  NfseDocRow,
  QuotaUsageInsert,
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

/**
 * Insert do hotsite em `leads`. Só service role (RLS: anon não insert/select).
 * Chamado depois do captcha na rota Vitrine — não pelo browser.
 */
export async function insertLead(
  client: PersistenciaClient,
  row: LeadInsert,
): Promise<LeadRow> {
  const { data, error } = await client.from('leads').insert(row).select().single();
  if (error || data === null) {
    throwPersistencia('Falha ao inserir leads', error);
  }
  return data;
}

export async function getLead(
  client: PersistenciaClient,
  id: string,
): Promise<LeadRow | null> {
  const { data, error } = await client.from('leads').select('*').eq('id', id).maybeSingle();
  if (error) {
    throwPersistencia('Falha ao ler leads', error);
  }
  return data;
}

export async function updateLead(
  client: PersistenciaClient,
  id: string,
  patch: Partial<LeadInsert>,
): Promise<LeadRow> {
  const { data, error } = await client.from('leads').update(patch).eq('id', id).select().single();
  if (error || data === null) {
    throwPersistencia('Falha ao atualizar leads', error);
  }
  return data;
}

export async function insertAccount(
  client: PersistenciaClient,
  row: AccountInsert,
): Promise<AccountRow> {
  const { data, error } = await client.from('accounts').insert(row).select().single();
  if (error || data === null) {
    throwPersistencia('Falha ao inserir accounts', error);
  }
  return data;
}

export async function insertQuotaUsageRow(
  client: PersistenciaClient,
  row: QuotaUsageInsert,
): Promise<QuotaUsageRow> {
  const { data, error } = await client.from('quota_usage').insert(row).select().single();
  if (error || data === null) {
    throwPersistencia('Falha ao inserir quota_usage', error);
  }
  return data;
}

export async function insertCrmEvent(
  client: PersistenciaClient,
  row: CrmEventInsert,
): Promise<CrmEventRow> {
  const { data, error } = await client.from('crm_events').insert(row).select().single();
  if (error || data === null) {
    throwPersistencia('Falha ao inserir crm_events', error);
  }
  return data;
}
