/**
 * @jest-environment jsdom
 */
test('prints in a jsdom environment', () => {
  console.log(`In the ${typeof document}`);
});
