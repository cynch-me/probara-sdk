// Its tests pass, then its afterAll hook throws: Jest fails the file outside its tests.
describe('teardown', () => {
  afterAll(() => {
    throw new Error('teardown failed');
  });

  test('passes before its afterAll fails', () => {});
});
