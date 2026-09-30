/**
 * The real option list of the reporter, read from its types with the TypeScript compiler: every
 * property of `ProbaraPlaywrightOptions` (`run` and `source` expanded into `run.name`,
 * `source.branch`...), each with its type as the docs write it.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TypeScript from 'typescript';
import { PACKAGE_DIR } from './markdown.js';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof TypeScript;

export interface OptionEntry {
  /** `captureOutput`, `run.name`, `source.branch`. */
  name: string;
  /** `boolean`, `string[]`, `Record<string, string>`, `{ group, name }[]`... */
  type: string;
  /** Whether it comes from core's `RuntimeOptions` (seams for code), not from a setting. */
  runtime: boolean;
}

/** Options of an object type expanded one level into `<name>.<field>` rows. */
const EXPANDED = new Set(['run', 'source']);

function withoutUndefined(type: TypeScript.Type): TypeScript.Type[] {
  const parts = type.isUnion() ? type.types : [type];
  return parts.filter((part) => (part.flags & ts.TypeFlags.Undefined) === 0);
}

/** A type as the options table writes it. */
function docType(type: TypeScript.Type, checker: TypeScript.TypeChecker): string {
  const parts = withoutUndefined(type);
  const names: string[] = [];
  const add = (name: string) => {
    if (!names.includes(name)) names.push(name);
  };
  const booleans = parts.filter((part) => (part.flags & ts.TypeFlags.BooleanLiteral) !== 0);
  if (booleans.length === 2) add('boolean');
  for (const part of parts) {
    if ((part.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      if (booleans.length === 1) add(checker.typeToString(part));
    } else if ((part.flags & ts.TypeFlags.StringLike) !== 0) add('string');
    else if ((part.flags & ts.TypeFlags.NumberLike) !== 0) add('number');
    else if ((part.flags & ts.TypeFlags.Boolean) !== 0) add('boolean');
    else if (checker.isArrayType(part)) {
      const [element] = checker.getTypeArguments(part as TypeScript.TypeReference);
      add(`${element === undefined ? 'unknown' : docType(element, checker)}[]`);
    } else if (part.getCallSignatures().length > 0) add('function');
    else {
      const index = checker.getIndexInfosOfType(part)[0];
      if (index !== undefined) add(`Record<string, ${docType(index.type, checker)}>`);
      else
        add(
          `{ ${part
            .getProperties()
            .map((property) => property.name)
            .join(', ')} }`,
        );
    }
  }
  return names.join(' | ');
}

/** Every option of `ProbaraPlaywrightOptions`, in declaration order. */
export function realOptions(): OptionEntry[] {
  const configPath = join(PACKAGE_DIR, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_DIR);
  const entry = join(PACKAGE_DIR, 'src', 'options.ts');
  const program = ts.createProgram([entry], parsed.options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (source === undefined) throw new Error(`cannot read ${entry}`);
  const module = checker.getSymbolAtLocation(source);
  const symbol =
    module === undefined
      ? undefined
      : checker
          .getExportsOfModule(module)
          .find((candidate) => candidate.name === 'ProbaraPlaywrightOptions');
  if (symbol === undefined) throw new Error('ProbaraPlaywrightOptions is not exported');

  const options: OptionEntry[] = [];
  for (const property of checker.getDeclaredTypeOfSymbol(symbol).getProperties()) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (declaration === undefined) continue;
    const runtime = declaration.getSourceFile().fileName.endsWith('/runtime.ts');
    const type = checker.getTypeOfSymbolAtLocation(property, declaration);
    if (!EXPANDED.has(property.name)) {
      options.push({ name: property.name, type: docType(type, checker), runtime });
      continue;
    }
    const parts = withoutUndefined(type);
    const objects = parts.filter((part) => (part.flags & ts.TypeFlags.Object) !== 0);
    // `source: false` is an option of its own.
    if (objects.length < parts.length) {
      options.push({ name: property.name, type: docType(type, checker), runtime });
    }
    for (const object of objects) {
      for (const field of object.getProperties()) {
        const fieldDeclaration = field.valueDeclaration ?? field.declarations?.[0];
        if (fieldDeclaration === undefined) continue;
        const fieldType = checker.getTypeOfSymbolAtLocation(field, fieldDeclaration);
        options.push({
          name: `${property.name}.${field.name}`,
          type: docType(fieldType, checker),
          runtime,
        });
      }
    }
  }
  return options;
}
