const before = new Set(Object.keys(require.cache));
const { probara } = require('@probara/jest-reporter');

test('loads only the helpers in the test sandbox', () => {
  const loaded = Object.keys(require.cache).filter((path) => !before.has(path));
  expect(loaded.some((path) => path.endsWith('dist/cjs/metadata-entry.js'))).toBe(true);
  expect(
    loaded.filter((path) =>
      /jest-reporter\/dist\/reporter\.js$|core\/dist\/cjs\/(index|client|reporter)\.js$/.test(path),
    ),
  ).toEqual([]);
  expect(probara.step('Sum', () => 1 + 1)).toBe(2);
});
