// The project of the Jest `projects` end-to-end tests: two projects, one in jsdom, that share a
// folder of tests. jest-junit runs next to the reporter.
const common = { cacheDirectory: '<rootDir>/.jest-cache' };

module.exports = {
  reporters: ['default', 'jest-junit', ['@probara/jest-reporter', {}]],
  projects: [
    {
      ...common,
      displayName: 'api',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/api/**/*.test.js', '<rootDir>/tests/shared/**/*.test.js'],
    },
    {
      ...common,
      displayName: 'ui',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/ui/**/*.test.js', '<rootDir>/tests/shared/**/*.test.js'],
    },
  ],
};
