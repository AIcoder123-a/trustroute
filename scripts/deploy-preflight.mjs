#!/usr/bin/env node
/**
 * Pre-deployment audit of the environment a host will run with.
 *
 *   node scripts/deploy-preflight.mjs           # or: npm run deploy:preflight
 *
 * It answers one question: if this exact environment is what the host starts,
 * can it spend money it should not, or leak the credential? It reads nothing but
 * `process.env`, sends no request, and prints no value — only presence, length
 * and shape.
 *
 * What it cannot answer: whether the host's egress reaches Clocked at all. That
 * is a runtime fact and only a real call from that egress establishes it; see
 * docs/RENDER.md §7.
 *
 * Exit codes: 0 ready (warnings allowed) · 1 not ready (at least one check failed).
 */

const env = process.env;

const mode = (env.CLOCKED_MODE ?? 'auto').trim().toLowerCase();
const key = (env.CLOCKED_API_KEY ?? '').trim();
const hasKey = key.length > 0;
const quotaStore = (env.UPSTASH_REDIS_REST_URL ?? '').trim() && (env.UPSTASH_REDIS_REST_TOKEN ?? '').trim()
  ? 'redis'
  : 'memory';
const dailyRaw = Number(env.DAILY_SCREENS);
const windowRaw = Number(env.RATE_LIMIT_REQUESTS);
const turnstileEnabled = (env.TURNSTILE_ENABLED ?? '').trim().toLowerCase() === 'true';
const hasTurnstileSecret = (env.TURNSTILE_SECRET ?? '').trim().length > 0;
const trustProxy = (env.TRUST_PROXY ?? '').trim() === '1';
const allowInMemoryQuota = (env.ALLOW_IN_MEMORY_QUOTA ?? '').trim() === '1';
const publicVars = Object.keys(env).filter((name) => name.startsWith('NEXT_PUBLIC_'));

/** Mirrors `resolveRunMode()` in lib/config.ts, without importing it. */
function resolveMode() {
  if (mode === 'mock') return 'mock';
  if (mode === 'live') return hasKey ? 'live' : 'invalid';
  if (mode === 'auto' || mode === '') return hasKey ? 'live' : 'mock';
  return 'invalid';
}

const running = resolveMode();
const dailyScreens = Number.isFinite(dailyRaw) && dailyRaw > 0 ? Math.trunc(dailyRaw) : running === 'live' ? 60 : 240;
const requestsPerWindow = Number.isFinite(windowRaw) && windowRaw > 0 ? Math.trunc(windowRaw) : 20;
const turnstile = !turnstileEnabled ? 'off' : hasTurnstileSecret ? 'required' : 'misconfigured';

const checks = [];
const check = (id, status, detail) => checks.push({ id, status, detail });

if (running === 'invalid') {
  check('mode', 'fail', `CLOCKED_MODE is "${mode}" but no key is set — the server would refuse to start in live mode.`);
}

check(
  'public_env',
  publicVars.length === 0 ? 'pass' : 'fail',
  publicVars.length === 0
    ? 'no NEXT_PUBLIC_* variable is set, so nothing is inlined into the browser bundle'
    : `NEXT_PUBLIC_* variables are inlined into the client bundle and readable by anyone: ${publicVars.join(', ')}`,
);

check(
  'credential',
  running === 'live' && hasKey ? 'pass' : running === 'live' ? 'fail' : hasKey ? 'warn' : 'pass',
  running === 'live'
    ? hasKey
      ? `key present (${key.length} characters) and read from the environment only`
      : 'CLOCKED_MODE=live without CLOCKED_API_KEY'
    : hasKey
      ? 'a key is set on a deployment that runs simulated — exposure with no benefit, remove it'
      : 'simulated deployment, no credential needed',
);

