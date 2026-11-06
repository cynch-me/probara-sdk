# Changesets

Each file in this folder is a changeset: the packages a pull request changes, how far each one
bumps (`patch`, `minor` or `major`), and the changelog entry for its users. Add one with
`pnpm changeset` in every pull request that changes what a published package does.

The release workflow turns them into a "Version Packages" pull request; merging that pull request
publishes the packages to npm and tags the release. See
[Releases](../CONTRIBUTING.md#releases).
