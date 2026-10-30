import { describe, expect, it } from 'vitest';

import { validateAnalyzeInput } from '@/lib/validate';
import { LIMITS } from '@/lib/config';

const base = { text: 'hello world', contentType: 'support_ticket' };

describe('validateAnalyzeInput', () => {
  it('accepts a well-formed request', () => {
    const result = validateAnalyzeInput(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('hello world');
      expect(result.value.contentType).toBe('support_ticket');
      expect(result.value.instructions).toBeNull();
    }
  });

  it('rejects empty and whitespace-only content', () => {
    expect(validateAnalyzeInput({ ...base, text: '' }).ok).toBe(false);
    expect(validateAnalyzeInput({ ...base, text: '   \n\t ' }).ok).toBe(false);
  });

  it('rejects a missing text field', () => {
    const result = validateAnalyzeInput({ contentType: 'support_ticket' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/"text"/);
  });

  it('rejects an unknown content type', () => {
    expect(validateAnalyzeInput({ ...base, contentType: 'email' }).ok).toBe(false);
  });

  it('rejects content over the prose limit', () => {
    const result = validateAnalyzeInput({ ...base, text: 'a'.repeat(LIMITS.proseCharacters + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/limit/);
  });

  it('applies a larger limit to scripts', () => {
    const text = 'a'.repeat(LIMITS.proseCharacters + 10);
    expect(validateAnalyzeInput({ text, contentType: 'script' }).ok).toBe(true);
  });

  it('rejects null bytes', () => {
    expect(validateAnalyzeInput({ ...base, text: 'a\u0000b' }).ok).toBe(false);
  });

  it('caps the deployment policy length', () => {
    const result = validateAnalyzeInput({
      ...base,
      instructions: 'x'.repeat(LIMITS.instructionsCharacters + 1),
    });
    expect(result.ok).toBe(false);
  });

  it('drops an over-long case title instead of failing', () => {
    const result = validateAnalyzeInput({ ...base, caseTitle: 'x'.repeat(500) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.caseTitle).toBeNull();
  });

  it('rejects a non-object body', () => {
    expect(validateAnalyzeInput('nope').ok).toBe(false);
    expect(validateAnalyzeInput(null).ok).toBe(false);
  });
});
