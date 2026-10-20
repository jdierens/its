# ITS

Inventory app for the ITS Supabase project. A sidebar groups Inventory, Sales, Purchasing, Warehouse, Pricing, and Admin.

Under the ITS title, the sidebar shows the version and a short git commit, for example `v0.21.0 · a1b2c3d`. The version starts at `package.json` and adds one step for each note in `changes/`. Hover that line for the full commit, branch, and Pacific build time. A collapsed sidebar keeps a tiny version under the logo. Local builds add a `-dev` suffix and a dev badge. Vercel preview builds show a preview badge; production does not. Those values are `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_SHA`, and `NEXT_PUBLIC_BUILD_TIME` (plus the branch and channel), set in `next.config.ts`. They are not secrets. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

Feature notes are files in [docs/](docs/). Add a new file for a feature. Do not add a section to this README.

## Try it

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's publishable or anon key. Do not commit that file.
3. Run `npm install`, then `npm run dev`.
4. Open http://localhost:3000.

`npm run typecheck` and `npm run build` both need to pass.
