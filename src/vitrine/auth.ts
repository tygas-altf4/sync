/**
 * Cadastro/login da Vitrine. Símbolos em inglês; comportamento alinhado ao
 * Supabase Auth. Sem service role aqui — signup/login/MFA usam a anon key.
 * E-mail começa não confirmado; 2FA (TOTP) só depois de `email_confirmed`.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { otpauthUri, randomTotpSecret, TOTP_ISSUER, verifyTotpCode } from './totp.js';

export type AalLevel = 'aal1' | 'aal2';

export type AuthUser = {
  id: string;
  email: string;
  nome: string | null;
  lead_id: string | null;
  email_confirmed: boolean;
  mfa_enrolled: boolean;
  aal: AalLevel;
};

export type AuthSession = {
  access_token: string;
  user: AuthUser;
};

export type AuthFailure = { ok: false; error: string; status: number };
export type AuthSuccess = { ok: true; stub: boolean; session: AuthSession };

export type MfaEnrollSuccess = {
  ok: true;
  stub: boolean;
  factor_id: string;
  secret: string;
  uri: string;
  qr_code: string | null;
};

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
  recoverPassword(email: string): Promise<{ ok: true; stub: boolean } | AuthFailure>;
  resendConfirmation(email: string): Promise<{ ok: true; stub: boolean } | AuthFailure>;
  enrollTotp(accessToken: string): Promise<MfaEnrollSuccess | AuthFailure>;
  verifyTotp(
    accessToken: string,
    input: { code: string; factor_id?: string | null; challenge_id?: string | null },
  ): Promise<AuthSuccess | AuthFailure>;
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

export function mfaRequired(user: AuthUser | null): boolean {
  return user !== null && user.mfa_enrolled && user.aal !== 'aal2';
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

type MemoryUser = {
  id: string;
  email: string;
  nome: string | null;
  lead_id: string | null;
  email_confirmed: boolean;
  password_hash: string;
  totp_secret: string | null;
  totp_factor_id: string | null;
  mfa_verified: boolean;
};

type MemorySession = { email: string; aal: AalLevel };

export class MemoryAuthService implements AuthService {
  readonly mode = 'stub' as const;
  private readonly users = new Map<string, MemoryUser>();
  private readonly sessions = new Map<string, MemorySession>();

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
      totp_secret: null,
      totp_factor_id: null,
      mfa_verified: false,
    };
    this.users.set(email, user);
    return { ok: true, stub: true, session: this.issue(user, 'aal1') };
  }

  async signIn(input: { email: string; password: string }): Promise<AuthSuccess | AuthFailure> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const user = this.users.get(email);
    if (user === undefined || !verifyPassword(password, user.password_hash)) {
      return { ok: false, error: 'E-mail ou senha inválidos.', status: 401 };
    }
    // Senha só chega em aal1. Se o TOTP já está ativo, o UI pede o código.
    return { ok: true, stub: true, session: this.issue(user, 'aal1') };
  }

  async getUser(accessToken: string): Promise<AuthUser | null> {
    const session = this.sessions.get(accessToken);
    if (!session) {
      return null;
    }
    return this.publicUser(this.users.get(session.email), session.aal);
  }

  async confirmEmail(accessToken: string): Promise<AuthSuccess | AuthFailure> {
    const session = this.sessions.get(accessToken);
    const user = session ? this.users.get(session.email) : undefined;
    if (user === undefined) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    user.email_confirmed = true;
    return { ok: true, stub: true, session: this.issue(user, session?.aal ?? 'aal1') };
  }

  async recoverPassword(email: string): Promise<{ ok: true; stub: boolean } | AuthFailure> {
    if (!EMAIL_RE.test(normalizeEmail(email))) {
      return { ok: false, error: 'E-mail inválido.', status: 400 };
    }
    // Stub: não manda SMTP. Resposta igual com ou sem usuário pra não vazar cadastro.
    return { ok: true, stub: true };
  }

  async resendConfirmation(email: string): Promise<{ ok: true; stub: boolean } | AuthFailure> {
    if (!EMAIL_RE.test(normalizeEmail(email))) {
      return { ok: false, error: 'E-mail inválido.', status: 400 };
    }
    return { ok: true, stub: true };
  }

  async enrollTotp(accessToken: string): Promise<MfaEnrollSuccess | AuthFailure> {
    const session = this.sessions.get(accessToken);
    const user = session ? this.users.get(session.email) : undefined;
    if (user === undefined) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    if (!user.email_confirmed) {
      return { ok: false, error: MFA_EMAIL_GATE, status: 403 };
    }
    if (user.mfa_verified) {
      return { ok: false, error: MFA_ALREADY, status: 409 };
    }
    const secret = randomTotpSecret();
    const factor_id = crypto.randomUUID();
    user.totp_secret = secret;
    user.totp_factor_id = factor_id;
    return {
      ok: true,
      stub: true,
      factor_id,
      secret,
      uri: otpauthUri(user.email, secret),
      qr_code: null,
    };
  }

  async verifyTotp(
    accessToken: string,
    input: { code: string; factor_id?: string | null; challenge_id?: string | null },
  ): Promise<AuthSuccess | AuthFailure> {
    const session = this.sessions.get(accessToken);
    const user = session ? this.users.get(session.email) : undefined;
    if (user === undefined) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    if (!user.totp_secret || !user.totp_factor_id) {
      return { ok: false, error: 'Ative o autenticador antes de confirmar o código.', status: 400 };
    }
    if (input.factor_id && input.factor_id !== user.totp_factor_id) {
      return { ok: false, error: MFA_CODE_INVALID, status: 401 };
    }
    if (!verifyTotpCode(user.totp_secret, input.code)) {
      return { ok: false, error: MFA_CODE_INVALID, status: 401 };
    }
    user.mfa_verified = true;
    return { ok: true, stub: true, session: this.issue(user, 'aal2') };
  }

  private issue(user: MemoryUser, aal: AalLevel): AuthSession {
    const access_token = randomBytes(24).toString('hex');
    this.sessions.set(access_token, { email: user.email, aal });
    return { access_token, user: this.publicUser(user, aal)! };
  }

  private publicUser(user: MemoryUser | undefined, aal: AalLevel): AuthUser | null {
    if (user === undefined) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      nome: user.nome,
      lead_id: user.lead_id,
      email_confirmed: user.email_confirmed,
      mfa_enrolled: user.mfa_verified,
      aal,
    };
  }
}

type GoTrueFactor = {
  id: string;
  factor_type?: string;
  type?: string;
  status?: string;
};

type GoTrueUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: { nome?: string; lead_id?: string };
  factors?: GoTrueFactor[];
};

type GoTrueSession = {
  access_token?: string;
  user?: GoTrueUser;
};

type GoTrueEnroll = {
  id?: string;
  totp?: { qr_code?: string; secret?: string; uri?: string };
  error_description?: string;
  msg?: string;
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

  private toUser(raw: GoTrueUser | undefined, aal: AalLevel): AuthUser | null {
    if (!raw?.id) {
      return null;
    }
    return {
      id: raw.id,
      email: raw.email ?? '',
      nome: raw.user_metadata?.nome ?? null,
      lead_id: raw.user_metadata?.lead_id ?? null,
      email_confirmed: Boolean(raw.email_confirmed_at),
      mfa_enrolled: totpFactor(raw)?.status === 'verified',
      aal,
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
    const user = this.toUser(body.user, 'aal1');
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
    const aal = aalFromAccessToken(body.access_token);
    const user = this.toUser(body.user, aal) ?? (await this.getUser(body.access_token));
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
    return this.toUser((await response.json()) as GoTrueUser, aalFromAccessToken(accessToken));
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

  async recoverPassword(email: string): Promise<{ ok: true; stub: boolean } | AuthFailure> {
    const normalized = normalizeEmail(email);
    if (!EMAIL_RE.test(normalized)) {
      return { ok: false, error: 'E-mail inválido.', status: 400 };
    }
    const response = await this.fetchImpl(this.url('/auth/v1/recover'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ email: normalized }),
    });
    if (!response.ok) {
      return { ok: false, error: 'Não deu pra pedir a recuperação agora.', status: response.status };
    }
    return { ok: true, stub: false };
  }

  async resendConfirmation(email: string): Promise<{ ok: true; stub: boolean } | AuthFailure> {
    const normalized = normalizeEmail(email);
    if (!EMAIL_RE.test(normalized)) {
      return { ok: false, error: 'E-mail inválido.', status: 400 };
    }
    const response = await this.fetchImpl(this.url('/auth/v1/resend'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ type: 'signup', email: normalized }),
    });
    if (!response.ok) {
      return { ok: false, error: 'Não deu pra reenviar a confirmação.', status: response.status };
    }
    return { ok: true, stub: false };
  }

  async enrollTotp(accessToken: string): Promise<MfaEnrollSuccess | AuthFailure> {
    const user = await this.getUser(accessToken);
    if (user === null) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    if (!user.email_confirmed) {
      return { ok: false, error: MFA_EMAIL_GATE, status: 403 };
    }
    if (user.mfa_enrolled) {
      return { ok: false, error: MFA_ALREADY, status: 409 };
    }
    const response = await this.fetchImpl(this.url('/auth/v1/factors'), {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify({
        friendly_name: TOTP_ISSUER,
        factor_type: 'totp',
        issuer: TOTP_ISSUER,
      }),
    });
    const body = (await response.json()) as GoTrueEnroll;
    if (!response.ok || !body.id || !body.totp?.secret) {
      return {
        ok: false,
        error: body.error_description ?? body.msg ?? 'Não deu pra iniciar o 2FA.',
        status: response.status >= 400 ? response.status : 502,
      };
    }
    return {
      ok: true,
      stub: false,
      factor_id: body.id,
      secret: body.totp.secret,
      uri: body.totp.uri ?? otpauthUri(user.email, body.totp.secret),
      qr_code: body.totp.qr_code ?? null,
    };
  }

  async verifyTotp(
    accessToken: string,
    input: { code: string; factor_id?: string | null; challenge_id?: string | null },
  ): Promise<AuthSuccess | AuthFailure> {
    if (!accessToken || accessToken.startsWith('pending:')) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    const me = await this.fetchImpl(this.url('/auth/v1/user'), {
      headers: this.headers(accessToken),
    });
    if (!me.ok) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    const raw = (await me.json()) as GoTrueUser;
    const factorId = input.factor_id?.trim() || totpFactor(raw)?.id;
    if (!factorId) {
      return { ok: false, error: 'Ative o autenticador antes de confirmar o código.', status: 400 };
    }
    let challengeId = input.challenge_id?.trim() || '';
    if (challengeId === '') {
      const challenge = await this.fetchImpl(this.url(`/auth/v1/factors/${factorId}/challenge`), {
        method: 'POST',
        headers: this.headers(accessToken),
        body: '{}',
      });
      const challenged = (await challenge.json()) as { id?: string; error_description?: string; msg?: string };
      if (!challenge.ok || !challenged.id) {
        return {
          ok: false,
          error: challenged.error_description ?? challenged.msg ?? 'Não deu pra desafiar o 2FA.',
          status: challenge.status >= 400 ? challenge.status : 502,
        };
      }
      challengeId = challenged.id;
    }
    const response = await this.fetchImpl(this.url(`/auth/v1/factors/${factorId}/verify`), {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify({ challenge_id: challengeId, code: String(input.code ?? '').replace(/\s/g, '') }),
    });
    const body = (await response.json()) as GoTrueSession & { error_description?: string; msg?: string };
    if (!response.ok || !body.access_token) {
      return {
        ok: false,
        error: body.error_description ?? body.msg ?? MFA_CODE_INVALID,
        status: response.status >= 400 ? response.status : 401,
      };
    }
    const aal = aalFromAccessToken(body.access_token);
    const verified = this.toUser(body.user, aal) ?? (await this.getUser(body.access_token));
    if (verified === null) {
      return { ok: false, error: 'Sessão inválida.', status: 401 };
    }
    return { ok: true, stub: false, session: { access_token: body.access_token, user: verified } };
  }
}

function totpFactor(raw: GoTrueUser): GoTrueFactor | undefined {
  const factors = (raw.factors ?? []).filter((factor) => (factor.factor_type ?? factor.type) === 'totp');
  return factors.find((factor) => factor.status === 'verified') ?? factors[0];
}

export function aalFromAccessToken(token: string): AalLevel {
  const payload = token.split('.')[1];
  if (!payload) {
    return 'aal1';
  }
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { aal?: string };
    return json.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
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

export const MFA_EMAIL_GATE = 'Confirme o e-mail antes de ativar o 2FA.';
export const MFA_ALREADY = 'Esta conta já tem 2FA ativo.';
export const MFA_CODE_INVALID = 'Código 2FA inválido.';
export const MFA_CHALLENGE_MESSAGE = 'Digite o código de 6 dígitos do autenticador.';
