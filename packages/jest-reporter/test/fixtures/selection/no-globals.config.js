// runCasesOnly in a project without Jest's globals (injectGlobals: false), whose tests import them.
module.exports = {
  ...require('./jest.config.js'),
  injectGlobals: false,
  testMatch: ['<rootDir>/explicit/*.check.js'],
};
