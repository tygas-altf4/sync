import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type AuthUser = {
  id: string;
  email: string;
  nome: string | null;
  lead_id: string | null;
  email_confirmed: boolean;
};

export type AuthSession = {
  access_token: string;
  user: AuthUser;
};

export type AuthFailure = { ok: false; error: string; status: number };
export type AuthSuccess = { ok: true; stub: boolean; session: AuthSession };

export interface AuthService {
  readonly mode: 'supabase' | 'stub';
  signUp(input: {
    email: string;
    password: string;
    nome?: string | null;
    lead_id?: string | null;
  }): Promise<AuthSuccess | AuthFailure>;
  signIn(input: { email: string; password: string }): Promise<AuthSuccess | AuthFailure>;
  getUser(accessToken: string): Promise<AuthUser | null>;
  confirmEmail(accessToken: string): Promise<AuthSuccess | AuthFailure>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 8) {
    return null;
  }
  return value;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) {
    return false;
  }
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

type MemoryUser = AuthUser & { password_hash: string };

export class MemoryAuthService implements AuthService {
  readonly mode = 'stub' as const;
  private readonly users = new Map<string, MemoryUser>();
  private readonly sessions = new Map<string, string>();

  async signUp(input: {
    email: string;
    password: string;
    nome?: string | null;
    lead_id?: string | null;
  }): Promise<AuthSuccess | AuthFailure> {
    const email = normalizeEmail(input.email);
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: 'E-mail inválido.', status: 400 };
    }
    const password = validatePassword(input.password);
    if (password === null) {
      return { ok: false, error: 'Senha precisa ter pelo menos 8 caracteres.', status: 400 };
    }
    if (this.users.has(email)) {
      return { ok: false, error: 'Já existe uma conta com este e-mail.', status: 409 };
    }
    const user: MemoryUser = {
      id: crypto.randomUUID(),
      email,
      nome: input.nome?.trim() || null,
      lead_id: input.lead_id?.trim() || null,
      email_confirmed: false,
      password_hash: hashPassword(password),
    };
    this.users.set(email, user);
    return { ok: true, stub: true, session: this.issue(user) };
  }

  async signIn(input: { email: string; password: string }): Promise<AuthSuccess | AuthFailure> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const user = this.users.get(email);
    if (user === undefined || !verifyPassword(password, user.password_hash)) {
      return { ok: false, error: 'E-mail ou senha inválidos.', status: 401 };
    }
    return { ok: true, stub: true, session: this.issue(user) };
  }

  async getUser(accessToken: string): Promise<AuthUser | null> {
    const email = this.sessions.get(accessToken);
    if (!email) {
      return null;
    }
    return this.publicUser(this.users.get(email));
  }

  async confirmEmail(accessToken: string): Promise<AuthSuccess | AuthFailure> {
    const email = this.sessions.get(accessToken);
    const user = email ? this.users.get(email) : undefined;
    if (user === undefined) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    user.email_confirmed = true;
    return { ok: true, stub: true, session: this.issue(user) };
  }

  private issue(user: MemoryUser): AuthSession {
    const access_token = randomBytes(24).toString('hex');
    this.sessions.set(access_token, user.email);
    return { access_token, user: this.publicUser(user)! };
  }

  private publicUser(user: MemoryUser | undefined): AuthUser | null {
    if (user === undefined) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      nome: user.nome,
      lead_id: user.lead_id,
      email_confirmed: user.email_confirmed,
    };
  }
}

type GoTrueUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: { nome?: string; lead_id?: string };
};

type GoTrueSession = {
  access_token?: string;
  user?: GoTrueUser;
};

export class SupabaseAuthService implements AuthService {
  readonly mode = 'supabase' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly anonKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      apikey: this.anonKey,
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    return headers;
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private toUser(raw: GoTrueUser | undefined): AuthUser | null {
    if (!raw?.id) {
      return null;
    }
    return {
      id: raw.id,
      email: raw.email ?? '',
      nome: raw.user_metadata?.nome ?? null,
      lead_id: raw.user_metadata?.lead_id ?? null,
      email_confirmed: Boolean(raw.email_confirmed_at),
    };
  }

  async signUp(input: {
    email: string;
    password: string;
    nome?: string | null;
    lead_id?: string | null;
  }): Promise<AuthSuccess | AuthFailure> {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    if (!EMAIL_RE.test(email) || password === null) {
      return { ok: false, error: 'E-mail ou senha inválidos.', status: 400 };
    }
    const response = await this.fetchImpl(this.url('/auth/v1/signup'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        email,
        password,
        data: { nome: input.nome ?? null, lead_id: input.lead_id ?? null },
      }),
    });
    const body = (await response.json()) as GoTrueSession & { error_description?: string; msg?: string };
    if (!response.ok) {
      return {
        ok: false,
        error: body.error_description ?? body.msg ?? 'Não deu pra criar a conta.',
        status: response.status,
      };
    }
    const user = this.toUser(body.user);
    if (user === null) {
      return { ok: false, error: 'Resposta de auth incompleta.', status: 502 };
    }
    const access_token = body.access_token ?? `pending:${user.id}`;
    return { ok: true, stub: false, session: { access_token, user } };
  }

  async signIn(input: { email: string; password: string }): Promise<AuthSuccess | AuthFailure> {
    const response = await this.fetchImpl(this.url('/auth/v1/token?grant_type=password'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email: normalizeEmail(input.email), password: input.password }),
    });
    const body = (await response.json()) as GoTrueSession & { error_description?: string };
    if (!response.ok || !body.access_token) {
      return { ok: false, error: body.error_description ?? 'E-mail ou senha inválidos.', status: 401 };
    }
    const user = this.toUser(body.user) ?? (await this.getUser(body.access_token));
    if (user === null) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    return { ok: true, stub: false, session: { access_token: body.access_token, user } };
  }

  async getUser(accessToken: string): Promise<AuthUser | null> {
    if (!accessToken || accessToken.startsWith('pending:')) {
      return null;
    }
    const response = await this.fetchImpl(this.url('/auth/v1/user'), {
      headers: this.headers(accessToken),
    });
    if (!response.ok) {
      return null;
    }
    return this.toUser((await response.json()) as GoTrueUser);
  }

  async confirmEmail(accessToken: string): Promise<AuthSuccess | AuthFailure> {
    if (!accessToken) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    return {
      ok: false,
      error: 'Confirme pelo e-mail do Supabase Auth. Este draft não confirma pelo service role.',
      status: 400,
    };
  }
}

export function createAuthService(env: NodeJS.ProcessEnv = process.env): AuthService {
  const url = env['SUPABASE_URL']?.trim();
  const anon = env['SUPABASE_ANON_KEY']?.trim();
  if (url && anon) {
    return new SupabaseAuthService(url, anon);
  }
  return new MemoryAuthService();
}

export const ONBOARDING_VERIFY_MESSAGE =
  'Confirme o e-mail antes do onboarding. Sem verificação a conta free não é liberada.';
