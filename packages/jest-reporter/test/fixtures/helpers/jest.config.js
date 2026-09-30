// The project of the probara.* end-to-end tests: the reporter by its package name. Babel (its
// config next to this file) turns the ES module syntax of tests/esm.test.js into CommonJS.
module.exports = {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  reporters: ['default', ['@probara/jest-reporter', {}]],
};
