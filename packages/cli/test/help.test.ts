import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPTIONS, optionsOf } from '../src/options.js';
import { runCli } from './support/run-cli.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('probara --version', () => {
  it('prints the version of the package on stdout', async () => {
    const result = await runCli(['--version']);

    expect(result).toEqual({ exitCode: 0, stdout: `${manifest.version}\n`, stderr: '' });
  });
});

describe('probara --help', () => {
  it('lists the commands on stdout', async () => {
    const result = await runCli(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: probara <command> [options]');
    expect(result.stdout).toMatch(/^ {2}import junit <paths\.\.\.> +Import JUnit XML/m);
  });

  it('is what -h prints too', async () => {
    expect((await runCli(['-h'])).stdout).toBe((await runCli(['--help'])).stdout);
  });

  it('is a usage error (2) without a command, with the help on stderr', async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: probara <command> [options]');
  });

  it('is a usage error (2) on an unknown command, pointing at --help', async () => {
    const top = await runCli(['upload']);
    const nested = await runCli(['import', 'xunit']);

    expect(top.exitCode).toBe(2);
    expect(top.stderr).toContain('[probara] Unknown command "upload". Run "probara --help"');
    expect(nested.exitCode).toBe(2);
    expect(nested.stderr).toContain(
      '[probara] Unknown command "import xunit". Run "probara import --help"',
    );
  });
});

describe('probara import --help', () => {
  it('lists junit', async () => {
    const result = await runCli(['import', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: probara import <format> [options]');
    expect(result.stdout).toMatch(/^ {2}junit <paths\.\.\.> +Import JUnit XML/m);
  });
});

describe('probara import junit --help', () => {
  it('documents every option of the command from the registry, with its variable and default', async () => {
    const result = await runCli(['import', 'junit', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: probara import junit [options] <paths...>');
    const options = optionsOf('import junit');
    expect(options.length).toBeGreaterThan(20);
    for (const option of options) {
      expect(result.stdout).toContain(option.description);
      if (option.env !== undefined) expect(result.stdout).toContain(`env: ${option.env}`);
      if (option.default !== undefined)
        expect(result.stdout).toContain(`default: ${option.default}`);
      if (option.choices !== undefined) {
        expect(result.stdout).toContain(`values: ${option.choices.join(', ')}`);
      }
    }
    expect(result.stdout).toMatch(/^ {2}--project <code> +/m);
    expect(result.stdout).toMatch(/^ {2}--\[no-\]close-run +/m);
    expect(result.stdout).toMatch(/^ {2}--no-source +/m);
    expect(result.stdout).toMatch(/^ {2}--tag <tag> +.*repeatable/m);
    expect(result.stdout).toMatch(/^ {2}-h, --help +/m);
    // The token is documented as a variable only.
    expect(result.stdout).toContain('PROBARA_API_TOKEN');
    expect(result.stdout).not.toMatch(/--token/);
    expect(result.stdout).toContain('Exit codes:');
  });

  it('wins over every other argument', async () => {
    const result = await runCli(['import', 'junit', 'missing.xml', '--frobnicate', '-h']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: probara import junit');
  });
});

describe('the exit codes in the help', () => {
  it('never promises that re-running an import after exit 1 is safe', async () => {
    const help = (await runCli(['import', 'junit', '--help'])).stdout;

    expect(help).not.toMatch(/retrying may help/i);
    expect(help).toMatch(/^ {2}1 +Reporting to Probara failed/m);
    expect(help.replace(/\s+/g, ' ')).toContain(
      'a re-run creates a new run unless --run-ulid is given, and results sent again into the same run are recorded again (each run case keeps the last outcome)',
    );
  });

  it('warns that a failed run create may have created a run', async () => {
    const create = (await runCli(['run', 'create', '--help'])).stdout;
    const close = (await runCli(['run', 'close', '--help'])).stdout;

    for (const help of [create, close]) {
      expect(help).not.toMatch(/retrying may help/i);
      expect(help).not.toContain('--run-ulid is given');
    }
    expect(create.replace(/\s+/g, ' ')).toContain('a failed create may have created a run');
  });
});

describe('the environment in the help', () => {
  it('says that input errors still exit 2 when PROBARA_ENABLED turns reporting off', async () => {
    const importHelp = (await runCli(['import', 'junit', '--help'])).stdout.replace(/\s+/g, ' ');
    const createHelp = (await runCli(['run', 'create', '--help'])).stdout.replace(/\s+/g, ' ');

    expect(importHelp).toContain(
      'PROBARA_ENABLED false turns reporting off: nothing is sent and the exit code is 0, but the files are still read: a missing or invalid file exits 2.',
    );
    expect(createHelp).toContain(
      'PROBARA_ENABLED false turns reporting off: nothing is sent and the exit code is 0, but a usage error still exits 2.',
    );
  });
});

describe('the options registry', () => {
  it('gives each option one unique flag, a description and at least one command', () => {
    const flags = OPTIONS.map((option) => option.name);
    expect(new Set(flags).size).toBe(flags.length);
    for (const option of OPTIONS) {
      expect(option.description).not.toBe('');
      expect(option.commands.length).toBeGreaterThan(0);
    }
  });
});
