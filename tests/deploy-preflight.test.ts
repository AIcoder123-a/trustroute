/**
 * The pre-deployment audit is an operator tool, so it is tested the way an
 * operator uses it: as a process, with an environment, checking its exit code and
 * what it printed. A pure-function test would not have caught the two mistakes
 * that matter here — a check that never runs, and a credential that gets printed.
 */

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/deploy-preflight.mjs';
/** Clearly synthetic: never a real credential, and never a value a host would accept. */
const FAKE_KEY = 'local-test-key-0123456789';

function run(overrides: Record<string, string>): { code: number; out: string } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(base)) {
    if (/^(CLOCKED_|UPSTASH_|TURNSTILE_|NEXT_PUBLIC_|DAILY_SCREENS|RATE_LIMIT_REQUESTS|TRUST_PROXY|PLATFORM|ALLOW_IN_MEMORY_QUOTA)/.test(name)) {
      delete base[name];
    }
  }

  try {
    const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...base, ...overrides } });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { code: failure.status ?? -1, out: failure.stdout ?? '' };
  }
}

describe('deployment preflight', () => {
  it('passes a bounded live environment and reports the credit arithmetic', () => {
    const result = run({
      CLOCKED_MODE: 'live',
      CLOCKED_API_KEY: FAKE_KEY,
      UPSTASH_REDIS_REST_URL: 'https://redis.example',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
      DAILY_SCREENS: '40',
      RATE_LIMIT_REQUESTS: '10',
      TRUST_PROXY: '1',
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain('READY WITH CAVEATS');
    expect(result.out).toContain('40 screens/day ≈ 480–760 credits');
    // The whole point: the value is described, never printed.
    expect(result.out).not.toContain(FAKE_KEY);
    expect(result.out).toContain(`present (${FAKE_KEY.length} characters, not printed)`);
  });

  /**
   * The two values that decide whether callers can be told apart cannot live in
   * a Netlify config file, because Netlify exposes those to builds only. So a
   * deployment can look configured and read nothing — worth a warning, because
   * the symptom is judges sharing a window they never spent.
   */
  it('warns when a Netlify deployment would never read its own client-IP header', () => {
    const result = run({ CLOCKED_MODE: 'mock', PLATFORM: 'netlify' });
    expect(result.code).toBe(0);
    expect(result.out).toContain('WARN  platform_identity');
    expect(result.out).toContain('folded into 64 buckets');
  });

  it('accepts the Netlify identity path when both values are set', () => {
    const result = run({ CLOCKED_MODE: 'mock', PLATFORM: 'netlify', TRUST_PROXY: '1' });
    expect(result.out).toContain('PASS  platform_identity');
    expect(result.out).toContain('x-nf-client-connection-ip');
  });

  it('refuses a live deployment with no key', () => {
    const result = run({ CLOCKED_MODE: 'live' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('FAIL  mode');
  });

  it('refuses a live deployment whose daily ceiling lives in process memory', () => {
    const result = run({ CLOCKED_MODE: 'live', CLOCKED_API_KEY: FAKE_KEY, DAILY_SCREENS: '40' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('FAIL  quota_store');
  });

  it('accepts the same deployment once the operator accepts the risk explicitly', () => {
    const result = run({
      CLOCKED_MODE: 'live',
      CLOCKED_API_KEY: FAKE_KEY,
      DAILY_SCREENS: '40',
      ALLOW_IN_MEMORY_QUOTA: '1',
    });
    expect(result.code).toBe(0);
    expect(result.out).toContain('WARN  quota_store');
  });

  it('refuses any NEXT_PUBLIC_ variable', () => {
    const result = run({ CLOCKED_MODE: 'mock', NEXT_PUBLIC_CLOCKED_API_KEY: 'oops' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('FAIL  public_env');
  });

  it('refuses a human check that is switched on without a secret', () => {
    const result = run({ CLOCKED_MODE: 'mock', TURNSTILE_ENABLED: 'true' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('FAIL  turnstile');
  });

  it('refuses a key that kept the quotes from a dashboard paste', () => {
    const result = run({ CLOCKED_MODE: 'live', CLOCKED_API_KEY: '"local-test-key"' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('FAIL  key_shape');
  });

  it('lets a simulated deployment through with a warning about the key', () => {
    const result = run({ CLOCKED_MODE: 'mock', CLOCKED_API_KEY: FAKE_KEY });
    expect(result.code).toBe(0);
    expect(result.out).toContain('WARN  credential');
    expect(result.out).toContain('runs simulated');
  });
});
