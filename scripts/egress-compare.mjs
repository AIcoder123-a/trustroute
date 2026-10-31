#!/usr/bin/env node
/**
 * Compare the *egress path* of the clients TrustRoute could plausibly use, so a
 * vendor conversation can be about evidence instead of a guess.
 *
 *   node scripts/egress-compare.mjs
 *
 * Why this exists: the product calls Clocked from Node, and from this machine
 * Node is refused while a browser is not. Two very different explanations fit
 * that observation — a different network path (browser honours the Windows
 * system proxy, Node and `curl --noproxy` do not) or a client-integrity rule at
 * the edge. Guessing between them is what produced an inaccurate support email,
 * so this script measures the four paths separately:
 *
 *   1. Node / undici, no proxy                  (the stack `clocked-sdk` uses)
 *   2. curl, forced direct                      (no proxy, no browser)
 *   3. curl, ambient proxy settings             (what the shell would use)
 *   4. Chromium with its default proxy config   (what a browser would use)
 *   5. Chromium with the proxy disabled         (browser, same network as 1–2)
 *
 * ## No credential, by construction
 *
 * The refusal under investigation happens before authentication, so a request
 * without an `Authorization` header reproduces it exactly. This script never
 * reads `CLOCKED_API_KEY` and never sends an `Authorization` header, which also
 * means nothing here can debit the account: an unauthenticated request that does
 * reach the API is answered with `401`.
 *
 * ## What it does not do
 *
 * No User-Agent spoofing, no `navigator.webdriver` masking, no challenge
 * solving, no proxy reconfiguration. It runs each client as it is configured and
 * writes down what came back. Output goes to `.local/support/` (git-ignored),
 * and is scanned for credentials before it is written.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, release, arch } from 'node:os';

import { chromium } from 'playwright';

const BASE = 'https://clocked.rezolve.ai';
const TARGET = '/clocked/pii';
const OUT_DIR = join(process.cwd(), '.local', 'support');
const ATTEMPTS = 2;
const TIMEOUT_MS = 15_000;
const SAMPLE = JSON.stringify({ text: 'connectivity probe, no real content', anonymize: 'replace' });

function htmlTitle(text) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text ?? '');
  return match ? match[1].replace(/\s+/g, ' ').trim().slice(0, 80) : null;
}

function looksLikeHtml(text) {
  return /^\s*<(!doctype|html)/i.test(text ?? '');
}

function classify(row) {
  if (row.http === null) return row.errorCode ? `transport: ${row.errorCode}` : 'transport: failed';
  if (row.http === 200) return 'reached API';
  if (row.http === 401) return 'reached API (unauthenticated)';
  if (row.http === 403 && row.mitigated === 'challenge') return 'edge challenge';
  if (row.http === 403 && row.html) return 'edge HTML (unlabelled)';
  if (row.http === 403) return 'edge 403 (JSON)';
  return `HTTP ${row.http}`;
}

// ---------------------------------------------------------------- node/undici
async function probeNode() {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}${TARGET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: SAMPLE,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    return {
      client: 'node / undici (direct)',
      http: response.status,
      ms: Date.now() - started,
      server: response.headers.get('server'),
      cfRay: response.headers.get('cf-ray'),
      mitigated: response.headers.get('cf-mitigated'),
      html: looksLikeHtml(text),
      title: htmlTitle(text),
      errorCode: null,
    };
  } catch (error) {
    const cause = error?.cause ?? {};
    return {
      client: 'node / undici (direct)',
      http: null,
      ms: Date.now() - started,
      errorCode: cause.code ?? error?.name ?? 'unknown',
      errorDetail: String(cause.message ?? error?.message ?? '').slice(0, 120) || null,
    };
  }
}

// ---------------------------------------------------------------------- curl
function probeCurl({ direct }) {
  const label = direct ? 'curl (direct, no proxy)' : 'curl (ambient proxy env)';
  const args = ['-s', '--max-time', String(TIMEOUT_MS / 1000), '-o', '-', '-w', '\n%{http_code}|%{remote_ip}|%{time_total}'];
  if (direct) args.unshift('--noproxy', '*');
  args.push(
    '-X',
    'POST',
    `${BASE}${TARGET}`,
    '-H',
    'Content-Type: application/json',
    '-H',
    'Accept: application/json',
    '--data-binary',
    SAMPLE,
  );

  const started = Date.now();
  try {
    const out = execFileSync('curl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 << 20 });
    const index = out.lastIndexOf('\n');
    const bodyText = out.slice(0, index);
    const [http, remoteIp, seconds] = out.slice(index + 1).trim().split('|');
    return {
      client: label,
      http: Number(http),
      remoteIp: remoteIp || null,
      ms: Math.round(Number(seconds) * 1000) || Date.now() - started,
      html: looksLikeHtml(bodyText),
      title: htmlTitle(bodyText),
      errorCode: null,
    };
  } catch (error) {
    return {
      client: label,
      http: null,
      ms: Date.now() - started,
      errorCode: `curl exit ${error?.status ?? '?'}`,
      errorDetail: String(error?.stderr ?? '').trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 120) ?? null,
    };
  }
}

// ------------------------------------------------------------------ chromium
async function probeChromium({ direct }) {
  const label = direct ? 'chromium (proxy disabled)' : 'chromium (default proxy)';
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: direct ? ['--no-proxy-server'] : [] });
  } catch (error) {
    return { client: label, http: null, errorCode: 'launch failed', errorDetail: String(error?.message).slice(0, 120) };
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const navigation = { status: null, title: null, cookiesBefore: [], cookiesAfter: [], challengeShown: null };
  let result;
  try {
    const response = await page.goto(`${BASE}/apis`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    navigation.status = response?.status() ?? null;
    navigation.title = await page.title().catch(() => null);
    navigation.challengeShown = /just a moment|attention required/i.test(navigation.title ?? '');
    navigation.cookiesBefore = (await context.cookies(BASE)).map((cookie) => cookie.name);
    // A managed challenge runs in the page and then reloads. Give it a moment,
    // and record whether the page moved on by itself.
    await page.waitForTimeout(2_500);
    navigation.titleAfter = await page.title().catch(() => null);
    navigation.cookiesAfter = (await context.cookies(BASE)).map((cookie) => cookie.name);

    const observed = await page.evaluate(
      async ([path, payload]) => {
        const startedAt = performance.now();
        const response = await fetch(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: payload,
        });
        const text = await response.text();
        const entry = performance.getEntriesByType('resource').filter((item) => item.name.includes('/clocked/')).pop();
        return {
          http: response.status,
          ms: Math.round(performance.now() - startedAt),
          server: response.headers.get('server'),
          cfRay: response.headers.get('cf-ray'),
          mitigated: response.headers.get('cf-mitigated'),
          html: /^\s*<(!doctype|html)/i.test(text),
          title: text.slice(0, 400).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 80) ?? null,
          httpProtocol: entry?.nextHopProtocol ?? null,
          webdriver: navigator.webdriver,
          userAgent: navigator.userAgent,
        };
      },
      [TARGET, SAMPLE],
    );
    result = { client: label, ...observed, errorCode: null };
  } catch (error) {
    result = {
      client: label,
      http: null,
      errorCode: error?.name === 'TimeoutError' ? 'navigation timeout' : 'failed',
      errorDetail: String(error?.message ?? '').split('\n')[0].slice(0, 120) || null,
    };
  } finally {
    await browser.close();
  }

  return { ...result, navigation };
}

// ---------------------------------------------------------------------- main
const proxyVariables = Object.keys(process.env)
  .filter((name) => /proxy/i.test(name))
  .sort();

const rows = [];
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  for (const run of [probeNode, () => probeCurl({ direct: true }), () => probeCurl({ direct: false })]) {
    rows.push({ attempt, at: new Date().toISOString(), ...(await run()) });
  }
}
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  rows.push({ attempt, at: new Date().toISOString(), ...(await probeChromium({ direct: false })) });
  rows.push({ attempt, at: new Date().toISOString(), ...(await probeChromium({ direct: true })) });
}

const report = {
  schema: 'trustroute.egress-compare/1',
  capturedAt: new Date().toISOString(),
  note: 'No credential was sent and no request header was spoofed. Unauthenticated requests cannot debit the account.',
  environment: {
    os: `${platform()} ${release()} ${arch()}`,
    node: process.versions.node,
    undici: process.versions.undici ?? null,
    proxyVariables,
    chromium: (await chromium.launch({ headless: true }).then(async (browser) => {
      const version = browser.version();
      await browser.close();
      return version;
    }).catch(() => null)),
  },
  target: `${BASE}${TARGET}`,
  rows,
};

const serialised = `${JSON.stringify(report, null, 2)}\n`;
const forbidden = [];
for (const name of Object.keys(process.env)) {
  if (!/(key|token|secret|password)/i.test(name)) continue;
  const value = process.env[name];
  if (typeof value === 'string' && value.length >= 12 && serialised.includes(value)) forbidden.push(name);
}
if (/Bearer\s+[A-Za-z0-9._-]{8,}/.test(serialised)) forbidden.push('a Bearer credential');
if (forbidden.length > 0) {
  console.error(`Refusing to write: output would contain ${forbidden.join(', ')}.`);
  process.exit(3);
}

// ------------------------------------------------------------------ summary
function summarise(client) {
  const subset = rows.filter((row) => row.client === client);
  const reached = subset.filter((row) => typeof row.http === 'number');
  const challenges = subset.filter((row) => row.mitigated === 'challenge');
  const timeouts = subset.filter((row) => row.http === null);
  return { total: subset.length, reached: reached.length, challenges: challenges.length, timeouts: timeouts.length };
}

const clients = Array.from(new Set(rows.map((row) => row.client)));
const summary = clients.map((client) => ({ client, ...summarise(client) }));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'egress-compare.json'), serialised);

const table = rows
  .map(
    (row) =>
      `| ${row.attempt} | ${row.client} | ${row.http ?? '—'} | ${row.httpProtocol ?? '—'} | ${row.remoteIp ?? '—'} | ${
        row.cfRay ?? '—'
      } | ${row.mitigated ?? '—'} | ${row.html ? 'yes' : 'no'} | ${classify(row)} |`,
  )
  .join('\n');

const navigationNotes = rows
  .filter((row) => row.navigation)
  .map(
    (row) =>
      `- **${row.client}** — first navigation \`GET /apis\` → ${
        row.navigation.status ?? 'no response'
      }; title on arrival ${JSON.stringify(row.navigation.title)}; challenge page detected: ${
        row.navigation.challengeShown === null ? 'n/a' : row.navigation.challengeShown ? 'yes' : 'no'
      }; title after 2.5 s ${JSON.stringify(row.navigation.titleAfter)}; cookies before ${JSON.stringify(
        row.navigation.cookiesBefore,
      )}, after ${JSON.stringify(row.navigation.cookiesAfter)}.`,
  )
  .join('\n');

const markdown = `# Egress comparison — Node, curl and Chromium

Captured ${report.capturedAt} from ${report.environment.os}, Node ${report.environment.node}.
Target \`${report.target}\`, \`POST\`, **no credential, no header spoofing, no challenge solving**.
Proxy variables visible to the shell: ${proxyVariables.length > 0 ? proxyVariables.join(', ') : 'none'} (names only).

## What each client did

| # | Client | HTTP | HTTP ver | Remote IP | cf-ray | cf-mitigated | HTML body | Reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${table}

## Summary

| Client | Attempts | Reached the edge | Edge challenge | Transport failure |
| --- | --- | --- | --- | --- |
${summary
  .map((item) => `| ${item.client} | ${item.total} | ${item.reached} | ${item.challenges} | ${item.timeouts} |`)
  .join('\n')}

## What the browser saw before the API call

${navigationNotes || '- n/a'}

---

Raw records: \`egress-compare.json\` (same directory). Chromium version: ${report.environment.chromium ?? 'unknown'}.
`;

writeFileSync(join(OUT_DIR, 'EGRESS.md'), markdown);
console.log(markdown);
console.log(`wrote ${join(OUT_DIR, 'egress-compare.json')}`);
console.log(`wrote ${join(OUT_DIR, 'EGRESS.md')}`);
