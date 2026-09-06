# Push Kaali Ni Tidi v3.7.0 to GitHub

Repository: `https://github.com/tusharkumarnayak24cse-bit/kalinitidi`

Your existing Render service `tusharevent-2` deploys from the repository subfolder:

`kalitiri-v34-clear-trick-zone`

For compatibility, v3.7 replaces the contents of that folder instead of changing the Render Root Directory. The folder name is historical; the application inside reports version **3.7.0**.

## macOS one-command update

1. Extract this ZIP.
2. Double-click `PUSH_TO_GITHUB.command`.
3. If macOS blocks it, right-click → Open.
4. Complete GitHub authentication if prompted.

The script runs tests, clones the current repo, replaces only `kalitiri-v34-clear-trick-zone`, commits, and pushes to `main`. Since Render auto-deploy is enabled, the push should trigger the deployment automatically.

Do not commit `.env`, `ADMIN_KEY`, or a database connection URL.
