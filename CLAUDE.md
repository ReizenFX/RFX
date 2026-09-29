# RFX: working rules

After Effects CEP panel. This folder is the extension root (`CSXS/manifest.xml`, `index.html`).

## Layout
- Every tab has its own `js/tab-<name>.js` (panel side), `jsx/<name>.jsx` (ExtendScript side) and usually `css/tab-<name>.css`. Shared code: `js/globals.js`, `jsx/global.jsx`.
- `jsx/global.jsx` is the manifest `<ScriptPath>`: it defines helpers used by more than one tab, then `$.evalFile`s the tab jsx files listed in its loader. `assets.jsx` and `caption.jsx` are not in that list; their tab JS loads them on demand.
- All panels in After Effects share one ExtendScript global scope. Never define the same function in two jsx files, and prefer tab-prefixed names for new globals.

## Live development
- The panel runs straight from this folder through a junction: `%APPDATA%\Adobe\CEP\extensions\RFX` -> here (created by `scripts\dev-link.bat`). Edits are live; there is no build step.
- After JS/CSS/HTML edits: reload the panel. After JSX edits: close and reopen the panel (the ScriptPath only runs when the extension loads).

## Branding (single source)
- Product name, menu name, bundle ID, extension ID and version live ONLY in `branding.json`. After changing it, run `node scripts/apply-branding.js`.
- Never hand-edit the generated values: manifest `ExtensionBundleId`/`ExtensionBundleName`/`ExtensionBundleVersion`, `<Extension Id>`/`Version`, `<Menu>`; `index.html` `<title>`; `package.json` `name`/`version`; all of `js/branding.js`.
- User-visible product text in JS reads `window.APP` (from `js/branding.js`, loaded first in `index.html`).
- A rename must never touch internal identifiers: localStorage keys (`ult*`, `ufx*`, `rfx*`, `zlp_*`, ...), on-disk data folders (`%APPDATA%\UltimateFXSuite`, `%APPDATA%\RFX Suite\Caption Tab`, asset library folders), temp and layer names (`ufx_*`), Discord client IDs and app names (`backend/config.json`, `js/tab-discord.js`), `bin/` paths, JSX global names.
- Changing `bundleId`/`extensionId` makes After Effects treat the panel as a new extension with empty localStorage. Only change them deliberately.
- Paths into the extension must come from `csInterface.getSystemPath(SystemPath.EXTENSION)`, never from a hardcoded folder name.

## Off-limits
- Never read, modify or commit `bin/` or `node_modules/` (reads are also denied in `.claude/settings.json`). `node_modules/` comes from `npm install`; `bin/` is described in `README.md`.

## Git
- Keep changes minimal and scoped to the request. Commit after each completed change.
- Repo-local `core.autocrlf=false`: files keep their existing line endings (a mix of LF and CRLF). Don't normalize them.
- No git identity is configured globally: pass one per commit (`git -c user.name=... -c user.email=... commit`). Never change global git config.
- No `git reset --hard`, `git clean -fd` or force push without explicit approval.

## Known issues (leave unless asked)
- `js/tab-graph.js` calls `applyBezierEaseToExpression`, which no jsx file defines ("Apply to expression" does nothing).
- `index.html` links `css/tab-fx.css`, which does not exist.
