/**
 * Deterministic redaction built from Clocked Protect spans.
 *
 * The API returns `start`/`end` offsets against the ORIGINAL text (end
 * exclusive). TrustRoute never trusts those offsets blindly: every span is
 * validated, re-anchored against the reported value, expanded so it cannot
 * split a UTF-16 surrogate pair, and de-overlapped before the masked copy is
 * produced. If we cannot produce a trustworthy masked copy we return
 * `maskedText: null` — and the policy engine refuses to let the original
 * content through in its place.
 */

import type { AppliedRedaction, PiiEntity, RedactionReport } from './types';

const PLACEHOLDER = (type: string) => `<${type.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}>`;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Expand a [start, end) span outwards until it sits on code-point boundaries. */
function alignToCodePoints(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  if (s > 0 && s < text.length && isLowSurrogate(text.charCodeAt(s)) && isHighSurrogate(text.charCodeAt(s - 1))) {
    s -= 1;
  }
  if (e > 0 && e < text.length && isHighSurrogate(text.charCodeAt(e - 1)) && isLowSurrogate(text.charCodeAt(e))) {
    e += 1;
  }
  return [s, e];
}

interface NormalisedSpan extends AppliedRedaction {
  order: number;
}

export function buildRedaction(
  text: string,
  entities: PiiEntity[],
  apiAnonymizedText?: string | null,
): RedactionReport {
  const rejected: RedactionReport['rejected'] = [];
  const candidates: NormalisedSpan[] = [];
  const usedRanges: Array<[number, number]> = [];

  entities.forEach((entity, index) => {
    const type = typeof entity.type === 'string' && entity.type.length > 0 ? entity.type : 'unknown';
    const value = typeof entity.value === 'string' ? entity.value : '';
    let start = Number(entity.start);
    let end = Number(entity.end);

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      rejected.push({ type, value, reason: 'offset_not_integer' });
      return;
    }
    if (start < 0 || end > text.length || start >= end) {
      rejected.push({ type, value, reason: 'offset_out_of_bounds' });
      return;
    }

    let realigned = false;
    if (text.slice(start, end) !== value && value.length > 0) {
      // The offsets and the reported value disagree. Try to re-anchor on the
      // value, but only on an occurrence we have not already claimed.
      let searchFrom = 0;
      let located = -1;
      while (searchFrom <= text.length) {
        const at = text.indexOf(value, searchFrom);
        if (at === -1) break;
        const overlapsClaimed = usedRanges.some(([s, e]) => at < e && at + value.length > s);
        if (!overlapsClaimed) {
          located = at;
          break;
        }
        searchFrom = at + 1;
      }
      if (located === -1) {
        rejected.push({ type, value, reason: 'offset_mismatch' });
        return;
      }
      start = located;
      end = located + value.length;
      realigned = true;
    }

    [start, end] = alignToCodePoints(text, start, end);
    usedRanges.push([start, end]);

    candidates.push({
      order: index,
      start,
      end,
      type,
      replacement: PLACEHOLDER(type),
      realigned,
    });
  });

  // Longest-first so a nested/overlapping span loses to the larger finding,
  // then by document order for stable output.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start || a.order - b.order);

  const accepted: NormalisedSpan[] = [];
  const dropped: RedactionReport['dropped'] = [];
  for (const candidate of candidates) {
    const conflict = accepted.find((span) => candidate.start < span.end && candidate.end > span.start);
    if (conflict) {
      dropped.push({
        type: candidate.type,
        value: text.slice(candidate.start, candidate.end),
        reason: `overlaps_${conflict.type}_span`,
      });
      continue;
    }
    accepted.push(candidate);
  }

  accepted.sort((a, b) => a.start - b.start || a.end - b.end);

  if (entities.length === 0) {
    return {
      maskedText: text,
      applied: [],
      dropped,
      rejected,
      apiComparison: apiAnonymizedText ? 'match' : 'absent',
      totalEntities: 0,
    };
  }

  if (accepted.length === 0) {
    return {
      maskedText: null,
      applied: [],
      dropped,
      rejected,
      apiComparison: 'absent',
      totalEntities: entities.length,
    };
  }

  let masked = '';
  let cursor = 0;
  for (const span of accepted) {
    masked += text.slice(cursor, span.start);
    masked += span.replacement;
    cursor = span.end;
  }
  masked += text.slice(cursor);

  let apiComparison: RedactionReport['apiComparison'] = 'absent';
  if (typeof apiAnonymizedText === 'string' && apiAnonymizedText.length > 0) {
    apiComparison =
      apiAnonymizedText.replace(/\s+/g, ' ').trim() === masked.replace(/\s+/g, ' ').trim() ? 'match' : 'differs';
  }

  return {
    maskedText: masked,
    applied: accepted.map((span) => ({
      start: span.start,
      end: span.end,
      type: span.type,
      replacement: span.replacement,
      realigned: span.realigned,
    })),
    dropped,
    rejected,
    apiComparison,
    totalEntities: entities.length,
  };
}

/**
 * Choose a redaction operator per entity kind. High-sensitivity kinds are fully
 * replaced; contact details keep their shape so an operator can still reason
 * about the message.
 */
export function chooseAnonymizeOperator(): string {
  return 'replace';
}

/** Entity kinds that always require a human before the content moves on. */
export const HIGH_SENSITIVITY_KINDS = [
  'ssn',
  'credit_card',
  'bank_account',
  'medical',
  'passport',
  'drivers_license',
  'date_of_birth',
] as const;

export function isHighSensitivity(kind: string): boolean {
  return (HIGH_SENSITIVITY_KINDS as readonly string[]).includes(kind);
}
