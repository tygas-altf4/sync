export { Certificado } from './certificado/Certificado.js';
export type { LoadedCertificate, PfxSource } from './certificado/Certificado.js';

export { DpsBuilder } from './dps/DpsBuilder.js';
export type { BuildDpsIdParams, BuildDpsParams, BuiltDps } from './dps/DpsBuilder.js';

export { XmlSigner } from './xml/XmlSigner.js';

export { NfseClient } from './sefin/NfseClient.js';
export type { EmitirInput, EmitirResult, NfseClientOptions } from './sefin/NfseClient.js';

export {
  Eventos,
  EVENTO_CANCELAMENTO,
  EVENTO_SUBSTITUICAO_SISTEMA,
} from './eventos/Eventos.js';

export { ParametrosMunicipais } from './parametros/ParametrosMunicipais.js';

export {
  Quota,
  InMemoryQuotaUsageStore,
  PLAN_QUOTAS,
  PLAN_CODES,
  notesQuotaForPlan,
  isPlanCode,
  currentPeriodYyyymm,
} from './quota/Quota.js';
export type { QuotaUsage, QuotaUsageStore, QuotaAssertOptions } from './quota/Quota.js';

export {
  Persistencia,
  looksLikeCertificateMaterial,
} from './persistencia/Persistencia.js';
export type {
  Establishment,
  NfseDoc,
  SaveEstablishmentInput,
} from './persistencia/Persistencia.js';

export {
  createSupabaseClient,
  fetchSecretAsApikeyOnly,
  isNewFormatApiKey,
  readSupabaseSecretKey,
  readSupabaseUrl,
  requireSupabaseSecretKey,
  requireSupabaseUrl,
} from './persistencia/supabaseClient.js';
export type {
  CreateSupabaseClientOptions,
  NotaBotSupabaseClient,
  SupabaseEnv,
} from './persistencia/supabaseClient.js';

export {
  getLead,
  insertAccount,
  insertCrmEvent,
  insertLead,
  insertNfseDoc,
  insertQuotaUsageRow,
  readQuotaUsage,
  updateLead,
  upsertEstablishment,
} from './persistencia/helpers.js';
export type { PersistenciaClient } from './persistencia/helpers.js';

export type {
  AccountInsert,
  AccountRow,
  AccountUpdate,
  CrmEventInsert,
  CrmEventRow,
  CrmEventUpdate,
  Database,
  EstablishmentInsert,
  EstablishmentRow,
  EstablishmentUpdate,
  LeadInsert,
  LeadRow,
  LeadUpdate,
  NfseDocInsert,
  NfseDocRow,
  NfseDocUpdate,
  QuotaUsageInsert,
  QuotaUsageRow,
  QuotaUsageUpdate,
} from './persistencia/database.js';

export { RetryStore } from './retry/RetryStore.js';
export type { PendingReplay, RetryReason } from './retry/RetryStore.js';

export {
  loadConfig,
  parseAmbiente,
  ambienteToNfseEnvironment,
  SEFIN_BASE_URL,
  SEFIN_SWAGGER_URL,
  DEFAULT_PUBLIC_HOST,
} from './config/ambientes.js';
export type { SyncNfeConfig } from './config/ambientes.js';

export {
  NotImplementedError,
  QuotaDeniedError,
  PersistenciaError,
} from './errors.js';

export type {
  Ambiente,
  NfseEnvironment,
  Channel,
  PlanCode,
  NfseDocStatus,
  TipoInscricaoFederal,
} from './types.js';
