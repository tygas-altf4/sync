import type { Channel, NfseDocStatus, NfseEnvironment } from '../types.js';

/**
 * Tipos alinhados a `supabase/migrations/001_schema_minimo.sql`.
 * PostgREST devolve timestamptz como ISO-8601 (string).
 */
export type QuotaUsageRow = {
  id: string;
  account_id: string;
  period_yyyymm: string;
  notes_used: number;
  notes_quota: number;
  updated_at: string;
};

export type QuotaUsageInsert = {
  id?: string;
  account_id: string;
  period_yyyymm: string;
  notes_used?: number;
  notes_quota: number;
  updated_at?: string;
};

export type QuotaUsageUpdate = Partial<QuotaUsageInsert>;

export type EstablishmentRow = {
  id: string;
  account_id: string;
  cnpj: string;
  inscricao_municipal: string | null;
  codigo_municipio_ibge: string | null;
  channel: Channel;
  channel_provider: string | null;
  certificate_vault_ref: string | null;
  certificate_expires_at: string | null;
  active: boolean;
};

export type EstablishmentInsert = {
  id?: string;
  account_id: string;
  cnpj: string;
  inscricao_municipal?: string | null;
  codigo_municipio_ibge?: string | null;
  channel?: Channel;
  channel_provider?: string | null;
  certificate_vault_ref?: string | null;
  certificate_expires_at?: string | null;
  active?: boolean;
};

export type EstablishmentUpdate = Partial<EstablishmentInsert>;

export type NfseDocRow = {
  id: string;
  account_id: string;
  establishment_id: string;
  environment: NfseEnvironment;
  channel: Channel;
  dps_id: string | null;
  chave_acesso: string | null;
  status: NfseDocStatus;
  rejection_code: string | null;
  rejection_msg: string | null;
  xml_storage_path: string | null;
  emitted_at: string | null;
  created_at: string;
};

export type NfseDocInsert = {
  id?: string;
  account_id: string;
  establishment_id: string;
  environment: NfseEnvironment;
  channel: Channel;
  dps_id?: string | null;
  chave_acesso?: string | null;
  status?: NfseDocStatus;
  rejection_code?: string | null;
  rejection_msg?: string | null;
  xml_storage_path?: string | null;
  emitted_at?: string | null;
  created_at?: string;
};

export type NfseDocUpdate = Partial<NfseDocInsert>;

export type LeadRow = {
  id: string;
  created_at: string;
  nome: string;
  email: string;
  cnpj: string | null;
  cnpj_pendente: boolean;
  volume_mensal: string;
  perfil: string;
  lgpd_at: string;
  origem: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  stage: string;
  account_id: string | null;
  notes: string | null;
};

export type LeadInsert = {
  id?: string;
  created_at?: string;
  nome: string;
  email: string;
  cnpj?: string | null;
  cnpj_pendente?: boolean;
  volume_mensal: string;
  perfil: string;
  lgpd_at: string;
  origem?: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  stage?: string;
  account_id?: string | null;
  notes?: string | null;
};

export type LeadUpdate = Partial<LeadInsert>;

export type AccountRow = {
  id: string;
  created_at: string;
  owner_user_id: string;
  name: string;
  plan_code: string;
  plan_status: string;
  lead_id: string | null;
};

export type AccountInsert = {
  id?: string;
  created_at?: string;
  owner_user_id: string;
  name: string;
  plan_code?: string;
  plan_status?: string;
  lead_id?: string | null;
};

export type AccountUpdate = Partial<AccountInsert>;

export type CrmEventRow = {
  id: string;
  lead_id: string | null;
  account_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type CrmEventInsert = {
  id?: string;
  lead_id?: string | null;
  account_id?: string | null;
  event_type: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

export type CrmEventUpdate = Partial<CrmEventInsert>;

type TableDef<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

/**
 * Generic mínimo do cliente Supabase (tabelas do núcleo Nota + Vitrine).
 * Sem Views/Functions — o worker não as usa neste wire.
 */
export type Database = {
  public: {
    Tables: {
      quota_usage: TableDef<QuotaUsageRow, QuotaUsageInsert, QuotaUsageUpdate>;
      establishments: TableDef<
        EstablishmentRow,
        EstablishmentInsert,
        EstablishmentUpdate
      >;
      nfse_docs: TableDef<NfseDocRow, NfseDocInsert, NfseDocUpdate>;
      leads: TableDef<LeadRow, LeadInsert, LeadUpdate>;
      accounts: TableDef<AccountRow, AccountInsert, AccountUpdate>;
      crm_events: TableDef<CrmEventRow, CrmEventInsert, CrmEventUpdate>;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
