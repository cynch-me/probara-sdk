#!/usr/bin/env node
/** The `probara` bin. It sets the exit code and lets Node exit once stdout and stderr drained. */
import { createInterface } from 'node:readline/promises';
import { main } from './main.js';

/** Asks on the terminal, the question on stderr so stdout keeps only machine output. */
async function prompt(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  ...(process.stdin.isTTY ? { prompt } : {}),
});
