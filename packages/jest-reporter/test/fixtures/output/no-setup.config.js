// The same project without the setup file: captureOutput cannot capture anything.
module.exports = {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  reporters: ['default', ['@probara/jest-reporter', { captureOutput: true }]],
};
