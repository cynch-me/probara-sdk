import { describe, expect, it } from 'vitest';
import { hasFileExtension } from './index.js';

describe('hasFileExtension', () => {
  it.each(['trace.zip', 'shot.PNG', 'archive.tar.gz', 'notes.markdown'])(
    'sees the extension of %j',
    (name) => {
      expect(hasFileExtension(name)).toBe(true);
    },
  );

  it.each(['screenshot', 'report.', 'dump.verylongext', 'file.tx-t', '.'])(
    'sees no extension in %j',
    (name) => {
      expect(hasFileExtension(name)).toBe(false);
    },
  );
});
