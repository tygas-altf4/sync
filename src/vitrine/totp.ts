/**
 * TOTP (RFC 6238) do stub de Auth. Live usa o MFA do GoTrue/Supabase.
 * SHA-1, 6 dígitos, passo 30s — o mesmo perfil do autenticador comum.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SEC = 30;
const DIGITS = 6;

export const TOTP_ISSUER = 'Plvria Sync';

export function randomTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(email: string, secret: string, issuer = TOTP_ISSUER): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(Math.floor(atMs / 1000) / STEP_SEC);
  return hotp(secret, counter);
}

/** Aceita o passo atual ±1 (relógio do celular). */
export function verifyTotpCode(secret: string, code: string, atMs = Date.now()): boolean {
  const trimmed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(trimmed)) {
    return false;
  }
  const expected = Buffer.from(trimmed, 'utf8');
  for (const skew of [-1, 0, 1]) {
    const candidate = Buffer.from(totpCode(secret, atMs + skew * STEP_SEC * 1000), 'utf8');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = 10 ** DIGITS;
  return String(bin % mod).padStart(DIGITS, '0');
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
