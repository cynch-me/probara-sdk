// The same run with the junit reporter's addFileAttribute on: every testcase names its file.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: [['junit', { addFileAttribute: true, outputFile: 'junit-file-attribute.xml' }]],
  },
});
