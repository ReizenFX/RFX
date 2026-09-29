# RFX

An After Effects CEP panel with eleven tabs: Transform, FX, Color, Graph, Assets, Paste,
Render, Tracker, Discord, Download and Caption. The manifest also lists Photoshop and
Premiere Pro as hosts.

## Setup

1. **Node modules.** From this folder run `npm install`. It recreates `node_modules/` from
   `package.json` (discord-rpc 4.0.1, node-fetch 2.7.0, ws 7.5.10).
2. **Extra programs.** Nothing to do by hand: on first launch the welcome dialog offers to
   download what the Caption, Download and Assets tabs need (see
   [Dependencies](#dependencies)). An existing `bin/` folder is still used if present.
3. **Link the panel.** Run `scripts\dev-link.bat` (or
   `powershell -ExecutionPolicy Bypass -File scripts\dev-link.ps1`). It creates the
   junction `%APPDATA%\Adobe\CEP\extensions\RFX` pointing at this folder. It's safe to re-run
   and never touches anything else in that folder.
4. **Allow unsigned extensions.** `PlayerDebugMode` must be `1` under
   `HKCU\Software\Adobe\CSXS.<version>` for the CEP version your After Effects uses. Setting
   several versions is harmless, for example:
   ```
   reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
5. Restart After Effects and open **Window > Extensions > RFX**.

If RFX doesn't appear, check in this order:
1. The junction resolves: `dir "%APPDATA%\Adobe\CEP\extensions\RFX\CSXS"` lists `manifest.xml`.
2. The IDs in `branding.json` differ from every other installed extension.
3. `PlayerDebugMode` is set.

## Day-to-day

- Edits are live through the junction; there is no build step.
- After JS, CSS or HTML changes, reload the panel. After JSX changes, close and reopen the
  panel: each tab evaluates its jsx file once per panel session, the first time it needs it.
  Restart After Effects if you renamed or removed a jsx function (the old one stays defined
  in AE's shared ExtendScript scope until then).
- Each tab is independent: `js/tab-<name>.js` loads its own `jsx/<name>.jsx` on demand
  (via `window.createJsxLoader` in `js/globals.js`; Assets and Caption use their own
  loaders). There is no shared jsx file and no manifest ScriptPath, and no jsx file calls
  anything defined in another.

## Renaming or bumping the version

Everything that carries the product name, IDs or version is generated from `branding.json`:

1. Edit `branding.json` (`appName`, `menuName`, `bundleId`, `extensionId`, `version`).
2. Run `node scripts/apply-branding.js` (or `npm run branding`). It updates
   `CSXS/manifest.xml`, the `index.html` `<title>` and `package.json`, regenerates
   `js/branding.js` (`window.APP`), and prints each change.
3. Restart After Effects and commit.

Changing `bundleId` or `extensionId` makes After Effects treat the panel as a new
extension, and CEP keeps localStorage per extension ID, so saved panel settings start
empty. Internal identifiers are intentionally not part of branding: localStorage keys,
on-disk data folders, Discord client IDs and `bin/` paths.

## Assets library location

A folder chosen in the Assets tab's Settings always wins, even while it is unavailable (the
panel then says so). Without one, RFX uses the first existing `RFX/Library` folder in
Documents, the user data folder (`%APPDATA%` on Windows, `~/Library/Application Support` on
Mac) or Downloads, and otherwise creates `Documents/RFX/Library`. Nothing is ever moved.

## Dependencies

Three tabs need programs that are too large to ship with the panel. `js/deps.js` downloads
them from their official sources, verifies them (published sha256 where available, else the
exact size), extracts them and checks that they run. Each tab has its own copies; nothing
needs admin rights.

| Tab | Needs | Source | Check |
|---|---|---|---|
| Caption | Faster-Whisper-XXL | GitHub `Purfview/whisper-standalone-win`, tag `Faster-Whisper-XXL` (newest free Windows `.7z`) | size (no hash is published) |
| Caption | Speech model large-v3 | Hugging Face `Systran/faster-whisper-large-v3`, pinned revision | LFS sha256 + git blob sha1 per file |
| Caption, Download, Assets | FFmpeg (Download also gets FFprobe) | GitHub `BtbN/FFmpeg-Builds`, newest stable line, win64 GPL | sha256 |
| Download | yt-dlp | GitHub `yt-dlp/yt-dlp` latest release | sha256 |
| Download | Deno (JavaScript runtime for yt-dlp) | GitHub `denoland/deno` latest release | sha256 |
| (Caption, only if needed) | 7zr.exe to extract `.7z` when Windows' `tar` cannot | GitHub `ip7z/7zip` | sha256 |

- **Where:** `%APPDATA%\RFX\Dependencies\<tab>\<dependency>\<version>\`, with `deps.json`
  recording the active and previous version, source, hashes and install date. Each tab's
  settings can move its folder (nothing is moved automatically).
- **Where to manage:** the welcome dialog (Dependencies button at the right of the tab bar),
  Caption settings (gear next to its sub-tabs), Download settings (gear or the yt-dlp pill in
  its header), Assets settings.
- **Updates:** checked on request and at most once a day in the background. An update is
  installed next to the current version, then switched to; "Roll back" switches back. Old
  versions are deleted only when you choose "Delete".
- **Lookup order:** managed version, else an existing copy in `bin/win/<tab>` (shown as
  "existing install, version unknown"), else missing. `bin/` is never modified.
- **GitHub limits:** GitHub allows 60 unauthenticated API calls per hour per network. When
  they are used up (other programs share them), release information is read from the
  public release pages instead.

## bin/ (existing installs)

Older setups kept the tools inside the extension folder. They are still used when no
managed copy is installed (the paths come from the code; this repo does not track `bin/`):

| Path | Used by | What goes there |
|---|---|---|
| `bin/win/assets/` | Assets tab (GIF previews) | `ffmpeg.exe`, searched up to 6 subfolders deep |
| `bin/win/download/` | Download tab | `yt-dlp.exe`, `ffmpeg.exe` |
| `bin/win/caption/` | Caption tab | `faster-whisper-xxl.exe` with its `_xxl_data` runtime folder, and `ffmpeg.exe` |
| `bin/win/caption/models/` or `models/` at the root | Caption tab | the model folder `faster-whisper-large-v3` (the HuggingFace cache layout `models--Systran--faster-whisper-large-v3` also works) |
| `bin/mac/caption/` | Caption tab on macOS | `ffmpeg`, `faster-whisper-xxl` |

You don't need to fill `bin/` any more: the [Dependencies](#dependencies) installs above come
from the same official sources and can be updated and rolled back. Placing files here by hand
still works as a fallback. The Caption tab never lets the engine download the model on its
own during a transcription; the model is only downloaded when you install it.
