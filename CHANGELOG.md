# Changelog

## 0.10.0

- Choose customers, vendors, and direction on Admin > Integrations, with a full resync option. Sync customers and Sync vendors run one entity. The last choice is remembered in the browser.
- Keep a separate last-sync time and change cursor for customers and vendors. Syncing one does not move the other. An existing shared cursor is copied onto both.
- Name the QuickBooks request, HTTP status, Intuit fault, and intuit_tid in sync errors. A sandbox/production mismatch says which environment to set.

## 0.9.0

- #1 Show taxonomy attributes on the item form.
- #2 Add attribute lists, item photos, and 90×29 mm labels.
- #3 Add taxonomy long and short codes and print the short code on labels.
- #4 Add an in-browser photo editor that saves a new gallery image.
- #5 Add an app shell and a dense keyboard-navigable items table.
- #6 Sync QuickBooks Online customers and vendors.
- #7 Add a public privacy policy and terms of use.
- #8 Harden QuickBooks OAuth (discovery, 401 retry, reconnect, CSRF, intuit_tid).
- #9 Show the app version and git revision under the sidebar title.
