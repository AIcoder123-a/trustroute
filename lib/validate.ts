/**
 * Request validation. Everything that reaches the pipeline has passed through
 * here, so no downstream code needs to defend against a missing `text`.
 */

import { CONTENT_TYPES, type ContentType } from './types';
import { LIMITS, maxCharactersFor } from './config';

export interface ValidAnalyzeInput {
  text: string;
  contentType: ContentType;
  instructions: string | null;
  caseId: string | null;
  caseTitle: string | null;
}

export type ValidationResult = { ok: true; value: ValidAnalyzeInput } | { ok: false; message: string };

function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && (CONTENT_TYPES as readonly string[]).includes(value);
}

export function validateAnalyzeInput(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const rawText = record.text;
  if (typeof rawText !== 'string') {
    return { ok: false, message: 'Field "text" is required and must be a string.' };
  }
  if (rawText.includes('\u0000')) {
    return { ok: false, message: 'Field "text" contains a null byte, which is not accepted.' };
  }

  const text = rawText.trim();
  if (text.length === 0) {
    return { ok: false, message: 'Nothing to screen. Add some text or load a demo case.' };
  }

  if (!isContentType(record.contentType)) {
    return {
      ok: false,
      message: `Field "contentType" must be one of: ${CONTENT_TYPES.join(', ')}.`,
    };
  }
  const contentType = record.contentType;

  const limit = maxCharactersFor(contentType);
  if (text.length > limit) {
    return {
      ok: false,
      message: `Content is ${text.length.toLocaleString()} characters; the limit for ${contentType} is ${limit.toLocaleString()}.`,
    };
  }

  let instructions: string | null = null;
  if (record.instructions !== undefined && record.instructions !== null) {
    if (typeof record.instructions !== 'string') {
      return { ok: false, message: 'Field "instructions" must be a string when present.' };
    }
    const trimmed = record.instructions.trim();
    if (trimmed.length > LIMITS.instructionsCharacters) {
      return {
        ok: false,
        message: `Deployment policy is ${trimmed.length.toLocaleString()} characters; the limit is ${LIMITS.instructionsCharacters.toLocaleString()}.`,
      };
    }
    instructions = trimmed.length > 0 ? trimmed : null;
  }

  const caseId = typeof record.caseId === 'string' && record.caseId.length <= 64 ? record.caseId : null;
  const caseTitle = typeof record.caseTitle === 'string' && record.caseTitle.length <= 120 ? record.caseTitle : null;

  return { ok: true, value: { text, contentType, instructions, caseId, caseTitle } };
}
