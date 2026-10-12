import { describe, expect, it } from 'vitest';
import { registerProject, type ProjectLike, type RegistrationOptions } from './register.js';

const OPTIONS: RegistrationOptions = {
  setup: '/reporter/dist/setup.js',
  runner: '/reporter/dist/runner.js',
  canImportTypeScript: false,
};

/** A project as the registration reads and writes it, with what it provided. */
function projectOf(config: Partial<ProjectLike['config']> = {}) {
  const provided: Record<string, string> = {};
  const project: ProjectLike & { provided: Record<string, string> } = {
    name: 'shop',
    config: { setupFiles: [], browser: { enabled: false }, ...config },
    provide: (key, value) => {
      provided[key] = value;
    },
    provided,
  };
  return project;
}

describe('registerProject', () => {
  it('adds the setup file first, and keeps the setup files of the user in their order', () => {
    const project = projectOf({ setupFiles: ['./user-a.ts', './user-b.ts'] });
    const { setup, warnings } = registerProject(project, OPTIONS);
    expect(project.config.setupFiles).toEqual([OPTIONS.setup, './user-a.ts', './user-b.ts']);
    expect({ setup, warnings }).toEqual({ setup: true, warnings: [] });
  });

  it('does not add the setup file again, whether it is listed by path or by package name', () => {
    const byPath = projectOf({ setupFiles: [OPTIONS.setup] });
    const byName = projectOf({ setupFiles: ['@probara/vitest-reporter/setup'] });
    registerProject(byPath, OPTIONS);
    registerProject(byName, OPTIONS);
    expect(byPath.config.setupFiles).toEqual([OPTIONS.setup]);
    expect(byName.config.setupFiles).toEqual(['@probara/vitest-reporter/setup']);
  });

  it('hands the user runner to the reporter runner, which wraps it', () => {
    const project = projectOf({ runner: '/app/my-runner.mjs' });
    registerProject(project, OPTIONS);
    expect(project.provided).toEqual({ probaraCustomRunner: '/app/my-runner.mjs' });
    expect(project.config.runner).toBe(OPTIONS.runner);
  });

  it('wraps the default runner too, with no user runner to hand over', () => {
    const project = projectOf();
    registerProject(project, OPTIONS);
    expect(project.provided).toEqual({ probaraCustomRunner: '' });
    expect(project.config.runner).toBe(OPTIONS.runner);
  });

  it('skips a browser project with one warning that names it, and registers no setup file', () => {
    const project = projectOf({ browser: { enabled: true } });
    const result = registerProject(project, OPTIONS);
    expect(result.setup).toBe(false);
    expect(project.config.setupFiles).toEqual([]);
    expect(project.config.runner).toBeUndefined();
    expect(result.warnings).toEqual([
      'project "shop" runs in browser mode: its retries and repeats are reported as their final attempt only, and its probara.* helpers record nothing',
    ]);
  });

  it('leaves a TypeScript runner as it is on a Node that cannot import it, and keeps the setup file', () => {
    const project = projectOf({ runner: '/app/my-runner.ts' });
    const result = registerProject(project, OPTIONS);
    expect(result.setup).toBe(true);
    expect(project.config.runner).toBe('/app/my-runner.ts');
    expect(project.provided).toEqual({});
    expect(result.warnings).toEqual([
      'the runner of project "shop" is TypeScript, which this Node cannot import: the reporter keeps it as it is',
    ]);
  });

  it('leaves a runner that Node cannot load, whatever Vite could transform, as it is, with one warning that names it', () => {
    for (const runner of ['/app/my-runner.jsx', '/app/my-runner.tsx', '/app/my-runner']) {
      const project = projectOf({ runner });
      const result = registerProject(project, { ...OPTIONS, canImportTypeScript: true });
      expect(result.setup).toBe(true);
      expect(project.config.runner).toBe(runner);
      expect(project.provided).toEqual({});
      expect(result.warnings).toEqual([
        `the runner of project "shop" is ${runner}, which Node does not import: the reporter keeps it as it is`,
      ]);
    }
  });

  it('wraps a TypeScript runner where Node imports TypeScript', () => {
    const project = projectOf({ runner: '/app/my-runner.ts' });
    registerProject(project, { ...OPTIONS, canImportTypeScript: true });
    expect(project.provided).toEqual({ probaraCustomRunner: '/app/my-runner.ts' });
    expect(project.config.runner).toBe(OPTIONS.runner);
  });

  it('degrades with a warning that names the project when its setup files cannot change', () => {
    const project = projectOf();
    Object.defineProperty(project.config, 'setupFiles', { value: Object.freeze([]) });
    const result = registerProject(project, OPTIONS);
    expect(result.setup).toBe(false);
    expect(result.warnings).toEqual([
      expect.stringMatching(
        /^could not add the setup file to project "shop" .*: its retries and repeats are reported as their final attempt only$/,
      ),
    ]);
  });
});
