// The project the end-to-end tests run: jest-junit next to the reporter, both by package name.
module.exports = {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  reporters: ['default', 'jest-junit', ['@probara/jest-reporter', {}]],
};
