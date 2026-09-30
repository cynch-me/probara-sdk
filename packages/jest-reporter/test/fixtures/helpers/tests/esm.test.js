import { probara } from '@probara/jest-reporter';

test('imports the helpers as an ES module', () => {
  probara.tags('esm');
});
