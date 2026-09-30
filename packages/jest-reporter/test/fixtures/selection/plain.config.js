// The project of the run selection end-to-end tests: the reporter by its package name, with its
// setup file, and runCasesOnly left to PROBARA_RUN_CASES_ONLY.
module.exports = {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
  reporters: ['default', ['@probara/jest-reporter', {}]],
};
