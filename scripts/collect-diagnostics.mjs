#!/usr/bin/env node
/**
 * Collect the minimum evidence needed to ask the provider why a server-side
 * call is refused, and nothing more.
 *
 *   node scripts/collect-diagnostics.mjs
 *
 * ## Why this sends no credential
 *
 * The refusal we are reporting happens **before authentication**: the edge
 * answers an HTML challenge, so a request with no `Authorization` header is
 * refused in exactly the same way as one with a valid key. Sending the key would
 * add nothing to the report and put a secret in a support thread, so this script
 * never reads `CLOCKED_API_KEY` at all.
 *
 * ## What it records
 *
 * For each probe: timestamp, method, path, HTTP status, HTTP version, remote IP,
 * TLS handshake time, the response headers the edge chose to send (including
 * `cf-ray` and `cf-mitigated`), and the first visible words of the body. Plus the
 * client environment: OS, Node version, the exact User-Agent, and which proxy
 * variables are set (names only, never values).
 *
 * Two client stacks are probed, because the difference between them is the whole
 * point of the report: Node's own `fetch` (what `clocked-sdk` uses) and `curl`.
 *
 * Output goes to `.local/support/` (git-ignored): a JSON file and a Markdown
 * summary you can paste into an email. Before writing, the output is scanned for
 * the live key if one is present in the environment, and the process aborts if it
 * finds it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform, release, arch } from 'node:os';

const BASE = 'https://clocked.rezolve.ai';
const OUT_DIR = join(process.cwd(), '.local', 'support');
const TMP_DIR = join(OUT_DIR, 'tmp');

/** A body small enough that no one can accuse us of probing the model. */
const SAMPLE = { text: 'diagnostic request, no real content', anonymize: 'replace' };

const PROBES = [
  { id: 'pii-post', method: 'POST', path: '/clocked/pii', body: SAMPLE },
  { id: 'injection-post', method: 'POST', path: '/clocked/injection', body: SAMPLE },
  { id: 'root-get', method: 'GET', path: '/' },
  { id: 'apis-get', method: 'GET', path: '/apis' },
];

const HEADER_ALLOWLIST = [
  'content-type',
  'server',
  'cf-ray',
  'cf-mitigated',
  'cf-cache-status',
  'cf-request-id',
  'cache-control',
  'date',
  'vary',
  'alt-svc',
  'location',
  'x-powered-by',
  'retry-after',
  'nel',
  'report-to',
];

function pickHeaders(headers) {
  const out = {};
  for (const [name, value] of headers.entries()) {
    if (HEADER_ALLOWLIST.includes(name.toLowerCase())) out[name.toLowerCase()] = String(value).slice(0, 300);
  }
  return out;
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function title(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].replace(/\s+/g, ' ').trim().slice(0, 120) : null;
}

