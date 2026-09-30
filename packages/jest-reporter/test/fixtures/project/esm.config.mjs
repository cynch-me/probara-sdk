// The same project with an ES module config: Jest still loads the reporter with `require`.
export default {
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.jest-cache',
  reporters: ['default', ['@probara/jest-reporter', { keyIncludesFile: false }]],
};
