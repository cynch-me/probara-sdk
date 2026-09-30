// A test file Jest cannot load: jest-junit leaves it out, the reporter warns about it.
require('./missing-module');

test('never runs', () => {});
