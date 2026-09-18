export type RetryReason = '429' | '5xx' | 'timeout';

export type PendingReplay = {
  id: string;
  account_id: string;
  dps_id: string;
  reason: RetryReason;
  retry_after?: Date;
  created_at: Date;
};

/**
 * RetryStore + Replay: 429 (Retry-After), 5xx, timeout.
 *
 * Depois do POST `/nfse` incerto: `HEAD`/`GET /dps/{id}` para evitar
 * reemissão (segunda autorização). Stub em memória — sem cron neste scaffold.
 */
export class RetryStore {
  private readonly pending = new Map<string, PendingReplay>();

  enqueue(entry: Omit<PendingReplay, 'id' | 'created_at'> & { id?: string }): PendingReplay {
    const row: PendingReplay = {
      id: entry.id ?? crypto.randomUUID(),
      account_id: entry.account_id,
      dps_id: entry.dps_id,
      reason: entry.reason,
      created_at: new Date(),
      ...(entry.retry_after !== undefined ? { retry_after: entry.retry_after } : {}),
    };
    this.pending.set(row.id, row);
    return row;
  }

  listPending(): PendingReplay[] {
    return [...this.pending.values()];
  }

  dequeue(id: string): PendingReplay | undefined {
    const row = this.pending.get(id);
    this.pending.delete(id);
    return row;
  }
}
