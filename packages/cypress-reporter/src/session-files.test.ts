import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendLine, LINES_FILE, openLines, type SessionLine } from './session-files.js';

function said(value: string): SessionLine {
  return {
    file: 'cypress/e2e/cart.cy.js',
    test: 'Cart adds an item',
    type: 'message',
    message: { type: 'title', value },
  };
}

describe('the lines the helpers said', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'probara-lines-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads every line appended between reads, in the order the plugin wrote them', () => {
    const lines = openLines(dir);
    expect(lines.read()).toEqual([]);

    appendLine(dir, said('one'));
    expect(lines.read()).toEqual([said('one')]);
    appendLine(dir, said('two'));
    appendLine(dir, said('three'));
    expect(lines.read()).toEqual([said('one'), said('two'), said('three')]);
    // A read with nothing new keeps what it read.
    expect(lines.read()).toEqual([said('one'), said('two'), said('three')]);
  });

  it('takes no line until its end is written, even one cut inside a character', () => {
    const lines = openLines(dir);
    appendLine(dir, said('first'));
    const whole = `${JSON.stringify(said('naïve ✓'))}\n`;
    const bytes = Buffer.from(whole, 'utf8');
    // The plugin is writing the next line while the reporter reads: the cut falls inside `✓`.
    const cut = bytes.indexOf(Buffer.from('✓', 'utf8')) + 1;
    appendFileSync(join(dir, LINES_FILE), bytes.subarray(0, cut));

    expect(lines.read()).toEqual([said('first')]);

    appendFileSync(join(dir, LINES_FILE), bytes.subarray(cut));
    expect(lines.read()).toEqual([said('first'), said('naïve ✓')]);
  });

  it('keeps every line of a run that calls the helpers thousands of times, read after each call', () => {
    const lines = openLines(dir);
    const count = 5000;
    for (let index = 0; index < count; index += 1) {
      appendLine(dir, said(String(index)));
      expect(lines.read()).toHaveLength(index + 1);
    }
    const all = lines.read();
    expect(all).toHaveLength(count);
    expect(all[0]).toEqual(said('0'));
    expect(all[count - 1]).toEqual(said(String(count - 1)));
  });

  it('starts over when the session restarted under it', () => {
    const lines = openLines(dir);
    appendLine(dir, said('old run'));
    expect(lines.read()).toHaveLength(1);

    rmSync(join(dir, LINES_FILE));
    expect(lines.read()).toEqual([]);
    appendLine(dir, said('new run'));
    expect(lines.read()).toEqual([said('new run')]);
  });

  it('reads nothing from a run that never opened its directory', () => {
    appendLine('', said('lost'));
    expect(openLines('').read()).toEqual([]);
  });
});