async function probeWithFetch(probe) {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}${probe.path}`, {
      method: probe.method,
      headers: { Accept: 'application/json', ...(probe.body ? { 'Content-Type': 'application/json' } : {}) },
      body: probe.body ? JSON.stringify(probe.body) : undefined,
      signal: AbortSignal.timeout(25_000),
    });
    const text = await response.text();
    return {
      client: 'node-fetch (undici, same stack as clocked-sdk)',
      http: response.status,
      ms: Date.now() - started,
      headers: pickHeaders(response.headers),
      bodyTitle: title(text),
      bodyStart: visibleText(text),
      bodyLooksLikeHtml: /^\s*<(!doctype|html)/i.test(text),
      error: null,
    };
  } catch (error) {
    const cause = error?.cause ?? {};
    return {
      client: 'node-fetch (undici)',
      http: null,
      ms: Date.now() - started,
      error: String(error?.message ?? error).slice(0, 160),
      errorCode: cause.code ?? cause.errno ?? null,
      errorDetail: String(cause.message ?? '').slice(0, 160) || null,
    };
  }
}

function probeWithCurl(probe, { bypassProxy }) {
  const headerFile = join(TMP_DIR, `${probe.id}.headers`);
  const bodyFile = join(TMP_DIR, `${probe.id}.body`);
  const args = [
    '-s',
    '--max-time',
    '25',
    '-o',
    bodyFile,
    '-D',
    headerFile,
    '-w',
    '%{http_code}|%{http_version}|%{remote_ip}|%{time_appconnect}|%{time_total}',
    '-X',
    probe.method,
    `${BASE}${probe.path}`,
    '-H',
    'Accept: application/json',
    '-H',
    `User-Agent: ${probe.userAgent}`,
  ];
  if (bypassProxy) args.unshift('--noproxy', '*');
  if (probe.body) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(probe.body));

  const started = Date.now();
  try {
    const out = execFileSync('curl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const [http, httpVersion, remoteIp, tlsSeconds, totalSeconds] = out.split('|');
    const rawHeaders = existsSync(headerFile) ? readFileSync(headerFile, 'utf8') : '';
    const body = existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : '';
    const headers = {};
    for (const line of rawHeaders.split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      const name = line.slice(0, colon).trim().toLowerCase();
      if (HEADER_ALLOWLIST.includes(name)) headers[name] = line.slice(colon + 1).trim().slice(0, 300);
    }
    return {
      client: `curl (${bypassProxy ? 'direct, --noproxy' : 'system proxy settings'})`,
      http: Number(http),
      httpVersion: httpVersion || null,
      remoteIp: remoteIp || null,
      tlsHandshakeMs: tlsSeconds ? Math.round(Number(tlsSeconds) * 1000) : null,
      ms: totalSeconds ? Math.round(Number(totalSeconds) * 1000) : Date.now() - started,
      headers,
      bodyTitle: title(body),
      bodyStart: visibleText(body),
      bodyLooksLikeHtml: /^\s*<(!doctype|html)/i.test(body),
      error: null,
    };
  } catch (error) {
    // curl's exit code is the diagnosis: 35 = TLS handshake, 52 = empty reply,
    // 56 = receive failure (connection reset), 28 = timeout.
    const stderr = String(error?.stderr ?? '').trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 200);
    return {
      client: `curl (${bypassProxy ? 'direct, --noproxy' : 'system proxy settings'})`,
      http: null,
      ms: Date.now() - started,
      error: `curl exit ${error?.status ?? 'unknown'}`,
      errorCode: error?.status ? `curl-exit-${error.status}` : null,
      errorDetail: stderr || null,
    };
  }
}

const userAgent = `clocked-js/0.7.0 node/${process.versions.node} ${platform()}`;
const proxyNames = Object.keys(process.env)
  .filter((name) => /proxy/i.test(name))
  .sort();

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

const results = [];
for (const probe of PROBES) {
  const shaped = { ...probe, userAgent };
  results.push({
    probe: `${probe.method} ${probe.path}`,
    at: new Date().toISOString(),
    ...(await probeWithFetch(shaped)),
  });
  // Two transports, because on this machine they behave differently: direct
  // connections time out, the local proxy gets through to the edge and is then
  // challenged. Recording only one of them would misreport the fault.
  results.push({
    probe: `${probe.method} ${probe.path}`,
    at: new Date().toISOString(),
    ...probeWithCurl(shaped, { bypassProxy: true }),
  });
  results.push({
    probe: `${probe.method} ${probe.path}`,
    at: new Date().toISOString(),
    ...probeWithCurl(shaped, { bypassProxy: false }),
  });
}

// The connection from this machine is lossy, so one attempt per probe is not
// evidence — a support engineer needs to know how many attempts reached the edge
// and what every one of those answered. Three extra attempts on the endpoint we
// actually call, with a shorter connect timeout so the run stays quick.
const ATTEMPTS = 3;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const row = probeWithCurl({ method: 'POST', path: '/clocked/pii', body: SAMPLE, userAgent }, { bypassProxy: true });
  results.push({ probe: `POST /clocked/pii (attempt ${attempt + 1})`, at: new Date().toISOString(), ...row });
}

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const report = {
  schema: 'trustroute.support-diagnostics/1',
  capturedAt: new Date().toISOString(),
  note: 'No credential was sent. The refusal under investigation happens before authentication.',
  client: {
    os: `${platform()} ${release()} ${arch()}`,
    node: process.versions.node,
    undici: process.versions.undici ?? null,
    userAgent,
    proxyVariablesPresent: proxyNames.length > 0 ? proxyNames : 'none',
    locationHint: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  results,
};

// ---- Guard: nothing secret may leave this machine in a support thread -------
const serialised = `${JSON.stringify(report, null, 2)}\n`;
const forbidden = [];
const key = process.env.CLOCKED_API_KEY?.trim();
if (key && serialised.includes(key)) forbidden.push('the value of CLOCKED_API_KEY');
for (const name of Object.keys(process.env)) {
  if (!/(key|token|secret|password)/i.test(name)) continue;
  const value = process.env[name];
  if (typeof value === 'string' && value.length >= 12 && serialised.includes(value)) forbidden.push(name);
}
if (/Bearer\s+[A-Za-z0-9._-]{8,}/.test(serialised)) forbidden.push('a Bearer credential');
if (forbidden.length > 0) {
  console.error(`Refusing to write diagnostics: output would contain ${forbidden.join(', ')}.`);
  process.exit(3);
}

writeFileSync(join(OUT_DIR, 'diagnostics.json'), serialised);

const challenged = results.filter((row) => row.http === 403 || row.bodyLooksLikeHtml);
const reachedEdge = results.filter((row) => typeof row.http === 'number');
const transportFailed = results.length - reachedEdge.length;
const rayIds = Array.from(new Set(results.map((row) => row.headers?.['cf-ray']).filter(Boolean)));
const mitigated = Array.from(new Set(results.map((row) => row.headers?.['cf-mitigated']).filter(Boolean)));
const challengedShare =
  reachedEdge.length > 0 ? `${Math.round((challenged.length / reachedEdge.length) * 100)}%` : 'n/a';

const markdown = `# Clocked API — server-side access diagnostics

