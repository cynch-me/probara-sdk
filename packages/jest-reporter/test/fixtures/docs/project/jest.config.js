// The project the docs examples run in, as a user would lay it out: an example that brings no
// config runs with this one, and an example that brings no tests runs these.
module.exports = {
  testEnvironment: 'node',
  reporters: ['default', '@probara/jest-reporter'],
};
