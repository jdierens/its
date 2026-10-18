# Contributing

## Version

The sidebar revision comes from the `version` field in `package.json`.

- Bump the **minor** number for each feature pull request (`0.9.0` → `0.10.0`).
- Bump the **patch** number for a fix (`0.9.0` → `0.9.1`).
- On every pull request, bump that version and mention the new version in the pull request title or description.

`next.config.ts` inlines the version, git commit, and build time at build time. On Vercel it reads `VERCEL_GIT_COMMIT_SHA` and `VERCEL_GIT_COMMIT_REF`. Locally it uses `git rev-parse`, and falls back to `dev` when git is unavailable. `VERCEL_ENV` marks preview and production; anything else is a local dev build.