Captured ${report.capturedAt} from ${report.client.os}, Node ${report.client.node}.
**No credential was sent.** The refusal reproduced here happens before authentication, so a key would
add nothing to the report.

## Client

| | |
| --- | --- |
| OS | ${report.client.os} |
| Node / undici | ${report.client.node} / ${report.client.undici} |
| User-Agent sent | \`${report.client.userAgent}\` |
| Proxy variables present | ${Array.isArray(report.client.proxyVariablesPresent) ? report.client.proxyVariablesPresent.join(', ') : report.client.proxyVariablesPresent} |
| Time zone | ${report.client.locationHint} |

## Results

| Probe | Client | HTTP | HTTP ver | Remote IP | TLS ms | HTML body | cf-mitigated | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${results
  .map(
    (row) =>
      `| \`${row.probe}\` | ${row.client} | ${row.http ?? 'none'} | ${row.httpVersion ?? '—'} | ${
        row.remoteIp ?? '—'
      } | ${row.tlsHandshakeMs ?? '—'} | ${row.bodyLooksLikeHtml ? 'yes' : 'no'} | ${
        row.headers?.['cf-mitigated'] ?? '—'
      } | ${row.errorCode ?? '—'} |`,
  )
  .join('\n')}

${rayIds.length > 0 ? `**cf-ray values:** ${rayIds.map((id) => `\`${id}\``).join(', ')}` : '**cf-ray:** not returned'}

${mitigated.length > 0 ? `**cf-mitigated:** ${mitigated.join(', ')}` : ''}

## Summary

| Measure | Value |
| --- | --- |
| Probes attempted | ${results.length} |
| Reached the edge (any HTTP status) | ${reachedEdge.length} |
| Refused with an HTML challenge | ${challenged.length} (${challengedShare} of those that reached the edge) |
| Failed at the transport layer | ${transportFailed} |
| Distinct \`cf-ray\` values | ${rayIds.length} |

## Body excerpts

${results
  .map(
    (row) =>
      `- \`${row.probe}\` via ${row.client} → ${row.bodyTitle ? `title: ${JSON.stringify(row.bodyTitle)}; ` : ''}${
        row.bodyStart
          ? `text: ${JSON.stringify(row.bodyStart)}`
          : row.error
            ? `${row.error}${row.errorDetail ? ` — ${row.errorDetail}` : ''}`
            : 'empty'
      }`,
  )
  .join('\n')}

## Response headers recorded

${results
  .filter((row) => row.headers && Object.keys(row.headers).length > 0)
  .map((row) => `### ${row.probe} — ${row.client}\n\n\`\`\`\n${JSON.stringify(row.headers, null, 2)}\n\`\`\``)
  .join('\n\n')}

---

Full machine-readable copy: \`diagnostics.json\` (same directory).
`;

writeFileSync(join(OUT_DIR, 'DIAGNOSTICS.md'), markdown);

console.log(markdown);
console.log(`\nwrote ${join(OUT_DIR, 'diagnostics.json')}`);
console.log(`wrote ${join(OUT_DIR, 'DIAGNOSTICS.md')}`);
if (challenged.length > 0) {
  console.log(`\n${challenged.length} of ${results.length} probes were refused with an HTML challenge.`);
}
