/**
 * Turns detection spans into non-overlapping, ordered segments for rendering.
 *
 * Overlap policy: an injection hit outranks a script hit, which outranks
 * high-sensitivity PII, which outranks any other PII finding. That keeps the
 * source view readable and makes the most consequential signal the visible one.
 */

import type { GuardData, InspectData, PiiEntity } from './types';
import { isHighSensitivity } from './redact';

export type HighlightKind = 'plain' | 'pii' | 'pii-high' | 'injection' | 'script';

export interface Segment {
  text: string;
  kind: HighlightKind;
  start: number;
  end: number;
  label?: string;
}

interface Mark {
  start: number;
  end: number;
  kind: HighlightKind;
  priority: number;
  label: string;
}

const PRIORITY: Record<HighlightKind, number> = {
  injection: 4,
  script: 3,
  'pii-high': 2,
  pii: 1,
  plain: 0,
};

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Inspect evidence carries the matched `line` and a `start`/`end` pair. A
 * recorded response shows those offsets are positions in the whole script, not
 * in the line: a hit on the second line comes back as `{ start: 50, end: 85 }`
 * while `line` is only 35 characters long. They are therefore used as document
 * offsets and a span that does not fit is dropped rather than clamped into a
 * plausible-looking but wrong highlight.
 */
export function resolveScriptSpan(text: string, hit: { start: number; end: number }): [number, number] | null {
  if (!Number.isInteger(hit.start) || !Number.isInteger(hit.end)) return null;
  if (hit.start < 0 || hit.end > text.length || hit.start >= hit.end) return null;
  return [hit.start, hit.end];
}

function align(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  if (s > 0 && s < text.length && text.charCodeAt(s) >= 0xdc00 && text.charCodeAt(s) <= 0xdfff && isHighSurrogate(text.charCodeAt(s - 1))) {
    s -= 1;
  }
  if (e > 0 && e < text.length && isHighSurrogate(text.charCodeAt(e - 1)) && text.charCodeAt(e) >= 0xdc00 && text.charCodeAt(e) <= 0xdfff) {
    e += 1;
  }
  return [s, e];
}

export function buildSegments(
  text: string,
  source: { entities: PiiEntity[]; guard: GuardData | null; inspect: InspectData | null },
): Segment[] {
  const marks: Mark[] = [];

  for (const entity of source.entities) {
    if (!Number.isInteger(entity.start) || !Number.isInteger(entity.end)) continue;
    if (entity.start < 0 || entity.end > text.length || entity.start >= entity.end) continue;
    const kind: HighlightKind = isHighSensitivity(entity.type) ? 'pii-high' : 'pii';
    marks.push({
      start: entity.start,
      end: entity.end,
      kind,
      priority: PRIORITY[kind],
      label: entity.type,
    });
  }

  for (const hit of source.guard?.evidence ?? []) {
    if (hit.start < 0 || hit.end > text.length || hit.start >= hit.end) continue;
    marks.push({ start: hit.start, end: hit.end, kind: 'injection', priority: PRIORITY.injection, label: 'injection' });
  }

  for (const hit of source.inspect?.evidence ?? []) {
    const span = resolveScriptSpan(text, hit);
    if (span === null) continue;
    const [start, end] = span;
    marks.push({ start, end, kind: 'script', priority: PRIORITY.script, label: 'script' });
  }

  marks.sort((a, b) => b.priority - a.priority || a.start - b.start || b.end - a.end);

  const accepted: Mark[] = [];
  for (const mark of marks) {
    if (accepted.some((other) => mark.start < other.end && mark.end > other.start)) continue;
    accepted.push(mark);
  }
  accepted.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const mark of accepted) {
    const [start, end] = align(text, mark.start, mark.end);
    if (start < cursor) continue;
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), kind: 'plain', start: cursor, end: start });
    }
    segments.push({ text: text.slice(start, end), kind: mark.kind, start, end, label: mark.label });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), kind: 'plain', start: cursor, end: text.length });
  }

  return segments;
}

export const KIND_CLASS: Record<HighlightKind, string> = {
  plain: '',
  pii: 'bg-[#12332e] text-[#8be6d3] rounded-[3px]',
  'pii-high': 'bg-[#3a2410] text-[#f0c48a] rounded-[3px]',
  injection: 'bg-[#3a1519] text-[#ff9aa0] rounded-[3px]',
  script: 'bg-[#3a2a10] text-[#f2cf8a] rounded-[3px]',
};

export const KIND_LABEL: Record<HighlightKind, string> = {
  plain: 'Plain text',
  pii: 'Personal data',
  'pii-high': 'High-sensitivity data',
  injection: 'Injection evidence',
  script: 'Script risk evidence',
};
