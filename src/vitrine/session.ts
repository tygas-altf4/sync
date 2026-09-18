import type { IncomingMessage, ServerResponse } from 'node:http';

export const SESSION_COOKIE = 'sync_session';

export function readSessionTokenFromHeader(header: string | undefined | null): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === SESSION_COOKIE) {
      const value = rest.join('=').trim();
      return value === '' ? null : decodeURIComponent(value);
    }
  }
  return null;
}

export function sessionSetCookieValue(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`;
}

export function sessionClearCookieValue(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  return readSessionTokenFromHeader(Array.isArray(header) ? header.join('; ') : header);
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', sessionSetCookieValue(token));
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', sessionClearCookieValue());
}
