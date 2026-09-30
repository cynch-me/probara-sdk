// The same project, with the issue URL template as a reporter option.
module.exports = {
  ...require('./jest.config.js'),
  reporters: [
    'default',
    ['@probara/jest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
  ],
};
