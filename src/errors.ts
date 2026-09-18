export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';

  constructor(moduleName: string, detail: string) {
    super(`${moduleName}: ${detail}`);
  }
}

export class QuotaDeniedError extends Error {
  override readonly name = 'QuotaDeniedError';
  readonly status = 429;
  readonly code = 'quota.denied' as const;

  constructor(message = 'Cota mensal esgotada (notes_used >= notes_quota)') {
    super(message);
  }
}

export class PersistenciaError extends Error {
  override readonly name = 'PersistenciaError';

  constructor(message: string) {
    super(message);
  }
}
