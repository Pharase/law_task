# gscript

Google Apps Script code for the Google Sheets side of law_task. It's kept in sync with Google using [clasp](https://github.com/google/clasp).

```sh
npx @google/clasp login                       # once, opens the browser
npx @google/clasp clone 131Fqnypa9nPRcw57RuRlyP6fGIWt8RYc0UvCOCktsqW4JigP8d1xkD_g --rootDir gscript
npx @google/clasp pull                        # Google -> here
npx @google/clasp push                        # here -> Google
```

Find the script ID in the Apps Script editor under **Project Settings → IDs**.

**This repo is public.** Commit code only. Never commit sheet data, IDs of sensitive sheets, API keys or passwords.
