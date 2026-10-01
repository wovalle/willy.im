# Changesets

Every package in `packages/` is versioned and published with
[changesets](https://github.com/changesets/changesets).

1. In your PR, run `npx changeset`, pick the packages you changed and the bump, and write
   one line for the changelog. Commit the generated `.changeset/*.md`.
2. On merge to `main`, `release.yml` opens (or updates) a "Version Packages" PR that bumps
   versions and writes the changelogs.
3. Merging that PR publishes every package whose version isn't on npm yet.

`@willyim/kit` pins `@willyim/idp` to an exact version, so any idp release also releases
kit with the new pin.
