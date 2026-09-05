# GitHub Upload — v31

This package is intentionally kept under 100 files. Upload the extracted contents so `server.js`, `package.json`, `render.yaml`, `public/` and `android/` remain at the repository root.

# GitHub-ready package

This v26 package was trimmed to stay below GitHub's 100-file browser upload limit without removing game/runtime files.

Removed only non-runtime items:
- historical version notes/checklists
- Android example test files
- empty placeholder `.gitkeep` files

Core web server, public client, Capacitor Android project, Gradle wrapper, resources, and v26 rules are retained.

## Upload
1. Create/open your GitHub repository.
2. Use **Add file → Upload files**.
3. Drag the CONTENTS of this folder into GitHub (not the zip itself if you want the source visible).
4. Commit the changes.

For Render deployment, keep `server.js`, `package.json`, `render.yaml`, and the `public/` folder at repository root.
