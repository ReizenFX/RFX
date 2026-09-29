# RFX

An After Effects CEP panel with eleven tabs: Transform, FX, Color, Graph, Assets, Paste,
Render, Tracker, Discord, Download and Caption. The manifest also lists Photoshop and
Premiere Pro as hosts.

## Setup

1. **Node modules.** From this folder run `npm install`. It recreates `node_modules/` from
   `package.json` (discord-rpc 4.0.1, node-fetch 2.7.0, ws 7.5.10).
2. **Binaries.** Put the tools listed under [bin/](#bin) in place. `bin/` is not in git.
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
  panel, because `jsx/global.jsx` (the manifest ScriptPath) only runs when the extension loads.
- Each tab has `js/tab-<name>.js` plus `jsx/<name>.jsx`. `jsx/global.jsx` holds shared
  helpers and loads the tab jsx files; `assets.jsx` and `caption.jsx` are loaded by their
  own tab JS.

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

## bin/

The tabs look for these tools inside the extension folder at runtime (the paths come from
the code; this repo does not track `bin/`, so check what you actually have there):

| Path | Used by | What goes there |
|---|---|---|
| `bin/win/assets/` | Assets tab (GIF previews) | `ffmpeg.exe`, searched up to 6 subfolders deep |
| `bin/win/download/` | Download tab | `yt-dlp.exe`, `ffmpeg.exe` |
| `bin/win/caption/` | Caption tab | `faster-whisper-xxl.exe` with its `_xxl_data` runtime folder, and `ffmpeg.exe` |
| `bin/win/caption/models/` or `models/` at the root | Caption tab | the model folder `faster-whisper-large-v3` (the HuggingFace cache layout `models--Systran--faster-whisper-large-v3` also works) |
| `bin/mac/caption/` | Caption tab on macOS | `ffmpeg`, `faster-whisper-xxl` |

Where to get them:
- **ffmpeg.** Windows static builds are linked from https://ffmpeg.org/download.html (for
  example gyan.dev or BtbN builds). Use `ffmpeg.exe` from the build's `bin` folder.
- **yt-dlp.** `yt-dlp.exe` from https://github.com/yt-dlp/yt-dlp/releases.
- **Faster-Whisper-XXL.** Purfview's standalone build from
  https://github.com/Purfview/whisper-standalone-win/releases. The archive contains
  `faster-whisper-xxl.exe` and `_xxl_data`.
- **Model.** `faster-whisper-large-v3` from https://huggingface.co/Systran/faster-whisper-large-v3
  (about 3 GB). The caption tab never downloads it on its own.
