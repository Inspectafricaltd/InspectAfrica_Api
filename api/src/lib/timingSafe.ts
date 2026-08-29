import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison. Returns true iff `a` and `b` are equal.
 * Safe to use for secret/API-key/webhook-token comparisons where a length
 * difference is allowed to leak but the contents should not.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
