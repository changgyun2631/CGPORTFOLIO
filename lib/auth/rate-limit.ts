type Entry = { failures: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const attempts = new Map<string, Entry>();

export function loginAttemptAllowed(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.delete(key);
    return true;
  }
  return entry.failures < MAX_FAILURES;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  current.failures += 1;
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}

export function loginRetryAfterSeconds(key: string, now = Date.now()): number {
  const entry = attempts.get(key);
  return entry ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 1;
}
