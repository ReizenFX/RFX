# RFX: working rules

After Effects CEP panel. This folder is the extension root (`CSXS/manifest.xml`, `index.html`).

## Layout
- `css/theme.css` and `js/theme.js` load first in `index.html` (see "Design system"). `css/global.css` holds the shared components.
- Every tab has its own `js/tab-<name>.js` (panel side), `jsx/<name>.jsx` (ExtendScript side) and usually `css/tab-<name>.css`. Shared JS: `js/globals.js`. There is no shared jsx file and no manifest `<ScriptPath>`.
- Each tab loads its own jsx on demand: `const <name>Jsx = window.createJsxLoader('<name>.jsx')` (in `js/globals.js`), then every host call goes through `<name>Jsx(script, cb)`, which waits for the load. `assets.jsx` and `caption.jsx` keep their own loaders in their tab JS.
- A jsx file must never call anything defined in another jsx file, and a tab's JS must only call its own jsx (the other file may not be loaded). If two tabs need the same helper, give each a tab-prefixed copy (e.g. `pasteGetAepPath` / `downloadGetAepPath`).
- All panels in After Effects share one ExtendScript global scope. Never define the same function in two jsx files; use tab-prefixed names for new globals.
- External programs (ffmpeg, yt-dlp, deno, faster-whisper-xxl, the Whisper model) are managed by `js/deps.js` (shared installer code, not a tab; UI styles in `css/deps.css`). Each tab registers its own dependencies and gets its own installs under `%APPDATA%\RFX\Dependencies\<tab>` (changeable per tab); two tabs never share a binary. Tabs get paths with `RFXDeps.resolve(tab, id)` (managed version, else the legacy `bin/win/<tab>` copy, else missing). Never write into `bin/`.
- `js/welcome.js` (not a tab) shows the first-run welcome and the Dependencies overview (button at the right of the tab bar). New tabs that need downloads must register with `RFXDeps` and be added to its `TABS` list.
- jsx is ES3: no `let`/`const`, arrow functions, template strings, or reliance on native `JSON` (bring a local, tab-prefixed JSON helper if needed).

## Design system (hard rules, apply to every UI change)
The panel is dark, minimal and premium: ~95% black, white and greys, one look across all tabs.
- **Colours only from theme variables.** All colours are defined in `css/theme.css` (tokens `--rfx-*`); `js/theme.js` switches theme/accent/density/roundness before first paint and exposes `window.RFXTheme` (`cssVar()` for canvas/SVG drawing, `onChange()` / `rfx-theme-change` event to redraw). No hex/rgb/hsl literals anywhere else. Exception: content colours (colour pickers, hue gradients, AE label colours, colours the user picks), which must carry the marker `rfx-content-color` on the same line. SVG presentation attributes can't take `var()`: use `style="stroke:var(--rfx-accent)"` or a class.
- **Delete / remove / clear buttons are normal dark buttons.** Never red fill, text, border or hover.
- **Never highlight with a stroke** (border, outline, ring, glow). Hover, focus, active, selected and drag-over are shown with low-contrast fills (`--rfx-fill-hover` / `-active` / `-selected`); the Caption Editor text selection is the reference. Keyboard focus is a fill too (see `global.css`). Borders that exist are structure only (`--rfx-line`) or 1px transparent to keep box sizes.
- **No status colours in the default (Monochrome) theme.** Show state with weight, brightness, icon shape (check, empty circle, triangle), a small neutral dot or wording. Use `--rfx-ok/-warn/-err(-soft)`: grey in Monochrome, soft colours in the Color theme.
- **The accent marks only**: the one primary action of a view, controls that are on (toggle, checkbox, radio), slider fill, progress, Graph handles. Text on the accent uses `--rfx-on-accent` (picked by contrast). Active tabs, selected rows and menu items use grey fills, not the accent.
- **Menus and dropdowns** all use the Graph option-menu look: `.ctx-menu` / `.ctx-item` / `.custom-select-*` (rounded panel, inset rounded items, grey fill on hover). Don't hand-style new menus.
- **Sizes from tokens**: control heights `--rfx-h-sm/md/lg`, spacing `--rfx-sp-*`, radii `--rfx-r-*`, font sizes `--rfx-fs-*`, weights `--rfx-fw-*`, icons `--rfx-icon-sm/md` with stroke `--rfx-icon-stroke` (outline icons, `currentColor`, round caps). Buttons, inputs and selects inherit the panel font.
- Appearance settings are stored under `rfxTheme`, `rfxAccent`, `rfxDensity`, `rfxRadius`, `rfxReduceMotion`.

## Live development
- The panel runs straight from this folder through a junction: `%APPDATA%\Adobe\CEP\extensions\RFX` -> here (created by `scripts\dev-link.bat`). Edits are live; there is no build step.
- After JS/CSS/HTML edits: reload the panel. After JSX edits: close and reopen the panel (each tab evaluates its jsx once per panel session). Restart After Effects if a jsx function was renamed or removed.

## Branding (single source)
- Product name, menu name, bundle ID, extension ID and version live ONLY in `branding.json`. After changing it, run `node scripts/apply-branding.js`.
- Never hand-edit the generated values: manifest `ExtensionBundleId`/`ExtensionBundleName`/`ExtensionBundleVersion`, `<Extension Id>`/`Version`, `<Menu>`; `index.html` `<title>`; `package.json` `name`/`version`; all of `js/branding.js`.
- User-visible product text in JS reads `window.APP` (from `js/branding.js`, loaded first in `index.html`).
- A rename must never touch internal identifiers: localStorage keys (`ult*`, `ufx*`, `rfx*`, `zlp_*`, ...), on-disk data folders (`%APPDATA%\UltimateFXSuite`, `%APPDATA%\RFX Suite\Caption Tab`, the Assets default library `Documents/RFX/Library`), temp and layer names (`ufx_*`), Discord client IDs and app names (`backend/config.json`, `js/tab-discord.js`), `bin/` paths, JSX global names.
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
