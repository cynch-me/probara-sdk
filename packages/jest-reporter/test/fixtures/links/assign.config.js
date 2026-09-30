// The same project, assigning failed results to members by a reporter option.
module.exports = {
  ...require('./jest.config.js'),
  reporters: [
    'default',
    [
      '@probara/jest-reporter',
      { assignFailedTo: ['ana@example.com', 'nobody@example.com', 'bo@example.com'] },
    ],
  ],
};
