/**
 * Evidence rows: the passage-level findings behind the two probabilistic
 * verdicts, in the order a reviewer reads them.
 *
 * Guard and Inspect report the same three fields with different meaning for
 * `start`/`end` — Guard's offsets are document positions, Inspect's are too, but
 * they arrive next to a `line` field that invites the opposite reading (see
 * `lib/highlight.ts`). This module resolves both through one path so the panel
 * and the highlight can never disagree about where a finding is.
 */

import type { GuardData, InspectData } from './types';
import { resolveScriptSpan } from './highlight';
import { lineNumberAt, truncate } from './format';

export type EvidenceSource = 'guard' | 'inspect';

export interface EvidenceRow {
  id: string;
  source: EvidenceSource;
  start: number;
  end: number;
  /** 1-based line of the span start, or 0 when the span cannot be placed. */
  line: number;
  /** Category / verdict context shown next to the excerpt. */
  label: string;
  excerpt: string;
  confidence: number | null;
  /** False when the reported offsets do not fit the text. */
  placeable: boolean;
}

const MAX_EXCERPT = 180;

function excerptOf(text: string, start: number, end: number, fallback: string): string {
  const slice = start >= 0 && end <= text.length && start < end ? text.slice(start, end) : fallback;
  return truncate(slice.replace(/\s+/g, ' ').trim(), MAX_EXCERPT);
}

export function buildEvidenceRows(
  text: string,
  source: { guard: GuardData | null; inspect: InspectData | null },
): EvidenceRow[] {
  const rows: EvidenceRow[] = [];

  (source.guard?.evidence ?? []).forEach((hit, index) => {
    const placeable =
      Number.isInteger(hit.start) && Number.isInteger(hit.end) && hit.start >= 0 && hit.end <= text.length && hit.start < hit.end;
    rows.push({
      id: `guard-${hit.start}-${index}`,
      source: 'guard',
      start: hit.start,
      end: hit.end,
      line: placeable ? lineNumberAt(text, hit.start) : 0,
      label: source.guard?.category ?? 'injection evidence',
      excerpt: excerptOf(text, hit.start, hit.end, hit.quote),
      confidence: Number.isFinite(hit.confidence) ? hit.confidence : null,
      placeable,
    });
  });

  (source.inspect?.evidence ?? []).forEach((hit, index) => {
    const span = resolveScriptSpan(text, hit);
    rows.push({
      id: `inspect-${hit.start}-${index}`,
      source: 'inspect',
      start: span ? span[0] : hit.start,
      end: span ? span[1] : hit.end,
      line: span ? lineNumberAt(text, span[0]) : 0,
      label: source.inspect?.category ?? 'script evidence',
      excerpt: excerptOf(text, span ? span[0] : -1, span ? span[1] : -1, hit.line),
      confidence: Number.isFinite(hit.confidence) ? hit.confidence : null,
      placeable: span !== null,
    });
  });

  // Placeable rows first, then document order, then strongest confidence.
  return rows.sort((a, b) => {
    if (a.placeable !== b.placeable) return a.placeable ? -1 : 1;
    if (a.start !== b.start) return a.start - b.start;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}
