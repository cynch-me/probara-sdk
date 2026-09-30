// The same project with runCasesOnly on, as the reporter's docs set it up.
module.exports = {
  ...require('./plain.config.js'),
  reporters: ['default', ['@probara/jest-reporter', { runCasesOnly: true }]],
};
