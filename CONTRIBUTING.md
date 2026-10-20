# Contributing

## Version

The sidebar label is `vX.Y.Z · sha`. `X.Y.Z` starts at the `version` field in `package.json` and applies every file in `changes/` except `README.md`, in filename order.

- A feature adds `changes/YYYYMMDDHHMMSS-short-name.md` with `bump: minor`.
- A fix uses `bump: patch`.
- Do not edit `package.json`'s version, `CHANGELOG.md`, or `README.md` to record the change.
- Put the feature write-up in a new file under `docs/`. Leave `README.md` as the short start page.
- Put a test in `lib/` as `*.test.ts`. The test script already runs `lib/**/*.test.ts`, so do not edit that script to add a file.

`next.config.ts` inlines that version, the git commit, and the build time. On Vercel it reads `VERCEL_GIT_COMMIT_SHA` and `VERCEL_GIT_COMMIT_REF`, so the deploy of the merge commit already shows the new version. There is no second commit. Locally it uses `git rev-parse`, and falls back to `dev` when git is unavailable. `VERCEL_ENV` marks preview and production; anything else is a local dev build.

## Open pull requests

Keep each pull request based on `main`, and keep fewer of them open at once.

When a pull request merges, update every other open ITS pull request from `main` and resolve conflicts before starting the next feature. Do that in the order they should merge when the same files overlap.
