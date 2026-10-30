import { describe, expect, it } from 'vitest';

import { buildRedaction } from '@/lib/redact';
import type { PiiEntity } from '@/lib/types';

function entity(partial: Partial<PiiEntity> & Pick<PiiEntity, 'type' | 'value' | 'start' | 'end'>): PiiEntity {
  return { confidence: 1, source: 'model', ...partial };
}

const TEXT = 'Contact Alex Mercer at alex.mercer@example.com about order 88123.';

describe('buildRedaction', () => {
  it('replaces every entity with a typed placeholder', () => {
    const name = TEXT.indexOf('Alex Mercer');
    const email = TEXT.indexOf('alex.mercer@example.com');
    const report = buildRedaction(TEXT, [
      entity({ type: 'person', value: 'Alex Mercer', start: name, end: name + 11 }),
      entity({ type: 'email', value: 'alex.mercer@example.com', start: email, end: email + 22 }),
    ]);

    expect(report.maskedText).toBe('Contact <PERSON> at <EMAIL> about order 88123.');
    expect(report.applied).toHaveLength(2);
    expect(report.rejected).toHaveLength(0);
    expect(report.dropped).toHaveLength(0);
  });

  it('returns null rather than the original when every span is unusable', () => {
    const report = buildRedaction(TEXT, [entity({ type: 'phone', value: 'nope', start: 9999, end: 10005 })]);
    expect(report.maskedText).toBeNull();
    expect(report.rejected[0]?.reason).toBe('offset_out_of_bounds');
  });

  it('rejects spans that are inverted or empty', () => {
    const report = buildRedaction(TEXT, [
      entity({ type: 'person', value: 'x', start: 10, end: 10 }),
      entity({ type: 'person', value: 'y', start: 20, end: 12 }),
    ]);
    expect(report.maskedText).toBeNull();
    expect(report.rejected.map((item) => item.reason)).toEqual(['offset_out_of_bounds', 'offset_out_of_bounds']);
  });

  it('re-anchors a span whose offsets do not match its value', () => {
    const email = TEXT.indexOf('alex.mercer@example.com');
    const report = buildRedaction(TEXT, [
      entity({ type: 'email', value: 'alex.mercer@example.com', start: 3, end: 25 }),
    ]);
    expect(report.applied[0]?.realigned).toBe(true);
    expect(report.applied[0]?.start).toBe(email);
    expect(report.maskedText).toBe('Contact Alex Mercer at <EMAIL> about order 88123.');
  });

  it('drops the shorter of two overlapping spans instead of corrupting the copy', () => {
    const name = TEXT.indexOf('Alex Mercer');
    const report = buildRedaction(TEXT, [
      entity({ type: 'person', value: 'Alex', start: name, end: name + 4 }),
      entity({ type: 'person', value: 'Alex Mercer', start: name, end: name + 11 }),
    ]);
    expect(report.applied).toHaveLength(1);
    expect(report.applied[0]?.end).toBe(name + 11);
    expect(report.dropped).toHaveLength(1);
    expect(report.maskedText).not.toContain('Mercer');
  });

  it('never splits a surrogate pair', () => {
    const text = 'A👩B';
    const report = buildRedaction(text, [
      // A span that starts on the low surrogate of the emoji and would cut it in half.
      entity({ type: 'person', value: text.slice(2, 3), start: 2, end: 3 }),
      // A second, independent finding that must survive untouched.
      entity({ type: 'phone', value: 'B', start: 3, end: 4 }),
    ]);

    expect(report.maskedText).toBe('A<PERSON><PHONE>');
    expect(report.applied[0]?.start).toBe(1);
    expect(report.maskedText).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(report.maskedText).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('reports a match against the API copy', () => {
    const name = TEXT.indexOf('Alex Mercer');
    const entities = [entity({ type: 'person', value: 'Alex Mercer', start: name, end: name + 11 })];
    expect(buildRedaction(TEXT, entities, 'Contact <PERSON> at alex.mercer@example.com about order 88123.').apiComparison).toBe(
      'match',
    );
    expect(buildRedaction(TEXT, entities, '<PERSON>').apiComparison).toBe('differs');
    expect(buildRedaction(TEXT, entities).apiComparison).toBe('absent');
  });
});
