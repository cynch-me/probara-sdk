/**
 * The https link of a scenario's line in its file: a `--file-url` template, or the one the CI
 * environment gives (GitHub Actions, GitLab, Bitbucket, Azure DevOps). Probara shows the link on
 * the case; a link that is not https is left out.
 */
import { detectCiSource } from '@probara/core';

type Env = Readonly<Record<string, string | undefined>>;

/** The longest link Probara stores. */
const MAX_URL_LENGTH = 2048;

/** A variable's value, trimmed, or `undefined` when it is unset or blank. */
function valueOf(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** The template of the CI the job runs in, or `undefined` when the CI is unknown or incomplete. */
function ciTemplateOf(env: Env): string | undefined {
  const ci = detectCiSource(env);
  const commit = ci.commit === undefined ? undefined : encodeURIComponent(ci.commit);
  if (commit === undefined) return undefined;
  switch (ci.provider) {
    case 'github-actions': {
      const server = valueOf(env, 'GITHUB_SERVER_URL');
      const repository = valueOf(env, 'GITHUB_REPOSITORY');
      return server === undefined || repository === undefined
        ? undefined
        : `${server}/${repository}/blob/${commit}/{path}#L{line}`;
    }
    case 'gitlab': {
      const project = valueOf(env, 'CI_PROJECT_URL');
      return project === undefined ? undefined : `${project}/-/blob/${commit}/{path}#L{line}`;
    }
    case 'bitbucket': {
      const repository = valueOf(env, 'BITBUCKET_REPO_FULL_NAME');
      return repository === undefined
        ? undefined
        : `https://bitbucket.org/${repository}/src/${commit}/{path}#lines-{line}`;
    }
    case 'azure-pipelines': {
      // Only an Azure Repos Git repository lives under `_git`; GitHub and others need `--file-url`.
      if (valueOf(env, 'BUILD_REPOSITORY_PROVIDER') !== 'TfsGit') return undefined;
      const collection = valueOf(env, 'SYSTEM_COLLECTIONURI');
      const project = valueOf(env, 'SYSTEM_TEAMPROJECT');
      const repository = valueOf(env, 'BUILD_REPOSITORY_NAME');
      if (collection === undefined || project === undefined || repository === undefined) {
        return undefined;
      }
      const base = collection.replace(/\/*$/, '/');
      return `${base}${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}?path=/{path}&version=GC${commit}&line={line}`;
    }
    default:
      return undefined;
  }
}

/** The link template to use: the `--file-url` one when given, else the one the CI gives. */
export function fileUrlTemplateOf(flag: string | undefined, env: Env): string | undefined {
  const given = flag?.trim();
  return given === undefined || given === '' ? ciTemplateOf(env) : given;
}

/**
 * The link of `line` in the file at `path`: `{path}` filled with its segments encoded, `{line}` with
 * the line. `undefined` when the result is not an https URL, or is too long for Probara.
 */
export function fileUrlOf(template: string, path: string, line: number): string | undefined {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = template.replaceAll('{path}', encoded).replaceAll('{line}', String(line));
  if (url.length > MAX_URL_LENGTH) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
