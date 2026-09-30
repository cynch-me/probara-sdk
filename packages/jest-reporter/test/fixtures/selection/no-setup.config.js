// runCasesOnly without the setup file.
module.exports = {
  ...require('./jest.config.js'),
  setupFilesAfterEnv: [],
};
