// Every test is a plain assertion: no `cy.visit`, so the specs run without a server and the
// reports hold no page output. Cypress exits non-zero because of the deliberate failure.
describe('Flaky', () => {
  it('passes first time', () => {
    expect(1 + 1).to.equal(2);
  });

  it('rejects a wrong password', () => {
    expect('denied').to.equal('granted');
  });

  it('crashes on an unexpected exception', () => {
    throw new TypeError("Cannot read properties of undefined (reading 'token')");
  });

  it.skip('supports SSO (skipped: SSO provider not configured)');

  describe('session', () => {
    describe('refresh', () => {
      it('renews the token before expiry', () => {
        expect([1, 2]).to.have.lengthOf(2);
      });
    });
  });

  it('accepts café (PRB-12)', () => {
    expect('café').to.contain('café');
  });

  it('accepts café and ñandú', () => {
    expect('ñandú').to.contain('ñandú');
  });
});

it('top level in spec', () => {
  expect(true).to.equal(true);
});