// A key pasted into a dashboard field often keeps a quote or a newline.
const keyShape =
  !hasKey ? 'none'
  : /^["']|["']$/.test(key) ? 'quoted'
  : /\s/.test(key) ? 'whitespace'
  : key.length < 20 ? 'short'
  : 'ok';
check(
  'key_shape',
  keyShape === 'ok' || keyShape === 'none' ? 'pass' : keyShape === 'short' ? 'warn' : 'fail',
  keyShape === 'ok'
    ? 'no quotes and no whitespace'
    : keyShape === 'none'
      ? 'not applicable'
      : `the value is ${keyShape} — trim it in the host's environment panel, or every call fails as unauthorised`,
);

check(
  'daily_ceiling',
  running === 'live' ? (dailyScreens > 60 ? 'fail' : dailyScreens > 40 ? 'warn' : 'pass') : dailyScreens > 240 ? 'warn' : 'pass',
  `${dailyScreens} screens/day${running === 'live' ? ` ≈ ${dailyScreens * 12}–${dailyScreens * 19} credits` : ' (simulated: 0 credits)'}`,
);

check(
  'quota_store',
  quotaStore === 'redis' ? 'pass' : running === 'live' ? (allowInMemoryQuota ? 'warn' : 'fail') : 'pass',
  quotaStore === 'redis'
    ? 'shared counter: exact across instances and across restarts'
    : running === 'live'
      ? allowInMemoryQuota
        ? 'in-process counter: every cold start resets the day, so the ceiling is not a ceiling'
        : 'in-process counter on a live deployment — set UPSTASH_REDIS_REST_URL/TOKEN, or accept it with ALLOW_IN_MEMORY_QUOTA=1'
      : 'in-process counter, acceptable because a simulated screen costs nothing',
);

check(
  'turnstile',
  turnstile === 'required' ? 'pass' : turnstile === 'misconfigured' ? 'fail' : running === 'live' ? 'warn' : 'pass',
  turnstile === 'required'
    ? 'human-check enforced before any credit is spent'
    : turnstile === 'misconfigured'
      ? 'TURNSTILE_ENABLED=true without TURNSTILE_SECRET: every screening would be refused'
      : running === 'live'
        ? 'no human-check gate; the daily ceiling is the only thing between a script and the balance'
        : 'off, and the deployment is simulated',
);

check(
  'trust_proxy',
  trustProxy || running !== 'live' ? 'pass' : 'warn',
  trustProxy
    ? 'x-forwarded-for is believed — correct only behind the host edge that rewrites it'
    : 'x-forwarded-for is ignored, so callers are folded into 64 buckets and the per-caller window is coarse',
);

check(
  'window_vs_daily',
  requestsPerWindow <= dailyScreens ? 'pass' : 'warn',
  `${requestsPerWindow} requests per 5 minutes per caller against ${dailyScreens} a day`,
);

const passed = checks.filter((item) => item.status === 'pass').length;
const warned = checks.filter((item) => item.status === 'warn').length;
const failed = checks.filter((item) => item.status === 'fail').length;

const label = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
console.log('TrustRoute deployment preflight — reads process.env, sends nothing, prints no secret.\n');
console.log(`mode            ${running === 'invalid' ? 'invalid' : running}`);
console.log(`credential      ${hasKey ? `present (${key.length} characters, not printed)` : 'absent'}`);
console.log(`daily ceiling   ${dailyScreens} screens · ${quotaStore === 'redis' ? 'shared counter' : 'in-process counter'}`);
console.log(`human check     ${turnstile}`);
console.log(`public env      ${publicVars.length === 0 ? 'none' : publicVars.join(', ')}`);
console.log('');

for (const item of [...checks].sort((a, b) => a.status.localeCompare(b.status))) {
  console.log(`${label[item.status]}  ${item.id.padEnd(16)} ${item.detail}`);
}

console.log('');
console.log(`${passed} passed · ${warned} warnings · ${failed} failed`);
console.log(
  failed > 0
    ? 'verdict: NOT READY — fix the failures above before publishing this deployment.'
    : warned > 0
      ? 'verdict: READY WITH CAVEATS — the warnings are the deployment you are choosing.'
      : 'verdict: READY — as far as the environment can be checked from here.',
);
console.log('Not checked here: whether this host reaches the Clocked API. Only a real call from its own egress answers that.');

process.exit(failed > 0 ? 1 : 0);
