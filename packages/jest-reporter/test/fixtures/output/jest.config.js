// The project of the captureOutput end-to-end tests: the setup file, and the reporter capturing the
// console output of each test.
module.exports = {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
  reporters: ['default', ['@probara/jest-reporter', { captureOutput: true }]],
};
