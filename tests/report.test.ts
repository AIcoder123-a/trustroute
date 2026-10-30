import { describe, expect, it } from 'vitest';

import { findCase } from '@/lib/cases';
import { analyze } from '@/lib/pipeline';
import { buildReport, reportToJson } from '@/lib/report';
import type { ReviewEvent } from '@/lib/types';

async function runPiiCase() {
  const demo = findCase('pii-ticket')!;
  return analyze({
    text: demo.text,
    contentType: demo.contentType,
    instructions: demo.instructions,
    caseId: demo.id,
    caseTitle: demo.title,
  });
}

describe('review report', () => {
  it('contains no raw personal data and no entity values', async () => {
    const result = await runPiiCase();
    const report = buildReport(result, null);
    const json = reportToJson(report);

    expect(json).not.toContain('alex.mercer@example.com');
    expect(json).not.toContain('415 555 0134');
    expect(json).not.toContain('Alex Mercer');
    expect(json).not.toContain('1420 Kestrel Way');

    // The masked copy is safe to include and is included.
    expect(report.protection.maskedText).toContain('<EMAIL>');
    expect(report.protection.maskedText).toContain('<PERSON>');
  });

  it('records where every number came from', async () => {
    const result = await runPiiCase();
    const report = buildReport(result, null);
    expect(report.generator.transport).toBe('mock');
    expect(report.dataSources.join(' ')).toMatch(/no Clocked API was called/i);
    expect(report.disclaimers.join(' ')).toMatch(/must not be presented as evidence/i);
    expect(report.screening).toHaveLength(3);
    expect(report.screening[0]?.endpoint).toBe('POST /injection');
  });

  it('includes a human review event when one exists', async () => {
    const result = await runPiiCase();
    const review: ReviewEvent = {
      id: 'rev_test',
      runId: result.runId,
      action: 'approve',
      note: 'Address change verified out of band',
      decisionBefore: 'REVIEW',
      decisionAfter: 'PASS',
      at: new Date().toISOString(),
      actor: 'demo-reviewer',
    };
    const report = buildReport(result, review);
    expect(report.review?.action).toBe('approve');
    expect(report.review?.decisionAfter).toBe('PASS');
    expect(reportToJson(report)).toContain('Address change verified out of band');
  });

  it('withholds evidence quotes that overlap personal data', async () => {
    const result = await runPiiCase();
    // Force a guard evidence span directly on top of the email address.
    const text = result.redaction.maskedText ?? '';
    expect(text.length).toBeGreaterThan(0);

    const entities = result.stages.protect.data?.entities ?? [];
    const emailEntity = entities.find((entity) => entity.type === 'email');
    expect(emailEntity).toBeDefined();

    if (result.stages.guard.data) {
      result.stages.guard.data.evidence = [
        {
          quote: emailEntity!.value,
          start: emailEntity!.start,
          end: emailEntity!.end,
          confidence: 1,
        },
      ];
    }

    const report = buildReport(result, null);
    const guardRow = report.screening.find((row) => row.endpoint === 'POST /injection');
    expect(guardRow?.evidence[0]?.quote).toMatch(/withheld/);
    expect(reportToJson(report)).not.toContain(emailEntity!.value);
  });

  it('never includes a key-like string from the environment', async () => {
    const result = await runPiiCase();
    const report = buildReport(result, null);
    const json = reportToJson(report);
    expect(json).not.toMatch(/clk_[A-Za-z0-9]/);
    expect(json).not.toMatch(/CLOCKED_API_KEY/);
  });
});
