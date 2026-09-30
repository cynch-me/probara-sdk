// The project of the links and assignees end-to-end tests: the reporter by its package name, set
// by the environment only.
module.exports = {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  reporters: ['default', ['@probara/jest-reporter', {}]],
};
