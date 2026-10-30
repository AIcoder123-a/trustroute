import { describe, expect, it } from 'vitest';

import { DEMO_CASES } from '@/lib/cases';
import { analyze } from '@/lib/pipeline';
import { listAudit } from '@/lib/audit';

describe('demo cases through the mock pipeline', () => {
  it('has at least six cases with unique ids', () => {
    expect(DEMO_CASES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(DEMO_CASES.map((item) => item.id)).size).toBe(DEMO_CASES.length);
  });

  for (const demo of DEMO_CASES) {
    it(`"${demo.id}" produces the decision it was written to demonstrate`, async () => {
      const result = await analyze({
        text: demo.text,
        contentType: demo.contentType,
        instructions: demo.instructions,
        caseId: demo.id,
        caseTitle: demo.title,
      });

      expect(result.mode).toBe('mock');

      const expected = demo.expectation === 'pass' ? 'PASS' : demo.expectation === 'review' ? 'REVIEW' : 'BLOCK';
      expect(result.policy.decision, `${demo.id} decision`).toBe(expected);

      // Every stage must have completed in mock mode.
      expect(result.stages.guard.status).toBe('ok');
      expect(result.stages.protect.status).toBe('ok');

      // A pass never carries un-masked personal data forward silently.
      const entities = result.stages.protect.data?.entities.length ?? 0;
      if (entities > 0) {
        expect(result.redaction.maskedText).not.toBeNull();
        expect(result.redaction.maskedText).not.toBe(demo.text);
        for (const entity of result.stages.protect.data?.entities ?? []) {
          expect(result.redaction.maskedText).not.toContain(entity.value);
        }
      }

      // Script content must be inspected, prose must not be.
      if (demo.contentType === 'script') {
        expect(result.stages.inspect.status).toBe('ok');
      } else {
        expect(result.stages.inspect.status).toBe('skipped');
      }
    });
  }

  it('does not persist raw content in the audit trail', async () => {
    const demo = DEMO_CASES[1]!;
    const result = await analyze({
      text: demo.text,
      contentType: demo.contentType,
      instructions: null,
      caseId: demo.id,
      caseTitle: demo.title,
    });

    const record = listAudit().find((item) => item.runId === result.runId);
    expect(record).toBeDefined();
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain('alex.mercer@example.com');
    expect(serialised).not.toContain('Alex Mercer');
    expect(record?.textHash).toHaveLength(32);
  });

  it('flags mock mode so no caller can mistake it for live output', async () => {
    const result = await analyze({
      text: 'Routine message with no findings.',
      contentType: 'support_ticket',
      instructions: null,
      caseId: null,
      caseTitle: null,
    });
    expect(result.mode).toBe('mock');
    expect(result.stages.guard.mode).toBe('mock');
    expect(result.warnings.join(' ')).toMatch(/Mock mode is active/);
    expect(result.stages.guard.data?.model).toMatch(/not Clocked/i);
  });
});
