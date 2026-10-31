import { describe, expect, it } from 'vitest';

import { MIN_REJECT_NOTE, REVIEW_NOTE_MAX, normalizeNote, noteSatisfiesAction } from '@/lib/review';

describe('review note contract', () => {
  it('accepts an empty note when approving', () => {
    expect(noteSatisfiesAction('approve', null)).toBe(true);
    expect(noteSatisfiesAction('recheck', null)).toBe(true);
  });

  it('requires reasoning to reject', () => {
    expect(noteSatisfiesAction('reject', null)).toBe(false);
    expect(noteSatisfiesAction('reject', '   ')).toBe(false);
    expect(noteSatisfiesAction('reject', 'nope')).toBe(false);
    expect(noteSatisfiesAction('reject', 'customer asked us to stop')).toBe(true);
  });

  it('measures the trimmed note, not the raw one', () => {
    const padded = `${' '.repeat(20)}${'a'.repeat(MIN_REJECT_NOTE)}${' '.repeat(20)}`;
    expect(noteSatisfiesAction('reject', padded.trim())).toBe(true);
  });

  it('treats a blank or non-string note as absent', () => {
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote(42)).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote('  keep the reason  ')).toBe('keep the reason');
  });

  it('caps the note so it cannot become a place to paste the content', () => {
    const long = 'a'.repeat(REVIEW_NOTE_MAX + 200);
    expect(normalizeNote(long)).toHaveLength(REVIEW_NOTE_MAX);
  });
});
