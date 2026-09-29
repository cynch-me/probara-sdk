import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { createReporter, type ProbaraReporter, type ResultStatus } from '@probara/core';

const STATUS: Record<TestResult['status'], ResultStatus> = {
  passed: 'passed',
  failed: 'failed',
  timedOut: 'failed',
  interrupted: 'blocked',
  skipped: 'skipped',
};

export default class ProbaraPlaywrightReporter implements Reporter {
  private probara: ProbaraReporter | undefined;

  onBegin(): void {
    this.probara = createReporter({ clientName: 'my-playwright-adapter/0.1.0' });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.probara?.addResult({
      identity: {
        file: test.location.file,
        // [root, project, file, ...describes, title] -> [...describes, title]
        titlePath: test.titlePath().slice(3),
        parameters: { project: test.parent.project()?.name ?? '' },
      },
      status: STATUS[result.status],
      durationMs: result.duration,
      startedAt: result.startTime,
      ...(result.error === undefined ? {} : { error: result.error }),
      // Screenshots, traces, videos: uploaded after the result is recorded.
      attachments: result.attachments,
    });
  }

  async onEnd(): Promise<void> {
    const summary = await this.probara?.complete();
    if (summary !== undefined && summary.status !== 'disabled') {
      console.log(`Probara: ${summary.status}, ${summary.recorded} recorded`);
    }
  }
}
