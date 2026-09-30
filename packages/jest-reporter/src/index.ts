/**
 * `@probara/jest-reporter`: `module.exports` is the reporter class, which Jest instantiates with
 * `new Reporter(globalConfig, options, context)`, and `import Reporter from` gives in an ES module.
 */
import { ProbaraJestReporter } from './reporter.js';

export = ProbaraJestReporter;
