// The tests of this spec live directly in the root suite: cypress-junit gives that suite the file
// attribute of the spec, and no describe block between it and the testcases.
it('runs in the root suite', () => {
  expect('root').to.equal('root');
});

it('fails in the root suite', () => {
  expect(1).to.equal(2);
});
