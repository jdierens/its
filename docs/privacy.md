# Privacy and terms

`/privacy` and `/terms` are public. They do not use the app shell, and they do not require sign-in. The list to keep public is `PUBLIC_PATHS` in `lib/publicPaths.ts`. `/login` and `/auth/callback` are also reachable with no session so a person can sign in. They are gate exceptions, not entries in `PUBLIC_PATHS`.

The pages are a plain-language notice, not legal advice. They give the mailing address 3730 E Dale Ave, Henderson, Nevada 89044, and the terms use the laws of the State of Nevada.
