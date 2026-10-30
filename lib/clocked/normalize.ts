/**
 * Response normalisation.
 *
 * The Clocked SDK types are used as a reference, but every field is read
 * defensively: a response that does not carry the fields we need is converted
 * into `null` so the stage becomes `invalid` and the policy engine degrades the
 * run. We never coerce a malformed response into "looks safe".
 */

import type { GuardData, InspectData, PiiEntity, ProtectData } from '../types';

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function probabilityMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = num(raw);
    if (parsed !== null) out[key] = parsed;
  }
  return out;
}

function textEvidence(value: unknown): GuardData['evidence'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const quote = str(item.quote);
    const start = num(item.start);
    const end = num(item.end);
    if (quote === null || start === null || end === null) return [];
    return [{ quote, start, end, confidence: num(item.confidence) ?? 0 }];
  });
}

function scriptEvidence(value: unknown): InspectData['evidence'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const line = str(item.line);
    const start = num(item.start);
    const end = num(item.end);
    if (line === null || start === null || end === null) return [];
    return [{ line, start, end, confidence: num(item.confidence) ?? 0 }];
  });
}

/** Guard (`/injection`). Requires `injection` and `verdict` to be usable. */
export function normalizeGuard(raw: unknown): GuardData | null {
  if (!isRecord(raw)) return null;
  const injection = num(raw.injection);
  const verdict = str(raw.verdict);
  if (injection === null || verdict === null) return null;
  if (injection < 0 || injection > 1) return null;

  return {
    model: str(raw.model),
    injection,
    verdict,
    threshold: num(raw.threshold) ?? 0.5,
    category: str(raw.category),
    categories: probabilityMap(raw.categories),
    severity: str(raw.severity),
    severities: probabilityMap(raw.severities),
    severityExpected: num(raw.severity_expected),
    evidence: textEvidence(raw.evidence),
    source: str(raw.source),
    instructionsUsed: str(raw.instructions_used),
  };
}

/** Protect (`/pii`). Requires an entities array and counts object. */
export function normalizeProtect(raw: unknown): ProtectData | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.entities)) return null;

  const entities: PiiEntity[] = raw.entities.flatMap((item) => {
    if (!isRecord(item)) return [];
    const type = str(item.type);
    const value = typeof item.value === 'string' ? item.value : null;
    const start = num(item.start);
    const end = num(item.end);
    if (type === null || value === null || start === null || end === null) return [];
    return [
      {
        type,
        value,
        start: Math.trunc(start),
        end: Math.trunc(end),
        confidence: num(item.confidence) ?? 0,
        source: str(item.source),
      },
    ];
  });

  return {
    model: str(raw.model),
    entities,
    counts: probabilityMap(raw.counts) as Record<string, number>,
    anonymizedText: typeof raw.anonymized_text === 'string' ? raw.anonymized_text : null,
    threshold: num(raw.threshold),
    instructionsUsed: str(raw.instructions_used),
  };
}

/** Inspect (`/script`). Requires `verdict`; at least one score must be numeric. */
export function normalizeInspect(raw: unknown): InspectData | null {
  if (!isRecord(raw)) return null;
  const verdict = str(raw.verdict);
  const malicious = num(raw.malicious);
  const suspicious = num(raw.suspicious);
  if (verdict === null || (malicious === null && suspicious === null)) return null;

  return {
    model: str(raw.model),
    malicious,
    suspicious,
    verdict,
    threshold: num(raw.threshold) ?? 0.5,
    category: str(raw.category),
    categories: probabilityMap(raw.categories),
    severity: str(raw.severity),
    severities: probabilityMap(raw.severities),
    severityExpected: num(raw.severity_expected),
    evidence: scriptEvidence(raw.evidence),
    instructionsUsed: str(raw.instructions_used),
  };
}
