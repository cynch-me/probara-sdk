// Default jest-junit options; output location is set through JEST_JUNIT_* env vars in generate.sh.
module.exports = {
  testEnvironment: 'node',
  reporters: ['default', 'jest-junit'],
};
