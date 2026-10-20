# Change notes

One file per pull request. The app does not read this README when it computes the version.

Name the file `changes/YYYYMMDDHHMMSS-short-name.md` so filename order is the bump order.

```
---
bump: minor
---
- What changed, in a sentence or two.
```

`bump` is `minor` for a feature and `patch` for a fix. The sidebar version starts at the `version` in `package.json` and applies every other file in this directory. Do not edit that version, `CHANGELOG.md`, or `README.md` for the feature.
