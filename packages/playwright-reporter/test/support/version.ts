/** Whether `version` (such as `1.100.0`) is at least `major.minor`, comparing each as an integer. */
export function isVersionAtLeast(version: string, major: number, minor: number): boolean {
  const [ownMajor = 0, ownMinor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return ownMajor === major ? ownMinor >= minor : ownMajor > major;
}
