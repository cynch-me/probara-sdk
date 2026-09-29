#!/usr/bin/env node
/** The `probara` bin. It sets the exit code and lets Node exit once stdout and stderr drained. */
import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
});
