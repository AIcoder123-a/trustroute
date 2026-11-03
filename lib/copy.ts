/**
 * Mode-aware UI copy.
 *
 * The rule this module exists to enforce: a sentence about "Clocked" may only be
 * shown when Clocked actually answered. In mock mode every detection comes from
 * `lib/clocked/mock.ts`, so calling those numbers "Clocked verdicts", matching
 * them against "Clocked's anonymized_text", or labelling a threshold as the
 * "endpoint threshold" would be a false claim about the API — exactly the kind
 * of claim a security product cannot afford.
 *
 * Keeping the strings here (rather than inline in components) means a test can
 * assert the property once: no mock label names Clocked as the source.
 */

import type { RunMode } from './types';

export type Comparison = 'match' | 'differs' | 'absent';

/** Short label for the data source of a run. */
export function runOriginLabel(mode: RunMode): string {
  return mode === 'live' ? 'Live Clocked API' : 'Simulated · no API call';
}

/** Badge on a stage card. Uppercase by convention in the shell. */
export function stageBadge(mode: RunMode): string {
  return mode === 'live' ? 'live' : 'simulated';
}

/**
 * What the forwarded copy was compared against. Only a live run can be compared
 * with Clocked's own `anonymized_text`.
 */
export function comparisonLabel(mode: RunMode, comparison: Comparison): string {
  if (mode === 'mock') return 'Simulated spans · nothing compared with Clocked';
  if (comparison === 'match') return 'Matches Clocked anonymized_text';
  if (comparison === 'differs') return 'Differs from Clocked — local copy used';
  return 'Built from Protect spans';
}

/** Threshold caption under a probability meter. */
export function thresholdCaption(mode: RunMode): string {
  return mode === 'live' ? 'endpoint threshold' : 'simulator threshold';
}

/** Tooltip for the comparison chip over the forwarded copy. */
export function comparisonTooltip(mode: RunMode): string {
  return mode === 'live'
    ? 'Comparison between the copy built here and the anonymized_text the API returned for the same input.'
    : 'No API request was made, so the masked copy is compared with nothing — the spans come from the local simulator.';
}

/** The sentence under the stage list, asserting where the numbers came from. */
export function detectionFootnote(mode: RunMode): string {
  return mode === 'live'
    ? 'Scores are model estimates returned by Clocked for this exact input. The decision is made by TrustRoute’s rule engine; every comparison it made is in the rule trace.'
    : 'These scores come from TrustRoute’s local Guard simulator, not from Clocked — no API request was made. The decision is still made by the same rule engine that runs in live mode.';
}

/** One line above the evidence list. */
export function evidenceHint(mode: RunMode): string {
  return mode === 'live'
    ? 'Passages returned by Guard and Inspect for this exact input.'
    : 'Passages found by the local simulator for this input — not Clocked output.';
}

/** Header chip on the evidence panel. */
export function evidenceBadge(mode: RunMode): string | null {
  return mode === 'live' ? null : 'SIMULATED';
}

/** The credits cell in the decision panel. */
export function creditsValue(mode: RunMode, total: number, reported: boolean): string {
  if (mode === 'mock') return 'n/a · simulated';
  return reported ? String(total) : 'not reported';
}

export interface HeroStep {
  title: string;
  body: string;
}

/** The three-step explainer on the landing state. */
export function heroSteps(mode: RunMode): HeroStep[] {
  return [
    {
      title: 'Paste untrusted content',
      body: 'A support ticket, a retrieved page, tool output or a script — the things an agent reads without suspicion.',
    },
    {
      title: mode === 'live' ? 'Three Clocked checks run' : 'Three checks run locally',
      body:
        mode === 'live'
          ? 'Guard scores injection, Protect finds personal data, Inspect reads a script without running it.'
          : 'A local simulator stands in for Guard, Protect and Inspect. Every stage is marked SIMULATED.',
    },
    {
      title: 'A policy decides, not the model',
      body: 'PASS, REVIEW or BLOCK from a deterministic server-side engine, with the evidence a human needs.',
    },
  ];
}

/** Label for the mode pill in the header. */
export function headerModeLabel(mode: RunMode): string {
  return mode === 'live' ? 'Live' : 'Simulated';
}

export function headerModeTitle(mode: RunMode): string {
  return mode === 'live'
    ? 'Every detection on this page came from the Clocked API.'
    : 'No Clocked API call is made. Every detection on this page comes from a local simulator.';
}
