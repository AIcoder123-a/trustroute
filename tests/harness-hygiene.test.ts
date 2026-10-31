/**
 * Tripwires for the two ways this project could leak its own credential:
 * the server-side key reaching a browser context, and the harness handing it to
 * page JavaScript.
 *
 * These are source-level checks, not proofs. They exist so that a future edit
 * that looks harmless — passing one more argument to `page.evaluate`, printing
 * `process.env` in a client component — fails a test instead of shipping.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string, extensions: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      walk(path, extensions, out);
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      out.push(path);
    }
  }
  return out;
}

describe('harness hygiene', () => {
  const harness = readFileSync(join(ROOT, 'scripts', 'live-verify.mjs'), 'utf8');

  it('attaches the credential out of band, before any page evaluation', () => {
    const evaluateAt = harness.indexOf('page.evaluate(');
    expect(evaluateAt).toBeGreaterThan(-1);

    const beforePage = harness.slice(0, evaluateAt);
    expect(beforePage).toContain('page.route(');
    expect(beforePage).toMatch(/authorization: `Bearer \$\{key\}`/);
  });

  it('never mentions the credential inside the code that runs in the page', () => {
    const start = harness.indexOf('page.evaluate(');
    const end = harness.indexOf('\n  );', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const inPage = harness.slice(start, end);
    expect(inPage).not.toMatch(/Bearer/);
    expect(inPage).not.toMatch(/CLOCKED_API_KEY/);
    expect(inPage).not.toMatch(/authorization/i);
    expect(inPage).not.toMatch(/\bkey\b/);
  });

  it('writes no trace, HAR, screenshot or log file', () => {
    expect(harness).not.toMatch(/tracing\.start|context\.tracing|startHar|saveHar|\.screenshot\(/);
    expect(harness).not.toMatch(/writeFileSync\([^)]*diagnostic/i);
  });
});

describe('server/client boundary', () => {
  const clientFiles = [...walk(join(ROOT, 'app'), ['.ts', '.tsx']), ...walk(join(ROOT, 'components'), ['.tsx'])];

  it('no file under app/ or components/ reads the API key from the environment', () => {
    // Mentions are allowed — the mock banner tells the operator which variable to
    // set, and the 503 hint repeats it. A *read* outside lib/ is not.
    const offenders = clientFiles.filter((file) => readFileSync(file, 'utf8').includes('process.env.CLOCKED_API_KEY'));
    expect(offenders).toEqual([]);
  });

  it('the key is read in exactly one server-only module', () => {
    const readers = [...walk(join(ROOT, 'lib'), ['.ts']), ...walk(join(ROOT, 'app'), ['.ts', '.tsx'])]
      .filter((file) => readFileSync(file, 'utf8').includes('process.env.CLOCKED_API_KEY'))
      .map((file) => file.slice(ROOT.length + 1).replace(/\\/g, '/'))
      .sort();
    expect(readers).toEqual(['lib/clocked/live.ts', 'lib/config.ts']);
  });

  it('no file anywhere in the source tree uses a NEXT_PUBLIC_ variable', () => {
    const sources = [
      ...walk(join(ROOT, 'app'), ['.ts', '.tsx']),
      ...walk(join(ROOT, 'components'), ['.tsx', '.ts']),
      ...walk(join(ROOT, 'lib'), ['.ts']),
    ];
    const offenders = sources.filter((file) => readFileSync(file, 'utf8').includes('NEXT_PUBLIC_'));
    expect(offenders).toEqual([]);
  });

  it('every client component that needs server config goes through an API route', () => {
    const clientFilesWithConfigImport = clientFiles.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.startsWith("'use client'") && /from '@\/lib\/config'/.test(source);
    });
    expect(clientFilesWithConfigImport).toEqual([]);
  });
});
