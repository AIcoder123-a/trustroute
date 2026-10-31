/**
 * The honesty tripwire for the two run modes.
 *
 * A simulated detection is still a useful demo, but it may never be described
 * with the vocabulary of a real API response. These tests pin the property in
 * two places: the strings themselves, and the components that render them (so a
 * future edit cannot reintroduce "Matches Clocked anonymized_text" as a literal
 * in JSX and quietly bypass `lib/copy.ts`).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findCase } from '@/lib/cases';
import { analyze } from '@/lib/pipeline';
import { evaluatePolicy } from '@/lib/policy';
import { buildReport, reportToJson } from '@/lib/report';
import {
  comparisonLabel,
  creditsValue,
  detectionFootnote,
  evidenceBadge,
  evidenceHint,
  headerModeLabel,
  heroSteps,
  runOriginLabel,
  stageBadge,
  thresholdCaption,
} from '@/lib/copy';

/** Phrases that assert Clocked produced something. Illegal in mock copy. */
const CLOCKED_CLAIM = /Matches Clocked|returned by Clocked|Clocked returned|endpoint threshold|Anonymized by Clocked/i;
/** Phrases that make a mock label recognisable as simulated. */
const SIMULATION_MARK = /simulat|no API|no Clocked|not Clocked|nothing compared/i;

/** Labels that name a data source — each one must read as simulated in mock mode. */
function mockSourceLabels(): string[] {
  return [
    runOriginLabel('mock'),
    stageBadge('mock'),
    comparisonLabel('mock', 'match'),
    comparisonLabel('mock', 'differs'),
    comparisonLabel('mock', 'absent'),
    thresholdCaption('mock'),
    detectionFootnote('mock'),
    evidenceHint('mock'),
    evidenceBadge('mock') ?? '',
    creditsValue('mock', 0, false),
    headerModeLabel('mock'),
  ];
}

function mockStrings(): string[] {
  return [...mockSourceLabels(), ...heroSteps('mock').flatMap((step) => [step.title, step.body])];
}

describe('mode-aware copy', () => {
  it('never lets mock copy claim that Clocked produced anything', () => {
    for (const value of mockStrings()) {
      expect(value).not.toMatch(CLOCKED_CLAIM);
    }
  });

  it('marks every mock source label as simulated', () => {
    for (const value of mockSourceLabels()) {
      if (value.length === 0) continue; // evidenceBadge is intentionally absent when live
      expect(value).toMatch(SIMULATION_MARK);
    }
  });

  it('speaks about Clocked only when Clocked ran', () => {
    expect(comparisonLabel('live', 'match')).toBe('Matches Clocked anonymized_text');
    expect(comparisonLabel('live', 'differs')).toMatch(/Differs from Clocked/);
    expect(detectionFootnote('live')).toMatch(/returned by Clocked/);
    expect(thresholdCaption('live')).toBe('endpoint threshold');
    expect(stageBadge('live')).toBe('live');
    expect(evidenceBadge('live')).toBeNull();
    expect(creditsValue('live', 7, true)).toBe('7');
  });

  it('keeps hero step wording consistent with the active mode', () => {
    expect(heroSteps('live')[1]?.title).toMatch(/Clocked/);
    expect(heroSteps('mock')[1]?.title).not.toMatch(/Clocked/);
  });

  it('renders no Clocked claim as a literal in the components', () => {
    const dir = join(process.cwd(), 'components');
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.tsx'))
      .flatMap((name) => {
        const source = readFileSync(join(dir, name), 'utf8');
        return CLOCKED_CLAIM.test(source) ? [name] : [];
      });
    expect(offenders).toEqual([]);
  });
});

describe('policy wording follows the data source', () => {
  const CLAIM = /Clocked (Guard|Protect|Inspect) returned/;

  it('does not attribute a simulated detection to the API', async () => {
    const demo = findCase('injection-classic')!;
    const result = await analyze({
      text: demo.text,
      contentType: demo.contentType,
      instructions: demo.instructions,
      caseId: demo.id,
      caseTitle: demo.title,
    });
    const spoken = result.policy.reasons.map((reason) => `${reason.label}. ${reason.detail}`).join(' ');
    expect(spoken).not.toMatch(CLAIM);
    expect(spoken).toMatch(/local .* simulator/i);
  });

  it('does attribute a live detection to the API', async () => {
    const demo = findCase('injection-classic')!;
    const result = await analyze({
      text: demo.text,
      contentType: demo.contentType,
      instructions: demo.instructions,
      caseId: demo.id,
      caseTitle: demo.title,
    });

    const asLive = {
      ...result.stages.guard,
      mode: 'live' as const,
    };
    const policy = evaluatePolicy({
      contentType: demo.contentType,
      guard: asLive,
      protect: { ...result.stages.protect, mode: 'live' },
      inspect: { ...result.stages.inspect, mode: 'live' },
      redaction: result.redaction,
      thresholds: result.policy.thresholds,
    });
    const spoken = policy.reasons.map((reason) => `${reason.label}. ${reason.detail}`).join(' ');
    expect(spoken).toMatch(CLAIM);
  });
});

describe('report provenance', () => {
  it('does not compare a mock run against a Clocked copy', async () => {
    const demo = findCase('pii-ticket')!;
    const result = await analyze({
      text: demo.text,
      contentType: demo.contentType,
      instructions: demo.instructions,
      caseId: demo.id,
      caseTitle: demo.title,
    });
    expect(result.mode).toBe('mock');

    const report = buildReport(result, null);
    expect(report.protection.comparisonWithClocked).toBe('not_compared_mock');
    expect(report.generator.transport).toBe('mock');
    expect(report.dataSources[0]).toMatch(/MOCK MODE/);

    const json = reportToJson(report);
    expect(json).not.toMatch(CLOCKED_CLAIM);
  });
});
