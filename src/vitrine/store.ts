/**
 * Store da Vitrine. Stub em memória sem env; com env usa o cliente
 * compartilhado `createSupabaseClient` (#5). Só tabelas do schema 001 —
 * sem coluna inventada, sem fetch REST paralelo.
 */
import {
  createSupabaseClient,
  readSupabaseSecretKey,
  readSupabaseUrl,
  type CreateSupabaseClientOptions,
} from '../persistencia/supabaseClient.js';
import {
  getLead,
  insertAccount,
  insertCrmEvent,
  insertLead,
  insertQuotaUsageRow,
  updateLead,
  type PersistenciaClient,
} from '../persistencia/helpers.js';
import type {
  AccountInsert,
  AccountRow,
  CrmEventInsert,
  CrmEventRow,
  LeadInsert,
  LeadRow,
  QuotaUsageInsert,
  QuotaUsageRow,
} from './types.js';

export interface VitrineStore {
  insertLead(row: LeadInsert): Promise<LeadRow>;
  getLead(id: string): Promise<LeadRow | null>;
  updateLead(id: string, patch: Partial<LeadRow>): Promise<LeadRow>;
  insertAccount(row: AccountInsert): Promise<AccountRow>;
  insertQuotaUsage(row: QuotaUsageInsert): Promise<QuotaUsageRow>;
  insertCrmEvent(row: CrmEventInsert): Promise<CrmEventRow>;
}

export type StoreMode = 'supabase' | 'stub';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function toLeadRow(
  row: LeadInsert,
  extras: { id: string; created_at: string },
): LeadRow {
  return {
    ...row,
    id: extras.id,
    created_at: extras.created_at,
  };
}

export class MemoryVitrineStore implements VitrineStore {
  readonly leads = new Map<string, LeadRow>();
  readonly accounts = new Map<string, AccountRow>();
  readonly quota = new Map<string, QuotaUsageRow>();
  readonly events: CrmEventRow[] = [];

  async insertLead(row: LeadInsert): Promise<LeadRow> {
    const saved = toLeadRow(row, { id: newId(), created_at: nowIso() });
    this.leads.set(saved.id, saved);
    return saved;
  }

  async getLead(id: string): Promise<LeadRow | null> {
    return this.leads.get(id) ?? null;
  }

  async updateLead(id: string, patch: Partial<LeadRow>): Promise<LeadRow> {
    const current = this.leads.get(id);
    if (current === undefined) {
      throw new Error(`lead não encontrado: ${id}`);
    }
    const next: LeadRow = { ...current, ...patch, id };
    this.leads.set(id, next);
    return next;
  }

  async insertAccount(row: AccountInsert): Promise<AccountRow> {
    const saved: AccountRow = { ...row, id: newId(), created_at: nowIso() };
    this.accounts.set(saved.id, saved);
    return saved;
  }

  async insertQuotaUsage(row: QuotaUsageInsert): Promise<QuotaUsageRow> {
    this.quota.set(`${row.account_id}:${row.period_yyyymm}`, row);
    return row;
  }

  async insertCrmEvent(row: CrmEventInsert): Promise<CrmEventRow> {
    const saved: CrmEventRow = { ...row, id: newId(), created_at: nowIso() };
    this.events.push(saved);
    return saved;
  }
}

function fromDbLead(row: {
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
}): LeadRow {
  return {
    nome: row.nome,
    email: row.email,
    cnpj: row.cnpj,
    cnpj_pendente: row.cnpj_pendente,
    volume_mensal: row.volume_mensal as LeadInsert['volume_mensal'],
    perfil: row.perfil as LeadInsert['perfil'],
    lgpd_at: row.lgpd_at,
    origem: 'hotsite',
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    stage: row.stage as LeadInsert['stage'],
    account_id: row.account_id,
    id: row.id,
    created_at: row.created_at,
  };
}

export class SupabaseVitrineStore implements VitrineStore {
  constructor(private readonly client: PersistenciaClient) {}

  async insertLead(row: LeadInsert): Promise<LeadRow> {
    const saved = await insertLead(this.client, {
      nome: row.nome,
      email: row.email,
      cnpj: row.cnpj,
      cnpj_pendente: row.cnpj_pendente,
      volume_mensal: row.volume_mensal,
      perfil: row.perfil,
      lgpd_at: row.lgpd_at,
      origem: row.origem,
      utm_source: row.utm_source,
      utm_medium: row.utm_medium,
      utm_campaign: row.utm_campaign,
      stage: row.stage,
      account_id: row.account_id,
    });
    return fromDbLead(saved);
  }

  async getLead(id: string): Promise<LeadRow | null> {
    const row = await getLead(this.client, id);
    return row === null ? null : fromDbLead(row);
  }

  async updateLead(id: string, patch: Partial<LeadRow>): Promise<LeadRow> {
    const saved = await updateLead(this.client, id, {
      ...(patch.account_id !== undefined ? { account_id: patch.account_id } : {}),
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.cnpj !== undefined ? { cnpj: patch.cnpj } : {}),
      ...(patch.cnpj_pendente !== undefined ? { cnpj_pendente: patch.cnpj_pendente } : {}),
    });
    return fromDbLead(saved);
  }

  async insertAccount(row: AccountInsert): Promise<AccountRow> {
    if (row.owner_user_id === null) {
      throw new Error('accounts.owner_user_id é obrigatório (auth.users)');
    }
    const saved = await insertAccount(this.client, {
      owner_user_id: row.owner_user_id,
      name: row.name,
      plan_code: row.plan_code,
      plan_status: row.plan_status,
      lead_id: row.lead_id,
    });
    return {
      id: saved.id,
      created_at: saved.created_at,
      owner_user_id: saved.owner_user_id,
      name: saved.name,
      plan_code: saved.plan_code as AccountRow['plan_code'],
      plan_status: saved.plan_status as AccountRow['plan_status'],
      lead_id: saved.lead_id ?? row.lead_id,
    };
  }

  async insertQuotaUsage(row: QuotaUsageInsert): Promise<QuotaUsageRow> {
    const saved = await insertQuotaUsageRow(this.client, {
      account_id: row.account_id,
      period_yyyymm: row.period_yyyymm,
      notes_used: row.notes_used,
      notes_quota: row.notes_quota,
    });
    return {
      account_id: saved.account_id,
      period_yyyymm: saved.period_yyyymm,
      notes_used: saved.notes_used,
      notes_quota: saved.notes_quota,
    };
  }

  async insertCrmEvent(row: CrmEventInsert): Promise<CrmEventRow> {
    const saved = await insertCrmEvent(this.client, {
      lead_id: row.lead_id,
      account_id: row.account_id,
      event_type: row.event_type,
      payload: row.payload,
    });
    return {
      id: saved.id,
      created_at: saved.created_at,
      lead_id: saved.lead_id,
      account_id: saved.account_id,
      event_type: saved.event_type as CrmEventRow['event_type'],
      payload: saved.payload,
    };
  }
}

export function createVitrineStore(
  env: NodeJS.ProcessEnv = process.env,
  clientOptions: CreateSupabaseClientOptions = {},
): {
  store: VitrineStore;
  mode: StoreMode;
} {
  const url = readSupabaseUrl(env);
  const key = readSupabaseSecretKey(env);
  if (url && key) {
    const client = createSupabaseClient({
      env,
      fetch: clientOptions.fetch,
    });
    return { store: new SupabaseVitrineStore(client), mode: 'supabase' };
  }
  return { store: new MemoryVitrineStore(), mode: 'stub' };
}
