export type PublicVitrineConfig = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  turnstileSiteKey: string | null;
  turnstileMode: 'live' | 'stub';
  authMode: 'supabase' | 'stub';
};

function trimOrNull(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
}

/**
 * Só valores públicos. Nunca inclui service role / Turnstile secret.
 */
export function loadPublicConfig(env: NodeJS.ProcessEnv = process.env): PublicVitrineConfig {
  const supabaseUrl = trimOrNull(env['SUPABASE_URL']);
  const supabaseAnonKey = trimOrNull(env['SUPABASE_ANON_KEY']);
  const turnstileSiteKey = trimOrNull(env['TURNSTILE_SITE_KEY']);
  const turnstileSecret = trimOrNull(env['TURNSTILE_SECRET_KEY']);
  return {
    supabaseUrl,
    supabaseAnonKey,
    turnstileSiteKey,
    turnstileMode: turnstileSecret ? 'live' : 'stub',
    authMode: supabaseUrl && supabaseAnonKey ? 'supabase' : 'stub',
  };
}

export function assertNoSecrets(payload: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const serialized = JSON.stringify(payload);
  const secret = env['SUPABASE_SERVICE_ROLE_KEY']?.trim();
  const turnstileSecret = env['TURNSTILE_SECRET_KEY']?.trim();
  if (secret && serialized.includes(secret)) {
    throw new Error('service role vazou para o cliente');
  }
  if (turnstileSecret && serialized.includes(turnstileSecret)) {
    throw new Error('TURNSTILE_SECRET_KEY vazou para o cliente');
  }
  if (serialized.includes('SERVICE_ROLE') || serialized.includes('service_role')) {
    throw new Error('payload público menciona service role');
  }
}
