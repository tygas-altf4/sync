import { loadConfig } from '../config/ambientes.js';
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

export class MemoryVitrineStore implements VitrineStore {
  readonly leads = new Map<string, LeadRow>();
  readonly accounts = new Map<string, AccountRow>();
  readonly quota = new Map<string, QuotaUsageRow>();
  readonly events: CrmEventRow[] = [];

  async insertLead(row: LeadInsert): Promise<LeadRow> {
    const stamped = nowIso();
    const saved: LeadRow = {
      ...row,
      id: newId(),
      created_at: stamped,
      updated_at: stamped,
      upgrade_handoff_at: null,
    };
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
    const next: LeadRow = { ...current, ...patch, id, updated_at: nowIso() };
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

function restHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

export class SupabaseVitrineStore implements VitrineStore {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/rest/v1/${path}`;
  }

  private async post<T>(table: string, body: unknown): Promise<T> {
    const response = await fetch(this.url(table), {
      method: 'POST',
      headers: restHeaders(this.serviceRoleKey),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`supabase ${table} ${response.status}: ${detail.slice(0, 400)}`);
    }
    const rows = (await response.json()) as T[];
    const first = rows[0];
    if (first === undefined) {
      throw new Error(`supabase ${table}: resposta vazia`);
    }
    return first;
  }

  async insertLead(row: LeadInsert): Promise<LeadRow> {
    return this.post<LeadRow>('leads', row);
  }

  async getLead(id: string): Promise<LeadRow | null> {
    const response = await fetch(this.url(`leads?id=eq.${encodeURIComponent(id)}&select=*`), {
      headers: restHeaders(this.serviceRoleKey),
    });
    if (!response.ok) {
      throw new Error(`supabase leads get ${response.status}`);
    }
    const rows = (await response.json()) as LeadRow[];
    return rows[0] ?? null;
  }

  async updateLead(id: string, patch: Partial<LeadRow>): Promise<LeadRow> {
    const response = await fetch(this.url(`leads?id=eq.${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: restHeaders(this.serviceRoleKey),
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`supabase leads patch ${response.status}: ${detail.slice(0, 400)}`);
    }
    const rows = (await response.json()) as LeadRow[];
    const first = rows[0];
    if (first === undefined) {
      throw new Error('supabase leads patch: resposta vazia');
    }
    return first;
  }

  async insertAccount(row: AccountInsert): Promise<AccountRow> {
    return this.post<AccountRow>('accounts', row);
  }

  async insertQuotaUsage(row: QuotaUsageInsert): Promise<QuotaUsageRow> {
    return this.post<QuotaUsageRow>('quota_usage', row);
  }

  async insertCrmEvent(row: CrmEventInsert): Promise<CrmEventRow> {
    return this.post<CrmEventRow>('crm_events', row);
  }
}

export function createVitrineStore(env: NodeJS.ProcessEnv = process.env): {
  store: VitrineStore;
  mode: StoreMode;
} {
  const config = loadConfig(env);
  const url = config.supabaseUrl?.trim();
  const key = config.supabaseServiceRoleKey?.trim();
  if (url && key) {
    return { store: new SupabaseVitrineStore(url, key), mode: 'supabase' };
  }
  return { store: new MemoryVitrineStore(), mode: 'stub' };
}
