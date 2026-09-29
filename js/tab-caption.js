/* ============================================================================
   RFX SUITE 2 - CAPTION TAB
   Ported from the standalone AutoCaps Pro controller.

   - Wrapped in an IIFE; only caption*() handlers are exposed on window.
   - Node modules are required lazily, guarded by window.__adobe_cep__.
   - jsx/caption.jsx is loaded on demand via $.evalFile and verified with capPing().
   - Uses the shell's window.buildCustomDropdown(); does NOT touch the shell's
     switchTab, tab order, numpad, sliders, or window.alert.
   ============================================================================ */
(function() {
'use strict';

/* ---------------------------------------------------------------------------
   MODULE STATE
   --------------------------------------------------------------------------- */
var fs = null, path = null, os = null, https = null;
var spawn = null, exec = null;
var nodeReady = false;
var jsxReady = false;
var jsxLoading = false;
var jsxQueue = [];
var capModelDirCache;   // undefined = not yet resolved this session

var isMac = false;
var extensionRoot = '';
var binDir = '';
var ffmpegExe = '';
var whisperExe = '';
var modelSearchRoots = [];
var extDataDir = '';
var cacheDir = '';
var presetsFolder = '', stylesFolder = '', formatsFolder = '';
var boxPresetsFolder = '', boxFormatsFolder = '', styleFormatsFolder = '';

var SETTINGS_KEY = 'rfxCaptionSettings';

var capRawWordData = [];
var capCompFps = 30;
var capCurrentEditorData = [];
var capSelectedEditorIndex = -1;
var capFfmpegProcess = null;
var capWhisperProcess = null;
var capIsCancelling = false;
var capCurrentCompId = null;
var capCurrentHash = null;
var capCurrentLayerCount = null;
var capIsSplitting = false;
var capIsSyncing = false;
var capPollTimer = null;

var capPendingStyleJson = null;
var capPendingFormatJson = null;
var capPendingBoxFormatJson = null;
var capPendingStyleFormatJson = null;
var capExtraMode = '';
var capMultiDeleteMode = '';

var capNumpadInput = null;
var capNumpadSlider = null;
var capNumpadWrapper = null;

var DEFAULT_SETTINGS = {
    chars: 7, minDur: 1.2, gap: 0, lines: 'single',
    puncComma: true, puncPeriod: true, puncQuestion: false, puncExclaim: false,
    bgEnable: false, bgPadX: 0, bgPadY: 0, bgRound: 25, bgOpacity: 70,
    bgColor: "#FF1493", bgAdj: false,
    textLabelColor: "1", boxLabelColor: "8"
};

/* ---------------------------------------------------------------------------
   SMALL HELPERS
   --------------------------------------------------------------------------- */
function $id(id) { return document.getElementById(id); }

function capAlert(message) {
    var el = $id('cap-alert-message');
    if (el) el.innerText = message;
    var ov = $id('cap-alert-overlay');
    if (ov) ov.style.display = 'flex';
}
window.captionCloseAlert = function() {
    var ov = $id('cap-alert-overlay');
    if (ov) ov.style.display = 'none';
};

function capEval(script, cb) {
    if (!window.csInterface) { console.warn('[Caption] CSInterface unavailable.'); return; }
    window.csInterface.evalScript(script, function(res) { if (cb) cb(res); });
}

function capAeSafePath(p) {
    if (!p) return "";
    var parts = p.replace(/\\/g, '/').split('/');
    for (var i = 0; i < parts.length; i++) {
        if (i === 0 && parts[i].indexOf(':') !== -1) continue;
        parts[i] = encodeURIComponent(parts[i]);
    }
    return parts.join('/');
}

window.captionOpenURL = function(url) {
    try {
        if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
            window.cep.util.openURLInDefaultBrowser(url); return;
        } else if (window.csInterface) {
            window.csInterface.openURLInDefaultBrowser(url); return;
        }
    } catch (e) {}
    try {
        if (!exec || !os) return;
        var platform = os.platform();
        if (platform === 'darwin') { exec('open "' + url + '"', { windowsHide: true }); }
        else if (platform === 'win32') { exec('start "" "' + url + '"', { windowsHide: true }); }
    } catch (err) {}
};

/* ---------------------------------------------------------------------------
   NODE + PATH BOOTSTRAP
   --------------------------------------------------------------------------- */
function initNode() {
    var isCEP = (typeof window.__adobe_cep__ !== "undefined");
    if (!isCEP || typeof require === 'undefined') {
        console.warn('[Caption] Node.js unavailable - Caption backend disabled.');
        return false;
    }
    try {
        fs = require('fs');
        path = require('path');
        os = require('os');
        https = require('https');
        var childProcess = require('child_process');
        spawn = childProcess.spawn;
        exec = childProcess.exec;
    } catch (e) {
        console.warn('[Caption] Node.js handles failed.', e);
        return false;
    }
    return true;
}

function initPaths() {
    var rawPath = window.csInterface.getSystemPath(SystemPath.EXTENSION);
    rawPath = decodeURI(rawPath).replace(/^file:[/\\]+/, '');
    if (os.platform() === 'win32' && rawPath.charAt(0) === '/') rawPath = rawPath.substring(1);

    extensionRoot = path.normalize(rawPath);
    isMac = (os.platform() === 'darwin');

    applyPresetsDir();
    capRegisterDeps();
    capRefreshEngine();
}

/* ---------------------------------------------------------------------------
   PRESETS FOLDER
   Default %APPDATA%\RFX\Caption (changeable in Caption settings), one subfolder per
   preset kind. The old RFX Suite folder is never moved or deleted: the settings can
   copy its presets in ("Import"), keeping anything already there.
   --------------------------------------------------------------------------- */
var CAP_SUBFOLDERS        = { effect: 'Effect Presets', styles: 'Text Styles', formats: 'Format Presets',
                              boxPresets: 'Box Presets', boxFormats: 'Box Formats', styleFormats: 'Style Formats' };
var CAP_LEGACY_SUBFOLDERS = { effect: 'Effect Preset', styles: 'Text Properties', formats: 'Formats',
                              boxPresets: 'BoxPresets', boxFormats: 'BoxFormats', styleFormats: 'StyleFormats' };
var CAP_PRESETS_DIR_KEY = 'rfxCaptionPresetsDir';     // custom presets folder (absent = default)
var CAP_IMPORT_KEY      = 'rfxCaptionLegacyImport';   // 'done' | 'dismissed' once the import offer was answered

function capAppDataPath() {
    return isMac ? path.join(os.homedir(), 'Library', 'Application Support')
                 : (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'));
}
function capDefaultPresetsDir() { return path.join(capAppDataPath(), 'RFX', 'Caption'); }
function capLegacyDataDir() { return path.join(capAppDataPath(), 'RFX Suite', 'Caption Tab'); }
function capPresetsDir() { return localStorage.getItem(CAP_PRESETS_DIR_KEY) || capDefaultPresetsDir(); }

function applyPresetsDir() {
    extDataDir = capPresetsDir();
    presetsFolder      = path.join(extDataDir, CAP_SUBFOLDERS.effect);
    stylesFolder       = path.join(extDataDir, CAP_SUBFOLDERS.styles);
    formatsFolder      = path.join(extDataDir, CAP_SUBFOLDERS.formats);
    boxPresetsFolder   = path.join(extDataDir, CAP_SUBFOLDERS.boxPresets);
    boxFormatsFolder   = path.join(extDataDir, CAP_SUBFOLDERS.boxFormats);
    styleFormatsFolder = path.join(extDataDir, CAP_SUBFOLDERS.styleFormats);
}

/* ---------------------------------------------------------------------------
   ENGINE (Faster-Whisper-XXL, speech model, FFmpeg) via js/deps.js
   Each file comes from this tab's managed install when there is one, else from the
   existing copy in bin\<platform>\caption. Re-resolved before every transcription,
   so installs and updates apply without reloading; a running job keeps the paths
   it started with.
   --------------------------------------------------------------------------- */
function capRegisterDeps() {
    if (!window.RFXDeps || window.RFXDeps.tabs().some(function(t) { return t.tab === 'caption'; })) return;
    var S = RFXDeps.sources;
    RFXDeps.register('caption', { label: 'Caption', deps: [
        { id: 'whisper', label: 'Faster-Whisper-XXL', sizeHint: '1.4 GB',
          description: 'The speech-to-text engine (Purfview, official GitHub release). No checksum is published, so the exact size is verified.',
          main: 'faster-whisper-xxl.exe', latest: S.whisperXXL(), sevenZip: '7zr', extractFactor: 2.6,
          collect: function(x, out, h) {
              var exe = h.findFile(x, 'faster-whisper-xxl.exe', 3);
              if (!exe) return;
              var src = path.dirname(exe);
              fs.readdirSync(src).forEach(function(n) { fs.renameSync(path.join(src, n), path.join(out, n)); });
          },
          verify: { args: ['--version'], lenient: true, timeout: 120000 },
          legacy: { main: 'faster-whisper-xxl.exe', require: ['_xxl_data'] } },
        { id: 'model', label: 'Speech model (large-v3)', sizeHint: '3.1 GB',
          description: 'Systran/faster-whisper-large-v3 from Hugging Face, pinned to a revision and checked file by file.',
          main: 'faster-whisper-large-v3/model.bin', filesSubdir: 'faster-whisper-large-v3',
          latest: S.huggingFace({ repo: 'Systran/faster-whisper-large-v3',
                                  files: ['config.json', 'model.bin', 'preprocessor_config.json', 'tokenizer.json', 'vocabulary.json'] }),
          updateWarning: function(c) {
              return 'Updating the model downloads ' + RFXDeps.formatBytes(c.size) + '. The current revision stays on disk (for roll back) until you delete it, so you need that much extra space for now. Continue?';
          },
          legacy: { find: function(dir) {
              var m = path.join(dir, 'models');
              return capScanForModel(m, 1) ? { dir: m, path: m } : null;
          } } },
        { id: 'ffmpeg', label: 'FFmpeg', sizeHint: '185 MB',
          description: 'Converts the comp audio for the engine (BtbN stable build, this tab\'s own copy).',
          main: 'ffmpeg.exe', latest: S.ffmpegStable(), sourceKey: 'ffmpeg-btbn', extractPatterns: ['*/bin/ffmpeg.exe'],
          collect: function(x, out, h) { var f = h.findFile(x, 'ffmpeg.exe', 4); if (f) h.moveInto(f, path.join(out, 'ffmpeg.exe')); },
          verify: { args: ['-version'], expect: /ffmpeg version/ },
          legacy: { main: 'ffmpeg.exe' } },
        { id: '7zr', label: '7-Zip extractor', hidden: true,
          description: 'Only used when Windows cannot extract the engine archive itself.',
          main: '7zr.exe', latest: S.githubLatest({ repo: 'ip7z/7zip', asset: /^7zr\.exe$/ }),
          verify: { args: [], expect: /7-Zip/ } }
    ] });
}

function capRefreshEngine() {
    binDir = path.join(extensionRoot, 'bin', isMac ? 'mac' : 'win', 'caption');
    ffmpegExe = path.join(binDir, isMac ? 'ffmpeg' : 'ffmpeg.exe');
    whisperExe = path.join(binDir, isMac ? 'faster-whisper-xxl' : 'faster-whisper-xxl.exe');
    // Only these small folders are checked. Scanning binDir or extensionRoot would walk
    // the whole _xxl_data runtime (thousands of files) on every run.
    modelSearchRoots = [path.join(binDir, 'models'), path.join(extensionRoot, 'models')];
    cacheDir = path.join(extDataDir, 'cache');
    if (window.RFXDeps) {
        var w = RFXDeps.resolve('caption', 'whisper');
        if (w.path) whisperExe = w.path;
        var f = RFXDeps.resolve('caption', 'ffmpeg');
        if (f.path) ffmpegExe = f.path;
        var m = RFXDeps.resolve('caption', 'model');
        if (m.state === 'managed') modelSearchRoots.unshift(m.dir);
        cacheDir = path.join(RFXDeps.tabRoot('caption'), 'cache');   // engine scratch space, not presets
    }
    capModelDirCache = undefined;
}

function ensureFolders() {
    var dirs = [extDataDir, cacheDir, presetsFolder, stylesFolder, formatsFolder,
                boxPresetsFolder, boxFormatsFolder, styleFormatsFolder];
    for (var i = 0; i < dirs.length; i++) {
        try { if (!fs.existsSync(dirs[i])) fs.mkdirSync(dirs[i], { recursive: true }); } catch(e) {}
    }
}

function buildSecureEnv() {
    return Object.assign({}, process.env, {
        HF_HOME: cacheDir,
        HUGGINGFACE_HUB_CACHE: cacheDir,
        XDG_CACHE_HOME: cacheDir,
        USERPROFILE: cacheDir,
        HOME: cacheDir,
        TEMP: cacheDir,
        TMP: cacheDir
    });
}

/* Model folders come in several shapes:
     faster-whisper-large-v3                       (Purfview layout)
     models--Systran--faster-whisper-large-v3      (HuggingFace cache layout)
   Only directories reach this check, so faster-whisper-xxl.exe can never match;
   the engine's own "faster-whisper-xxl" folder name is excluded explicitly. */
function capIsModelFolder(name) {
    var n = name.toLowerCase();
    if (n === 'faster-whisper-xxl') return false;
    return n.indexOf('faster-whisper') !== -1;
}

/* Returns the PARENT directory of the model folder, which is what --model_dir wants. */
function capScanForModel(dir, depth) {
    if (depth < 0) return null;
    var entries;
    try { entries = fs.readdirSync(dir); } catch(e) { return null; }

    var subDirs = [];
    for (var i = 0; i < entries.length; i++) {
        var full = path.join(dir, entries[i]);
        try { if (!fs.statSync(full).isDirectory()) continue; } catch(e) { continue; }
        if (capIsModelFolder(entries[i])) return dir;
        subDirs.push(full);
    }
    for (var j = 0; j < subDirs.length; j++) {
        var found = capScanForModel(subDirs[j], depth - 1);
        if (found) return found;
    }
    return null;
}

/* The engine programs the Caption tab needs (managed install or bin/<plat>/caption).
   The model is checked separately by resolveModelDir(). */
function capMissingEngineFiles() {
    var missing = [];
    try {
        if (!fs.existsSync(whisperExe)) missing.push('Faster-Whisper-XXL');
        else if (!fs.existsSync(path.join(path.dirname(whisperExe), '_xxl_data'))) missing.push('Faster-Whisper-XXL (its _xxl_data folder is missing)');
        if (!fs.existsSync(ffmpegExe)) missing.push('FFmpeg');
    } catch(e) { missing.push('(engine folder unreadable: ' + path.dirname(whisperExe) + ')'); }
    return missing;
}
function resolveModelDir() {
    if (capModelDirCache !== undefined) return capModelDirCache;
    capModelDirCache = null;
    for (var i = 0; i < modelSearchRoots.length; i++) {
        var found = capScanForModel(modelSearchRoots[i], 1);
        if (found) { capModelDirCache = found; break; }
    }
    return capModelDirCache;
}

/* ---------------------------------------------------------------------------
   JSX LOADER  (option A - $.evalFile, verified with capPing)
   --------------------------------------------------------------------------- */
/* Loads caption.jsx into AE's shared scope by evalScript-ing its full source,
   then runs `after` once the backend confirms ready. evalScript is async in CEP,
   so we drive everything from the callback - never from a synchronous return. */
function loadCaptionBackend(after) {
    if (jsxReady) { if (after) after(true); return; }

    if (after) jsxQueue.push(after);
    if (jsxLoading) return;
    jsxLoading = true;

    if (!nodeReady || !window.csInterface) { finishBackendLoad(false); return; }

    var src;
    try {
        var jsxPath = path.join(extensionRoot, 'jsx', 'caption.jsx');
        if (!fs.existsSync(jsxPath)) { console.warn('[Caption] caption.jsx not found at ' + jsxPath); finishBackendLoad(false); return; }
        src = fs.readFileSync(jsxPath, 'utf8');
    } catch (e) {
        console.warn('[Caption] could not read caption.jsx: ' + e);
        finishBackendLoad(false);
        return;
    }

    var wrapper = 'eval(decodeURIComponent("' + encodeURIComponent(src) + '"));' +
                  '(typeof capPing==="function")?capPing():"CAPTION_LOAD_FAILED";';

    window.csInterface.evalScript(wrapper, function(r) {
        if (r !== "CAPTION_READY") console.warn('[Caption] backend load returned: ' + r);
        finishBackendLoad(r === "CAPTION_READY");
    });
}

function finishBackendLoad(ok) {
    jsxReady = ok;
    jsxLoading = false;
    var q = jsxQueue.slice();
    jsxQueue = [];
    for (var i = 0; i < q.length; i++) { try { q[i](ok); } catch (e) {} }
}

/* Direct call into the backend. Ensures it's loaded first, then runs the script.
   onFail runs only if the backend genuinely could not load. */
function capHost(script, cb, onFail) {
    loadCaptionBackend(function(ok) {
        if (!ok) {
            if (onFail) onFail();
            else capAlert("Caption backend failed to load.\n\nCheck that jsx/caption.jsx exists in the extension folder.");
            return;
        }
        capEval(script, cb);
    });
}

/* Clears a previous backend failure so an explicit user action can retry. */
function capResetBackend() { /* no failure latch to clear in the direct-load model */ }

/* ---------------------------------------------------------------------------
   SETTINGS
   --------------------------------------------------------------------------- */
function loadSettings() {
    try {
        var saved = localStorage.getItem(SETTINGS_KEY);
        var s = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;

        $id('cap-set-chars').value = s.chars;
        $id('cap-chars-val').value = s.chars;
        $id('cap-set-mindur').value = s.minDur;
        $id('cap-mindur-val').value = s.minDur;
        $id('cap-set-gap').value = s.gap;
        $id('cap-gap-val').value = s.gap;

        var linesRadios = document.getElementsByName('cap-set-lines');
        Array.prototype.forEach.call(linesRadios, function(r) { if (r.value === s.lines) r.checked = true; });

        $id('cap-punc-comma').checked    = s.puncComma    !== undefined ? s.puncComma    : true;
        $id('cap-punc-period').checked   = s.puncPeriod   !== undefined ? s.puncPeriod   : true;
        $id('cap-punc-question').checked = s.puncQuestion !== undefined ? s.puncQuestion : false;
        $id('cap-punc-exclaim').checked  = s.puncExclaim  !== undefined ? s.puncExclaim  : false;

        if (s.bgEnable !== undefined) $id('cap-set-bg-enable').checked = s.bgEnable;
        if (s.bgPadX !== undefined)   { $id('cap-set-bg-padx').value = s.bgPadX;   $id('cap-bg-px-val').value = s.bgPadX; }
        if (s.bgPadY !== undefined)   { $id('cap-set-bg-pady').value = s.bgPadY;   $id('cap-bg-py-val').value = s.bgPadY; }
        if (s.bgRound !== undefined)  { $id('cap-set-bg-round').value = s.bgRound; $id('cap-bg-rnd-val').value = s.bgRound; }
        if (s.bgOpacity !== undefined){ $id('cap-set-bg-opacity').value = s.bgOpacity; $id('cap-bg-op-val').value = s.bgOpacity; }
        if (s.bgAdj !== undefined)    $id('cap-set-bg-adj').checked = s.bgAdj;

        if (s.bgColor !== undefined) {
            $id('cap-set-bg-color').value = s.bgColor;
            $id('cap-visual-color-box').style.backgroundColor = s.bgColor;
        }
        if (s.textLabelColor !== undefined) {
            var el = $id('cap-color-select'); if (el) el.value = s.textLabelColor;
        }
        if (s.boxLabelColor !== undefined) {
            var bel = $id('cap-box-color-select'); if (bel) bel.value = s.boxLabelColor;
        }
    } catch(e) {}
}

function saveSettings() {
    try {
        var linesEl = document.querySelector('input[name="cap-set-lines"]:checked');
        var settings = {
            chars: $id('cap-set-chars').value,
            minDur: $id('cap-set-mindur').value,
            gap: $id('cap-set-gap').value,
            lines: linesEl ? linesEl.value : 'single',
            puncComma: $id('cap-punc-comma').checked,
            puncPeriod: $id('cap-punc-period').checked,
            puncQuestion: $id('cap-punc-question').checked,
            puncExclaim: $id('cap-punc-exclaim').checked,
            bgEnable: $id('cap-set-bg-enable').checked,
            bgPadX: $id('cap-set-bg-padx').value,
            bgPadY: $id('cap-set-bg-pady').value,
            bgRound: $id('cap-set-bg-round').value,
            bgOpacity: $id('cap-set-bg-opacity').value,
            bgColor: $id('cap-set-bg-color').value,
            bgAdj: $id('cap-set-bg-adj').checked,
            textLabelColor: $id('cap-color-select') ? $id('cap-color-select').value : "1",
            boxLabelColor: $id('cap-box-color-select') ? $id('cap-box-color-select').value : "8"
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch(e) {}
}

/* ---------------------------------------------------------------------------
   SUB-TAB DRAG REORDER  (mirrors the shell's global tab drag, scoped to caption)
   --------------------------------------------------------------------------- */
var capIsDraggingSubTab = false;

function saveCaptionTabOrder() {
    try {
        var ids = Array.prototype.map.call(document.querySelectorAll('#caption-tabs-header .tab-btn'), function(t){ return t.id; });
        localStorage.setItem('rfxCaptionSubTabOrder', JSON.stringify(ids));
    } catch(e) {}
}

function loadCaptionTabOrder() {
    try {
        var orderStr = localStorage.getItem('rfxCaptionSubTabOrder');
        if (!orderStr) return;
        var order = JSON.parse(orderStr);
        var container = $id('caption-tabs-header');
        if (!container) return;
        order.forEach(function(id) { var t = $id(id); if (t) container.appendChild(t); });
    } catch(e) {}
}

function initCaptionTabScroll() {
    var container = $id('caption-tabs-header');
    if (container) container.addEventListener('wheel', function(e) {
        if (container.scrollWidth > container.clientWidth) { e.preventDefault(); container.scrollLeft += (e.deltaY * 0.8); }
    });
}

function initCaptionTabDrag() {
    var container = $id('caption-tabs-header');
    if (!container) return;

    /* Identity transform. NEVER set transform back to '' — going from a
       transform to no-transform destroys the compositing layer, and Chromium
       re-rounds the element's fractional Y offset when that happens. That
       round-trip is the vertical "settle" you see on mouse-up. Parking every
       tab on translate3d(0,0,0) keeps the layer alive permanently, so the
       Y position never changes. */
    var IDENTITY = 'translate3d(0px, 0px, 0px)';

    var draggedItem = null, startX = 0, currentX = 0, siblings = [], startIndex = 0, currentIndex = 0, shiftAmount = 0;
    var startScrollLeft = 0, lastPointerX = 0, dragHomeLeft = 0, activePointerId = null;
    var edgeScrollRAF = null, edgeScrollDir = 0, edgeScrollSpeed = 0;

    var EDGE_ZONE = 45;
    var EDGE_MAX_SPEED = 6;
    var EDGE_MIN_SPEED = 0.6;

    function clampX(rawX) {
        var cRect = container.getBoundingClientRect();
        var cs = getComputedStyle(container);
        var padL = parseFloat(cs.paddingLeft) || 0;
        var padR = padL;
        var homeNow = dragHomeLeft - (container.scrollLeft - startScrollLeft);
        var minX = (cRect.left + padL) - homeNow;
        var maxX = (cRect.right - padR) - draggedItem.offsetWidth - homeNow;
        return Math.max(minX, Math.min(maxX, rawX));
    }

    function applyDragTransform() {
        var rawX = (lastPointerX - startX) + (container.scrollLeft - startScrollLeft);
        /* Fractional is correct now that the layer is permanently parked. The
           old 1px wobble was the layer being created/destroyed on each drag,
           not sub-pixel motion - so rounding is no longer needed, and keeping
           the value exact is what makes the release land with zero correction. */
        currentX = clampX(rawX);
        draggedItem.style.transform = 'translate3d(' + currentX + 'px, 0px, 0px)';
        reflowSiblings(rawX);
    }

    function reflowSiblings(rawX) {
        var homeNow = dragHomeLeft - (container.scrollLeft - startScrollLeft);
        var draggedCenter = homeNow + rawX + (draggedItem.offsetWidth / 2);
        var newIndex = startIndex;
        siblings.forEach(function(sib) {
            if (sib.index === startIndex) return;
            var sibCenter = (sib.rect.left + sib.rect.width / 2) - (container.scrollLeft - startScrollLeft);
            var shift = 0;
            if (startIndex < sib.index && draggedCenter > sibCenter) { shift = -shiftAmount; newIndex = Math.max(newIndex, sib.index); }
            else if (startIndex > sib.index && draggedCenter < sibCenter) { shift = shiftAmount; newIndex = Math.min(newIndex, sib.index); }
            if (sib.shift !== shift) {
                sib.shift = shift;
                /* translate3d (not translateX) so siblings stay on the same
                   layer type as the dragged tab — mixing 2D and 3D transforms
                   promotes/demotes layers mid-drag and nudges them in Y. */
                sib.el.style.transform = 'translate3d(' + shift + 'px, 0px, 0px)';
                sib.el.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
            }
        });
        currentIndex = newIndex;
    }

    function edgeScrollStep() {
        if (!draggedItem || edgeScrollDir === 0) { edgeScrollRAF = null; return; }
        var before = container.scrollLeft;
        container.scrollLeft += edgeScrollDir * edgeScrollSpeed;
        if (container.scrollLeft !== before) applyDragTransform();
        else { edgeScrollRAF = null; return; }
        edgeScrollRAF = requestAnimationFrame(edgeScrollStep);
    }

    function updateEdgeScroll(clientX) {
        var rect = container.getBoundingClientRect();
        var canLeft = container.scrollLeft > 0;
        var canRight = container.scrollLeft < (container.scrollWidth - container.clientWidth);
        var depth = 0;
        if (clientX < rect.left + EDGE_ZONE && canLeft) { edgeScrollDir = -1; depth = (rect.left + EDGE_ZONE - clientX) / EDGE_ZONE; }
        else if (clientX > rect.right - EDGE_ZONE && canRight) { edgeScrollDir = 1; depth = (clientX - (rect.right - EDGE_ZONE)) / EDGE_ZONE; }
        else { edgeScrollDir = 0; }
        if (edgeScrollDir !== 0) {
            depth = Math.max(0, Math.min(1, depth));
            edgeScrollSpeed = EDGE_MIN_SPEED + (EDGE_MAX_SPEED - EDGE_MIN_SPEED) * (depth * depth);
            if (edgeScrollRAF === null) edgeScrollRAF = requestAnimationFrame(edgeScrollStep);
        }
    }

    function stopEdgeScroll() {
        edgeScrollDir = 0;
        if (edgeScrollRAF !== null) { cancelAnimationFrame(edgeScrollRAF); edgeScrollRAF = null; }
    }

    function finishDrag() {
        if (!draggedItem) return;
        stopEdgeScroll();

        var item = draggedItem;
        var allEls = [item].concat(siblings.map(function(s){ return s.el; }));

        if (capIsDraggingSubTab) {
            /* FLIP - First: record where every tab is rendered RIGHT NOW, at
               the exact pixel you released. These are fractional. */
            var firstLeft = allEls.map(function(el){ return el.getBoundingClientRect().left; });

            allEls.forEach(function(el){ el.style.transition = 'none'; });
            if (currentIndex !== startIndex) {
                var targetSibling = siblings[currentIndex].el;
                if (currentIndex > startIndex) container.insertBefore(item, targetSibling.nextSibling);
                else container.insertBefore(item, targetSibling);
            }
            item.classList.remove('dragging');

            allEls.forEach(function(el){ el.style.transform = IDENTITY; });
            void container.offsetWidth;

            /* Last + Invert. NO rounding: dx is the exact fractional gap between
               the rendered release position and the true slot. Rounding here
               was the flick - it forced each tab to start the settle 0.3-0.5px
               off from where it was actually drawn. */
            var lastLeft = allEls.map(function(el){ return el.getBoundingClientRect().left; });
            allEls.forEach(function(el, i){
                var dx = firstLeft[i] - lastLeft[i];
                el.style.transform = 'translate3d(' + dx + 'px, 0px, 0px)';
            });
            void container.offsetWidth;

            /* Two rAFs: the first lets the inverted state actually paint, the
               second starts the settle. Without the double frame the browser
               can collapse both writes into one and you get a flash. */
            requestAnimationFrame(function(){
                requestAnimationFrame(function(){
                    allEls.forEach(function(el){
                        el.style.transition = 'transform 0.16s cubic-bezier(0.22, 1, 0.36, 1)';
                        el.style.transform = IDENTITY;
                    });
                });
            });

            /* One deterministic cleanup just past the duration. The previous
               transitionend approach could fire on the dragged tab a hair
               before the siblings finished and cut their glide mid-flight -
               itself a tiny snap. Clearing the transition while every tab
               already rests on IDENTITY changes nothing visible. */
            setTimeout(function(){
                allEls.forEach(function(el){ el.style.transition = ''; });
            }, 200);

            saveCaptionTabOrder();
            setTimeout(function(){ capIsDraggingSubTab = false; }, 50);
        } else {
            /* No drag happened - this was a plain click. Nothing was ever
               transformed and no .dragging class was added, so there is nothing
               to reset. Critically, we must NOT set transition:none here: the
               tab's onclick (switchCaptionTab) fires in the same event batch
               right after this, before any rAF runs, so killing the transition
               now makes the click's highlight snap instead of fade. */
        }

        draggedItem = null;
        siblings = [];
        activePointerId = null;
    }

    container.addEventListener('pointerdown', function(e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        var tab = e.target.closest('.tab-btn');
        if (!tab) return;
        if (draggedItem) finishDrag();

        draggedItem = tab; startX = e.clientX; lastPointerX = e.clientX; currentX = 0;
        activePointerId = e.pointerId;
        startScrollLeft = container.scrollLeft;
        dragHomeLeft = draggedItem.getBoundingClientRect().left;
        draggedItem.setPointerCapture(e.pointerId);
        var allTabs = Array.prototype.slice.call(container.querySelectorAll('.tab-btn'));
        startIndex = allTabs.indexOf(draggedItem); currentIndex = startIndex;
        var realGap = 8;
        if (allTabs.length > 1) {
            var a = allTabs[0].getBoundingClientRect(), b = allTabs[1].getBoundingClientRect();
            realGap = Math.max(0, b.left - a.right);
        }
        /* Exact, unrounded. The preview shift must equal each sibling's true
           final slot to the sub-pixel; if it is rounded, every sibling has to
           correct by up to ~0.5px on release, and all of them doing that at
           once is the residual flick. Unrounded, the siblings do not move on
           release at all. */
        shiftAmount = draggedItem.getBoundingClientRect().width + realGap;
        siblings = allTabs.map(function(t, index) { return { el: t, index: index, rect: t.getBoundingClientRect(), shift: 0 }; });
    });

    container.addEventListener('pointermove', function(e) {
        if (!draggedItem || e.pointerId !== activePointerId) return;
        var deltaX = e.clientX - startX;
        if (Math.abs(deltaX) > 4 || capIsDraggingSubTab) {
            capIsDraggingSubTab = true;
            if (!draggedItem.classList.contains('dragging')) draggedItem.classList.add('dragging');
            draggedItem.style.transition = 'none';
            lastPointerX = e.clientX;
            updateEdgeScroll(e.clientX);
            applyDragTransform();
        }
    });

    container.addEventListener('pointerup', function(e) {
        if (!draggedItem || e.pointerId !== activePointerId) return;
        if (draggedItem.hasPointerCapture && draggedItem.hasPointerCapture(e.pointerId)) {
            draggedItem.releasePointerCapture(e.pointerId);
        }
        finishDrag();
    });

    /* Without this, a cancelled pointer (window focus loss, AE stealing the
       mouse, touch cancel) leaves tabs stuck mid-transform forever. */
    container.addEventListener('pointercancel', function(e) {
        if (!draggedItem || e.pointerId !== activePointerId) return;
        capIsDraggingSubTab = false;
        finishDrag();
    });
}

/* ---------------------------------------------------------------------------
   SUB-TAB ENGINE
   --------------------------------------------------------------------------- */
window.switchCaptionTab = function(tabId) {
    if (capIsDraggingSubTab) return;
    document.querySelectorAll('#tab-caption .cap-tab-content').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('#caption-tabs-header .tab-btn').forEach(function(b) { b.classList.remove('active'); });

    var targetTab = $id(tabId);
    var targetBtn = $id('btn-' + tabId);
    if (targetTab && targetBtn) {
        targetTab.classList.add('active');
        targetBtn.classList.add('active');
    }
    if (tabId === 'cap-editor') window.captionRefreshEditorTimeline();
};

/* Re-highlight the sub-tab button for whichever sub-tab is currently open.
   Needed because the global switchTab() in globals.js clears .active off every
   .tab-btn, and the caption sub-tabs share that class - so switching global
   tabs strips their highlight even though the sub-tab content stays active. */
function captionSyncSubTabHighlight() {
    var host = $id('tab-caption');
    if (!host) return;
    var activeContent = host.querySelector('.cap-tab-content.active');
    if (!activeContent) return;
    var btn = $id('btn-' + activeContent.id);
    if (!btn) return;
    var btns = document.querySelectorAll('#caption-tabs-header .tab-btn');
    /* Restoring the selection on tab-switch must be instant. Suppress each
       button's highlight transition, apply the active class, commit it with a
       forced reflow, then restore the transition so real clicks still animate. */
    btns.forEach(function(b) { b.style.transition = 'none'; });
    btns.forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    void host.offsetWidth;
    btns.forEach(function(b) { b.style.transition = ''; });
}

function isCaptionEditorVisible() {
    var tab = $id('tab-caption');
    var sub = $id('cap-editor');
    return !!(tab && tab.classList.contains('active') && sub && sub.classList.contains('active'));
}

/* ---------------------------------------------------------------------------
   PRIVATE NUMPAD  (adds "." and "-", plus min/max clamping)
   --------------------------------------------------------------------------- */
window.captionSyncSliderToInput = function(sliderId, inputId) {
    if (capIsSyncing) return;
    var sliderEl = $id(sliderId), inputEl = $id(inputId);
    if (!sliderEl || !inputEl) return;
    if (document.activeElement === inputEl) return;

    if (inputEl.dataset.cleared === "true" && document.activeElement !== sliderEl) {
        inputEl.value = sliderEl.min;
        sliderEl.value = sliderEl.min;
        inputEl.dataset.cleared = "false";
        capIsSyncing = true; sliderEl.dispatchEvent(new Event('input')); capIsSyncing = false;
        saveSettings();
        return;
    }

    inputEl.value = sliderEl.value;
    inputEl.dataset.cleared = "false";
    capIsSyncing = true; sliderEl.dispatchEvent(new Event('input')); capIsSyncing = false;
    saveSettings();
};

window.captionSyncInputToSlider = function(inputId, sliderId) {
    var inputEl = $id(inputId), sliderEl = $id(sliderId);
    if (!sliderEl || !inputEl) return;

    var val = parseFloat(inputEl.value);
    if (isNaN(val) || inputEl.value === "") { inputEl.dataset.cleared = "true"; return; }

    inputEl.dataset.cleared = "false";
    capIsSyncing = true; sliderEl.value = val; sliderEl.dispatchEvent(new Event('input')); capIsSyncing = false;
    saveSettings();
};

function capNumpadKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); window.captionCloseNumpad(); }
}

window.captionOpenNumpad = function(inputId, sliderId, wrapperId) {
    capNumpadInput = $id(inputId);
    capNumpadSlider = $id(sliderId);
    if (!capNumpadInput || !capNumpadSlider) return;

    if (capNumpadWrapper) capNumpadWrapper.classList.remove('active');
    capNumpadWrapper = $id(wrapperId);
    if (capNumpadWrapper) capNumpadWrapper.classList.add('active');

    var numpad = $id('cap-numpad');
    numpad.style.top = ''; numpad.style.left = '';
    numpad.classList.add('active');
    capNumpadInput.select();

    capNumpadInput.addEventListener('keydown', capNumpadKeydown);
    setTimeout(function() { document.addEventListener('click', capCloseNumpadOutside); }, 10);
};

function capCloseNumpadOutside(e) {
    var numpad = $id('cap-numpad');
    if (!numpad) return;
    if (!numpad.contains(e.target) && (!capNumpadWrapper || !capNumpadWrapper.contains(e.target))) {
        window.captionCloseNumpad();
    }
}

window.captionCloseNumpad = function() {
    var numpad = $id('cap-numpad');
    if (numpad) numpad.classList.remove('active');
    document.removeEventListener('click', capCloseNumpadOutside);

    if (capNumpadWrapper) capNumpadWrapper.classList.remove('active');

    if (capNumpadInput && capNumpadSlider) {
        capNumpadInput.removeEventListener('keydown', capNumpadKeydown);

        var val = parseFloat(capNumpadInput.value);
        if (isNaN(val) || capNumpadInput.value === "") {
            capNumpadInput.value = capNumpadSlider.min;
        } else if (val < parseFloat(capNumpadSlider.min)) {
            capNumpadInput.value = capNumpadSlider.min;
        } else if (val > parseFloat(capNumpadSlider.max)) {
            capNumpadInput.value = capNumpadSlider.max;
        }

        window.captionSyncInputToSlider(capNumpadInput.id, capNumpadSlider.id);
        capNumpadInput.blur();
    }

    capNumpadInput = null; capNumpadSlider = null; capNumpadWrapper = null;
};

window.captionNumpadPress = function(val) {
    if (!capNumpadInput) return;

    if (capNumpadInput.selectionStart === 0 && capNumpadInput.selectionEnd === capNumpadInput.value.length) {
        capNumpadInput.value = "";
    }

    var currentVal = capNumpadInput.value;
    if (val === 'AC') { currentVal = ''; }
    else if (val === 'OK') { window.captionCloseNumpad(); return; }
    else { currentVal += val; }

    capNumpadInput.value = currentVal;
    window.captionSyncInputToSlider(capNumpadInput.id, capNumpadSlider.id);
    capNumpadInput.focus();
};

/* ---------------------------------------------------------------------------
   TIME HELPERS + SRT PARSING
   --------------------------------------------------------------------------- */
function formatSRTTime(seconds) {
    var d = new Date(seconds * 1000);
    var hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    var mm = String(d.getUTCMinutes()).padStart(2, '0');
    var ss = String(d.getUTCSeconds()).padStart(2, '0');
    var ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return hh + ':' + mm + ':' + ss + ',' + ms;
}

function srtTimeToSeconds(timeStr) {
    var parts = timeStr.split(',');
    var mainParts = parts[0].split(':');
    var sec = 0;
    if (mainParts.length === 3) {
        sec += parseInt(mainParts[0], 10) * 3600;
        sec += parseInt(mainParts[1], 10) * 60;
        sec += parseInt(mainParts[2], 10);
    }
    if (parts.length === 2) sec += parseInt(parts[1], 10) / 1000;
    return sec;
}

function buildTimeRow(startStr, endStr, startCls, endCls) {
    return '' +
    '<div class="cap-srt-times">' +
        '<div class="cap-srt-time-box">' +
            '<span class="cap-srt-time-label">IN</span>' +
            '<input type="text" class="' + startCls + ' cap-srt-time-input" value="' + startStr + '">' +
        '</div>' +
        '<div class="cap-srt-time-box">' +
            '<span class="cap-srt-time-label">OUT</span>' +
            '<input type="text" class="' + endCls + ' cap-srt-time-input" value="' + endStr + '">' +
        '</div>' +
    '</div>';
}

function renderSRTUI(chunks) {
    var list = $id('cap-srt-list');
    list.innerHTML = '';
    chunks.forEach(function(c) {
        var row = document.createElement('div');
        row.className = 'cap-srt-row';
        row.innerHTML =
            '<div class="cap-srt-text">' +
                '<textarea class="cap-srt-text-input" spellcheck="false" rows="2">' + c.text + '</textarea>' +
            '</div>' +
            buildTimeRow(formatSRTTime(c.start), formatSRTTime(c.end), 'cap-srt-time-start', 'cap-srt-time-end');
        list.appendChild(row);
    });
}

function getChunksFromUI() {
    var chunks = [];
    document.querySelectorAll('#cap-srt-list .cap-srt-row').forEach(function(row) {
        chunks.push({
            start: srtTimeToSeconds(row.querySelector('.cap-srt-time-start').value),
            end: srtTimeToSeconds(row.querySelector('.cap-srt-time-end').value),
            text: row.querySelector('.cap-srt-text-input').value.trim()
        });
    });
    return chunks;
}

function parseFasterWhisperData(rawJsonString, renderStartOffset) {
    var data = JSON.parse(rawJsonString);
    var wordsArray = [];
    var segments = Array.isArray(data) ? data : (data.segments || []);

    segments.forEach(function(segment) {
        if (segment.words && segment.words.length > 0) {
            segment.words.forEach(function(w) {
                var cleanText = w.word.trim();
                if (!cleanText) return;
                var startSec = parseFloat(w.start) + renderStartOffset;
                var endSec = parseFloat(w.end) + renderStartOffset;
                var wordDur = endSec - startSec;
                if (wordDur > 1.2) endSec = startSec + 1.2;
                wordsArray.push({ text: cleanText, start: startSec, end: endSec });
            });
        }
    });

    wordsArray.forEach(function(w) { if (w.end <= w.start) w.end = w.start + 0.05; });
    return wordsArray;
}

function groupWordsIntoChunks(wordsArray, fps) {
    if (wordsArray.length === 0) return [];

    var maxChars = parseInt($id('cap-set-chars').value, 10);
    var minDur = parseFloat($id('cap-set-mindur').value);
    var gapFrames = parseInt($id('cap-set-gap').value, 10);
    var linesMode = document.querySelector('input[name="cap-set-lines"]:checked').value;

    var rmComma    = $id('cap-punc-comma').checked;
    var rmPeriod   = $id('cap-punc-period').checked;
    var rmQuestion = $id('cap-punc-question').checked;
    var rmExclaim  = $id('cap-punc-exclaim').checked;

    var gapSec = gapFrames / fps;
    var effectiveMaxChars = linesMode === 'double' ? maxChars * 2 : maxChars;

    var chunks = [];
    var currentChunk = null;

    for (var i = 0; i < wordsArray.length; i++) {
        var wOriginal = wordsArray[i];
        var wText = wOriginal.text;

        if (rmComma) wText = wText.replace(/,/g, '');
        if (rmPeriod) wText = wText.replace(/\./g, '');
        if (rmQuestion) wText = wText.replace(/\?/g, '');
        if (rmExclaim) wText = wText.replace(/!/g, '');
        wText = wText.trim();

        if (wText.length === 0) continue;

        if (!currentChunk) {
            currentChunk = { start: wOriginal.start, end: wOriginal.end, text: wText };
        } else {
            var potentialText = currentChunk.text + " " + wText;
            var hitCharLimit = potentialText.length > effectiveMaxChars;
            var gapToNextWord = wOriginal.start - currentChunk.end;
            var isLongPause = gapToNextWord > 0.4;
            var prevOriginal = wordsArray[i - 1].text;
            var isSentenceEnd = /[.?!]/.test(prevOriginal);

            if (hitCharLimit || isLongPause || isSentenceEnd) {
                chunks.push(currentChunk);
                currentChunk = { start: wOriginal.start, end: wOriginal.end, text: wText };
            } else {
                currentChunk.text = potentialText;
                currentChunk.end = wOriginal.end;
            }
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    for (var j = 0; j < chunks.length; j++) {
        var current = chunks[j];
        var next = chunks[j + 1];
        var originalEnd = current.end;
        var currentDur = current.end - current.start;

        if (currentDur < minDur) {
            var desiredEnd = current.start + minDur;
            if (next) { current.end = Math.min(desiredEnd, next.start); }
            else { current.end = Math.min(desiredEnd, originalEnd + 1.5); }
        }

        if (gapSec > 0) {
            if (next && current.end > next.start - gapSec) { current.end = next.start - gapSec; }
            else if (!next) { current.end -= gapSec; }
        }

        if (current.end <= current.start) current.end = current.start + 0.05;
    }

    chunks.forEach(function(c) {
        if (linesMode === 'double' && c.text.length > maxChars) {
            var middle = Math.floor(c.text.length / 2);
            var before = c.text.lastIndexOf(' ', middle);
            var after = c.text.indexOf(' ', middle + 1);

            var splitPos = -1;
            if (before === -1 && after !== -1) splitPos = after;
            else if (after === -1 && before !== -1) splitPos = before;
            else if (before !== -1 && after !== -1) { splitPos = (middle - before < after - middle) ? before : after; }

            if (splitPos !== -1) {
                c.text = c.text.substring(0, splitPos) + "\n" + c.text.substring(splitPos + 1);
            }
        }
    });

    return chunks;
}

function applyFormatting() {
    if (capRawWordData.length === 0) return capAlert("No transcription data found. Please transcribe the timeline first.");
    renderSRTUI(groupWordsIntoChunks(capRawWordData, capCompFps));
}

function resetTranscription() {
    capRawWordData = [];
    $id('cap-srt-editor-area').style.display = 'none';
    $id('cap-engine-setup-area').style.display = 'flex';
}

/* ---------------------------------------------------------------------------
   TRANSCRIPTION PIPELINE
   --------------------------------------------------------------------------- */
window.captionStartTranscription = function() {
    capIsCancelling = false;
    capResetBackend();
    if (window.__capDiag) {
        window.__capDiag = false;
        capHost('capDiagnose()', function(res) {
            capAlert((res || "(no result)").replace(/^DIAG\|/, ""));
        }, function() { capAlert("Backend failed to load - diagnostic could not run."); });
        return;
    }

    var statusText = $id('cap-status-text');
    var btnSubmit  = $id('cap-btn-transcribe');
    var progressBar= $id('cap-progress-bar');
    var statusBox  = $id('cap-status-container');
    var cancelBtn  = $id('cap-cancel-btn');

    if (!nodeReady) return capAlert("Node.js is unavailable, so transcription cannot run.");

    var safeModelId = 'large-v3';
    var selectedLangEl = document.querySelector('input[name="cap-spoken-language"]:checked');
    var selectedLang = selectedLangEl ? selectedLangEl.value : 'auto';

    // Pick up installs/updates made since the last run; this job keeps these paths.
    capRefreshEngine();
    var missingFiles = capMissingEngineFiles();

    // Require a local model, exactly like the original extension - never let the
    // engine fall back to downloading 3 GB from HuggingFace into the cache dir.
    var modelDir = resolveModelDir();
    if (!modelDir) missingFiles.push('Speech model (large-v3)');

    if (missingFiles.length > 0) {
        return capOpenSettings('Captions need these downloads before they can run: ' + missingFiles.join(', ') +
                               '. Install them below; they come from the official sources.');
    }

    statusBox.style.display = "block";
    cancelBtn.style.display = "block";
    progressBar.classList.add('cap-indeterminate');
    progressBar.style.width = "100%";

    btnSubmit.disabled = true;
    statusText.innerText = "Exporting audio timeline...";

    var tempAeAudioPath  = path.join(os.tmpdir(), 'ae_raw_audio.wav');
    var final16kAudioPath= path.join(os.tmpdir(), 'whisper_ready_16k.wav');

    function abortExport() {
        btnSubmit.disabled = false;
        cancelBtn.style.display = "none";
        progressBar.classList.remove('cap-indeterminate');
        statusBox.style.display = "none";
    }

    capHost('capExportAudioData("' + tempAeAudioPath.replace(/\\/g, '\\\\') + '")', function(aeResult) {
        if (capIsCancelling) return;

        if (aeResult === "WAV_MISSING") {
            $id('cap-wav-overlay').style.display = 'flex';
            btnSubmit.disabled = false;
            cancelBtn.style.display = "none";
            statusBox.style.display = "none";
            progressBar.classList.remove('cap-indeterminate');
            return;
        }

        if (aeResult && aeResult.indexOf("SUCCESS|") === -1) {
            statusText.innerText = (aeResult.indexOf("RENDER_FAILED|") === 0)
                ? "Export failed: " + aeResult.substring("RENDER_FAILED|".length)
                : "Export failed. Check AE output settings.";
            btnSubmit.disabled = false;
            cancelBtn.style.display = "none";
            progressBar.classList.remove('cap-indeterminate');
            return;
        }

        var fpsString = aeResult.split("|")[2];
        var renderStartString = aeResult.split("|")[3];
        capCompFps = parseFloat(fpsString) || 30;
        var renderStartOffset = parseFloat(renderStartString) || 0;
        var actualRenderedPath = path.normalize(aeResult.split("|")[1]);

        statusText.innerText = "Formatting audio...";

        var ffmpegCmd = '"' + ffmpegExe + '" -i "' + actualRenderedPath + '" -ar 16000 -ac 1 -c:a pcm_s16le "' + final16kAudioPath + '" -y -nostats -loglevel 0';

        capFfmpegProcess = exec(ffmpegCmd, { windowsHide: true }, function(ffmpegError) {
            if (capIsCancelling) return;
            if (ffmpegError) {
                statusText.innerText = "FFmpeg error encountered.";
                btnSubmit.disabled = false;
                progressBar.classList.remove('cap-indeterminate');
                return;
            }

            statusText.innerText = "Transcribing with AI (this may take a moment)...";
            var jsonOutDir = os.tmpdir();
            var finalJsonPath = path.join(jsonOutDir, 'whisper_ready_16k.json');

            var spawnArgs = [final16kAudioPath, "--model", safeModelId];
            if (modelDir) spawnArgs.push("--model_dir", modelDir);
            spawnArgs.push("--word_timestamps", "True", "--output_format", "json", "--output_dir", jsonOutDir);

            if (selectedLang === 'en') {
                spawnArgs.push("--language", "en");
                spawnArgs.push("--condition_on_previous_text", "False");
            } else if (selectedLang === 'hinglish') {
                spawnArgs.push("--language", "en");
                spawnArgs.push("--condition_on_previous_text", "True");
                spawnArgs.push("--initial_prompt", "Haan bhai, kya haal hain? Main bilkul theek hoon. Ye video bohot accha hai. Aaj hum baat karenge naye topics par. Agar aapko pasand aaye toh like zaroor karna. Chaliye shuru karte hain bina kisi deri ke. Sirf Hinglish letters use karna.");
            } else if (selectedLang === 'roman_urdu') {
                spawnArgs.push("--language", "en");
                spawnArgs.push("--condition_on_previous_text", "True");
                spawnArgs.push("--initial_prompt", "Haan bhai, kya haal hai? Main bilkul theek hoon. Yeh video bohat acha hai. Aaj hum naye topics par baat karein ge. Agar aapko pasand aaye toh like zaroor karna. Chaliye shuru karte hain. Sirf Roman Urdu use karna.");
            } else if (selectedLang === 'pinyin') {
                spawnArgs.push("--language", "en");
                spawnArgs.push("--condition_on_previous_text", "True");
                spawnArgs.push("--initial_prompt", "Ni hao, wo de peng you. Zhe shi pinyin. Wo men jintian qu nar? Wo hen hao. Xie xie ni de bang zhu. Qing zhi shiyong pinyin.");
            } else if (selectedLang === 'romaji') {
                spawnArgs.push("--language", "en");
                spawnArgs.push("--condition_on_previous_text", "True");
                spawnArgs.push("--initial_prompt", "Konnichiwa, genki desu ka? Watashi wa totemo genki desu. Kore wa romaji desu. Kyou wa nani o shimasu ka? Arigatou gozaimasu.");
            } else if (selectedLang === 'arabish') {
                spawnArgs.push("--language", "en");
                spawnArgs.push("--condition_on_previous_text", "True");
                spawnArgs.push("--initial_prompt", "Ahlan ya sahbi, keefak? Ana kwayes alhamdulillah. Shokran jazeelan. Elyoum raah nehki an mawadee jdedeh. Yalla nebdah.");
            } else if (selectedLang === 'translit_ru') {
                spawnArgs.push("--language", "en");
                spawnArgs.push("--condition_on_previous_text", "True");
                spawnArgs.push("--initial_prompt", "Privet kak dela? U menya vse horosho. Eto russkiy tekst latinitsey. Segodnya mi pogovorim o novom. Spasibo za prosmotr.");
            } else {
                spawnArgs.push("--condition_on_previous_text", "False");
            }

            var spawnOptions = { cwd: cacheDir, env: buildSecureEnv(), stdio: ['ignore','pipe','pipe'], windowsHide: true };
            capWhisperProcess = spawn(whisperExe, spawnArgs, spawnOptions);

            var capWhisperLog = "";
            if (capWhisperProcess.stdout) capWhisperProcess.stdout.on('data', function(d){ capWhisperLog += d.toString(); });
            if (capWhisperProcess.stderr) capWhisperProcess.stderr.on('data', function(d){ capWhisperLog += d.toString(); });

            capWhisperProcess.on('error', function(err){
                capAlert("Whisper could not start:\n\n" + err.message + "\n\nCommand:\n" + whisperExe);
            });

            capWhisperProcess.on('close', function(code) {
                if (capIsCancelling) return;
                progressBar.classList.remove('cap-indeterminate');

                if (code !== 0 && !fs.existsSync(finalJsonPath)) {
                    statusText.innerText = "Transcription failed (exit " + code + ").";
                    btnSubmit.disabled = false;
                    capAlert("Whisper exited with code " + code + " and produced no output.\n\n" +
                             "Command:\n" + whisperExe + " " + spawnArgs.join(" ") + "\n\n" +
                             "Engine output (last part):\n" +
                             (capWhisperLog ? capWhisperLog.slice(-1500) : "(no output captured)"));
                    return;
                }

                statusText.innerText = "Data compiled.";
                cancelBtn.style.display = "none";

                try {
                    var rawWhisperData = fs.readFileSync(finalJsonPath, 'utf8');
                    capRawWordData = parseFasterWhisperData(rawWhisperData, renderStartOffset);
                    applyFormatting();

                    setTimeout(function() {
                        $id('cap-engine-setup-area').style.display = 'none';
                        $id('cap-srt-editor-area').style.display = 'flex';
                        btnSubmit.disabled = false;
                        statusBox.style.display = "none";

                        $id('cap-btn-generate-extra-setup').style.display = 'block';
                        $id('cap-btn-generate-import-setup').style.flex = '2';
                    }, 500);

                    if (fs.existsSync(actualRenderedPath)) fs.unlinkSync(actualRenderedPath);
                    if (fs.existsSync(final16kAudioPath)) fs.unlinkSync(final16kAudioPath);
                    if (fs.existsSync(finalJsonPath)) fs.unlinkSync(finalJsonPath);
                } catch (e) {
                    statusText.innerText = "Error reading timestamp data.";
                    btnSubmit.disabled = false;
                }
            });
        });
    }, abortExport);
};

window.captionCancelTranscription = function() {
    capIsCancelling = true;
    $id('cap-status-text').innerText = "Cancelling...";

    if (capFfmpegProcess) { try { capFfmpegProcess.kill('SIGKILL'); } catch(e){} }
    if (capWhisperProcess) { try { capWhisperProcess.kill('SIGKILL'); } catch(e){} }

    setTimeout(function() {
        $id('cap-status-container').style.display = 'none';
        $id('cap-btn-transcribe').disabled = false;
        $id('cap-progress-bar').classList.remove('cap-indeterminate');
        capIsCancelling = false;
        capFfmpegProcess = null;
        capWhisperProcess = null;
    }, 500);
};

/* ---------------------------------------------------------------------------
   SRT FILE IO
   --------------------------------------------------------------------------- */
window.captionSaveSRTFile = function() {
    var chunks = getChunksFromUI();
    var srtContent = "";
    for (var k = 0; k < chunks.length; k++) {
        srtContent += (k + 1) + "\n" + formatSRTTime(chunks[k].start) + " --> " + formatSRTTime(chunks[k].end) + "\n" + chunks[k].text + "\n\n";
    }

    var script = '(function(){ var f = File.saveDialog("Save Subtitles", "SubRip Files:*.srt"); return f ? f.fsName : "CANCELLED"; })()';
    capEval(script, function(result) {
        if (result && result !== "CANCELLED" && result !== "undefined") {
            try {
                var savePath = result;
                if (!savePath.toLowerCase().endsWith('.srt')) savePath += '.srt';
                savePath = savePath.replace(/\\\\/g, '\\');
                fs.writeFileSync(savePath, srtContent.trim(), 'utf8');
            } catch(e) {}
        }
    });
};

window.captionImportExternalSRT = function() {
    capEval('(function(){ var f = File.openDialog("Select SRT", "SRT:*.srt"); return f ? f.fsName : "CANCELLED"; })()', function(filePath) {
        if (filePath !== "CANCELLED" && filePath !== "undefined") {
            try {
                var safePath = filePath.replace(/\\\\/g, '\\');
                var srtContent = fs.readFileSync(safePath, 'utf8');

                var blocks = srtContent.split(/\r?\n\r?\n/);
                var parsedChunks = [];

                for (var i = 0; i < blocks.length; i++) {
                    var lines = blocks[i].trim().split(/\r?\n/);
                    if (lines.length < 3) continue;

                    var timeLine = lines[1];
                    if (timeLine.indexOf("-->") === -1) continue;

                    var times = timeLine.split("-->");
                    parsedChunks.push({
                        start: srtTimeToSeconds(times[0].trim()),
                        end: srtTimeToSeconds(times[1].trim()),
                        text: lines.slice(2).join("\n").replace(/<[^>]*>/g, "")
                    });
                }

                if (parsedChunks.length > 0) {
                    window.switchCaptionTab('cap-generate');
                    $id('cap-engine-setup-area').style.display = 'none';
                    $id('cap-srt-editor-area').style.display = 'flex';
                    $id('cap-btn-generate-extra-setup').style.display = 'block';
                    $id('cap-btn-generate-import-setup').style.flex = '2';
                    renderSRTUI(parsedChunks);
                } else {
                    capAlert("The selected SRT file appears to be empty or invalid.");
                }
            } catch(e) {
                capAlert("Error reading SRT file: " + e.message);
            }
        }
    });
};

/* ---------------------------------------------------------------------------
   LAYER GENERATION
   --------------------------------------------------------------------------- */
window.captionGenerateLayersFromSRT = function() {
    capResetBackend();
    var btnGenerate = $id('cap-btn-generate-layers');
    var statusContainer = $id('cap-status-container');
    var statusText = $id('cap-status-text');
    var progressBar = $id('cap-progress-bar');
    var cancelBtn = $id('cap-cancel-btn');

    btnGenerate.disabled = true;
    statusContainer.style.display = "block";
    cancelBtn.style.display = "none";
    progressBar.classList.add('cap-indeterminate');
    progressBar.style.width = "100%";
    statusText.innerText = "Building text layers in timeline...";

    var chunks = getChunksFromUI();
    var encodedData = encodeURIComponent(JSON.stringify(chunks));

    var presetPath = capAeSafePath($id('cap-preset-select') ? $id('cap-preset-select').value : "");
    var stylePath = $id('cap-style-select') ? $id('cap-style-select').value : "";
    var colorIdx = $id('cap-color-select') ? $id('cap-color-select').value : "0";

    var styleData = "null";
    if (stylePath) {
        try { styleData = fs.readFileSync(stylePath, 'utf8'); }
        catch(e) { console.error("[Caption] Missing style file"); }
    }

    var bgSettings = {
        enable: $id('cap-set-bg-enable').checked,
        padX: $id('cap-set-bg-padx').value,
        padY: $id('cap-set-bg-pady').value,
        roundness: $id('cap-set-bg-round').value,
        opacity: $id('cap-set-bg-opacity').value,
        color: $id('cap-set-bg-color').value,
        isAdj: $id('cap-set-bg-adj').checked,
        labelColor: $id('cap-box-color-select') ? $id('cap-box-color-select').value : "0",
        presetPath: capAeSafePath($id('cap-bg-preset-select') ? $id('cap-bg-preset-select').value : "")
    };
    var encodedBgSettings = encodeURIComponent(JSON.stringify(bgSettings));

    setTimeout(function() {
        capHost('capGenerateCaptionsFromProcessedJSON("' + encodedData + '", "' + presetPath + '", "' + encodeURIComponent(styleData) + '", "' + colorIdx + '", "' + encodedBgSettings + '")', function() {
            progressBar.classList.remove('cap-indeterminate');
            statusText.innerText = "Text layers created successfully.";

            setTimeout(function() {
                statusContainer.style.display = "none";
                btnGenerate.disabled = false;
                window.switchCaptionTab('cap-editor');
            }, 1500);
        }, function() {
            statusContainer.style.display = "none";
            btnGenerate.disabled = false;
            progressBar.classList.remove('cap-indeterminate');
        });
    }, 50);
};

/* ---------------------------------------------------------------------------
   EDITOR
   --------------------------------------------------------------------------- */
window.captionRefreshEditorTimeline = function(callback) {
    capHost('capGetTimelineCaptions()', function(res) {
        var list = $id('cap-timeline-list');
        capSelectedEditorIndex = -1;

        if (res === "[]" || res === "" || res === undefined) {
            list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; margin-top: 20px; font-size: 12px;">Timeline subtitles will load automatically.</p>';
            capCurrentEditorData = [];
            if (typeof callback === "function") callback();
            return;
        }
        try {
            var data = JSON.parse(decodeURIComponent(res));
            capCurrentEditorData = data.map(function(d) {
                return { index: d.index, text: d.text, inTimeStr: d.inTimeStr, outTimeStr: d.outTimeStr };
            });
            renderEditorList();
        } catch(e) {
            console.error("[Caption] Editor parse error: " + e);
        }
        if (typeof callback === "function") callback();
    });
};

function renderEditorList() {
    var list = $id('cap-timeline-list');
    list.innerHTML = '';

    capCurrentEditorData.forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'cap-srt-row cap-editor-row';
        row.dataset.idx = item.index;

        if (capSelectedEditorIndex === item.index) row.style.borderColor = 'var(--accent-blue)';

        row.innerHTML =
            '<div class="cap-srt-text">' +
                '<textarea class="cap-srt-text-input cap-editor-text-input" spellcheck="false" rows="2">' + item.text + '</textarea>' +
            '</div>' +
            buildTimeRow(item.inTimeStr, item.outTimeStr, 'cap-editor-in-input', 'cap-editor-out-input');

        row.addEventListener('focusin', function() {
            capSelectedEditorIndex = item.index;
            document.querySelectorAll('#tab-caption .cap-editor-row').forEach(function(el) {
                el.classList.remove('cap-active-split');
                el.style.borderColor = 'transparent';
                el.style.backgroundColor = 'var(--bg-input)';
            });
            row.style.borderColor = 'var(--accent-blue)';
        });

        list.appendChild(row);
    });
}

function getEditorPayloadData() {
    var payloadData = [];
    document.querySelectorAll('#tab-caption .cap-editor-row').forEach(function(row) {
        payloadData.push({
            index: parseInt(row.dataset.idx, 10),
            text: row.querySelector('.cap-editor-text-input').value,
            inTime: row.querySelector('.cap-editor-in-input').value,
            outTime: row.querySelector('.cap-editor-out-input').value
        });
    });
    return payloadData;
}

window.captionApplyEditorChanges = function() {
    var payload = encodeURIComponent(JSON.stringify(getEditorPayloadData()));
    capHost('capUpdateAllCaptionLayers("' + payload + '")', function() {
        window.captionRefreshEditorTimeline();
    });
};

window.captionExportEditorSRT = function() {
    var payloadData = getEditorPayloadData();
    if (payloadData.length === 0) {
        return capAlert("There are no subtitles currently loaded in the Editor to export.");
    }

    var srtContent = "";
    for (var k = 0; k < payloadData.length; k++) {
        var item = payloadData[k];
        srtContent += (k + 1) + "\n" + item.inTime + " --> " + item.outTime + "\n" + item.text + "\n\n";
    }

    var script = '(function(){ var f = File.saveDialog("Save Subtitles", "SubRip Files:*.srt"); return f ? f.fsName : "CANCELLED"; })()';
    capEval(script, function(result) {
        if (result && result !== "CANCELLED" && result !== "undefined") {
            try {
                var savePath = result;
                if (!savePath.toLowerCase().endsWith('.srt')) savePath += '.srt';
                savePath = savePath.replace(/\\\\/g, '\\');
                fs.writeFileSync(savePath, srtContent.trim(), 'utf8');
            } catch(e) {
                capAlert("Error saving SRT file: " + e.message);
            }
        }
    });
};

window.captionSplitEditorLayer = function() {
    capIsSplitting = true;
    capHost('capSplitCaptionLayerAtPlayhead();', function(res) {
        if (res === "ERROR_NO_LAYER_UNDER_PLAYHEAD") {
            capAlert("No subtitle found under the playhead. Move the AE playhead over the subtitle you want to split.");
            capIsSplitting = false;
        } else {
            window.captionRefreshEditorTimeline(function() {
                captionSyncEditorToPlayhead(true, false);
                setTimeout(function() { capIsSplitting = false; }, 800);
            });
        }
    });
};

function captionSyncEditorToPlayhead(isFromSplit, isAutoSync) {
    capHost('capGetTimelineState()', function(res) {
        if (!res || res === "undefined") return;

        var parts = res.split("|");
        var idx = parts[0];
        var compId = parts[1];
        var hash = parts[2];

        if (isAutoSync) {
            if (capCurrentCompId !== null && capCurrentCompId !== compId) {
                capCurrentCompId = compId;
                capCurrentHash = hash;
                window.captionRefreshEditorTimeline();
                return;
            }
            capCurrentCompId = compId;

            if (capCurrentHash !== null && capCurrentHash !== hash) {
                var layerCount = parseInt(hash.split("_")[0], 10);
                var didSplit = (capCurrentLayerCount !== null && layerCount > capCurrentLayerCount);

                capCurrentHash = hash;
                capCurrentLayerCount = layerCount;

                window.captionRefreshEditorTimeline(function() {
                    captionSyncScrollTo(idx, didSplit ? true : false);
                });
                return;
            }
            capCurrentHash = hash;
            capCurrentLayerCount = parseInt(hash.split("_")[0], 10);
        } else if (isFromSplit) {
            capCurrentCompId = compId;
            capCurrentHash = hash;
            capCurrentLayerCount = parseInt(hash.split("_")[0], 10);
        }

        captionSyncScrollTo(idx, isFromSplit);
    });
}

function captionSyncScrollTo(idx, isFromSplit) {
    if (idx === "-1" || !idx) return;

    var newIdx = parseInt(idx, 10);
    if (newIdx === capSelectedEditorIndex && !isFromSplit) return;

    capSelectedEditorIndex = newIdx;

    setTimeout(function() {
        document.querySelectorAll('#tab-caption .cap-editor-row').forEach(function(el) {
            el.classList.remove('cap-active-split');
            el.style.borderColor = 'transparent';
            el.style.backgroundColor = 'var(--bg-input)';

            var currentIdx = parseInt(el.dataset.idx, 10);
            if (currentIdx !== capSelectedEditorIndex) return;

            var container = el.closest('.cap-scroll');

            if (isFromSplit === true) {
                var elText = el.querySelector('.cap-editor-text-input').value;
                var prevEl = el.previousElementSibling;
                var nextEl = el.nextElementSibling;

                var prevText = prevEl ? prevEl.querySelector('.cap-editor-text-input').value : null;
                var nextText = nextEl ? nextEl.querySelector('.cap-editor-text-input').value : null;

                var targetToHighlight = null;
                if (nextText === elText) targetToHighlight = nextEl;
                else if (prevText === elText) targetToHighlight = prevEl;
                else if (prevEl) targetToHighlight = prevEl;

                el.classList.add('cap-active-split');
                if (targetToHighlight) targetToHighlight.classList.add('cap-active-split');

                if (container) {
                    var containerRect = container.getBoundingClientRect();
                    var elRect = el.getBoundingClientRect();
                    var targetRect = targetToHighlight ? targetToHighlight.getBoundingClientRect() : elRect;

                    var elAbsTop = elRect.top - containerRect.top + container.scrollTop;
                    var elAbsBottom = elRect.bottom - containerRect.top + container.scrollTop;
                    var targetAbsTop = targetRect.top - containerRect.top + container.scrollTop;
                    var targetAbsBottom = targetRect.bottom - containerRect.top + container.scrollTop;

                    var topY = Math.min(elAbsTop, targetAbsTop);
                    var bottomY = Math.max(elAbsBottom, targetAbsBottom);
                    var midY = topY + (bottomY - topY) / 2;

                    container.scrollTo({ top: midY - (container.clientHeight / 2), behavior: 'smooth' });
                }
            } else {
                el.style.borderColor = 'var(--accent-blue)';

                if (container) {
                    var cRect = container.getBoundingClientRect();
                    var eRect = el.getBoundingClientRect();
                    var aTop = eRect.top - cRect.top + container.scrollTop;
                    var aBottom = eRect.bottom - cRect.top + container.scrollTop;
                    var mid = aTop + (aBottom - aTop) / 2;

                    container.scrollTo({ top: mid - (container.clientHeight / 2), behavior: 'smooth' });
                }
            }
        });
    }, 150);
}

/* ---------------------------------------------------------------------------
   PRESET FOLDER MANAGEMENT
   --------------------------------------------------------------------------- */
function fillSelect(selectEl, folder, ext, stripExt) {
    if (!fs.existsSync(folder) || !selectEl) return;
    fs.readdirSync(folder).forEach(function(file) {
        if (file.endsWith(ext)) {
            var opt = document.createElement('option');
            opt.value = path.join(folder, file);
            opt.text = stripExt ? file.replace(ext, '') : file;
            selectEl.appendChild(opt);
        }
    });
}

function reselect(selectEl, folder, wanted, current, suffix) {
    if (!selectEl) return;
    if (wanted && fs.existsSync(path.join(folder, wanted + suffix))) {
        selectEl.value = path.join(folder, wanted + suffix);
    } else if (current && fs.existsSync(current)) {
        selectEl.value = current;
    } else {
        selectEl.selectedIndex = 0;
    }
}

window.captionRefreshFolders = function(styleToSelect, presetToSelect, formatToSelect, bgPresetToSelect, boxFormatToSelect, styleFormatToSelect) {
    if (!nodeReady) return;

    var styleSelect       = $id('cap-style-select');
    var presetSelect      = $id('cap-preset-select');
    var formatSelect      = $id('cap-format-select');
    var bgPresetSelect    = $id('cap-bg-preset-select');
    var boxFormatSelect   = $id('cap-box-format-select');
    var styleFormatSelect = $id('cap-style-format-select');

    var currentStyle       = styleSelect ? styleSelect.value : "";
    var currentPreset      = presetSelect ? presetSelect.value : "";
    var currentFormat      = formatSelect ? formatSelect.value : "";
    var currentBgPreset    = bgPresetSelect ? bgPresetSelect.value : "";
    var currentBoxFormat   = boxFormatSelect ? boxFormatSelect.value : "";
    var currentStyleFormat = styleFormatSelect ? styleFormatSelect.value : "";

    if (styleSelect)       styleSelect.innerHTML       = '<option value="">None (AE Default)</option>';
    if (presetSelect)      presetSelect.innerHTML      = '<option value="">No Effect Preset</option>';
    if (formatSelect)      formatSelect.innerHTML      = '<option value="">Default Format</option>';
    if (bgPresetSelect)    bgPresetSelect.innerHTML    = '<option value="">No Preset</option>';
    if (boxFormatSelect)   boxFormatSelect.innerHTML   = '<option value="">Default Box</option>';
    if (styleFormatSelect) styleFormatSelect.innerHTML = '<option value="">Default Style Settings</option>';

    fillSelect(styleSelect,       stylesFolder,       '.json', true);
    fillSelect(presetSelect,      presetsFolder,      '.ffx',  false);
    fillSelect(formatSelect,      formatsFolder,      '.json', true);
    fillSelect(bgPresetSelect,    boxPresetsFolder,   '.ffx',  false);
    fillSelect(boxFormatSelect,   boxFormatsFolder,   '.json', true);
    fillSelect(styleFormatSelect, styleFormatsFolder, '.json', true);

    reselect(styleSelect,       stylesFolder,       styleToSelect,       currentStyle,       '.json');
    reselect(presetSelect,      presetsFolder,      presetToSelect,      currentPreset,      '');
    reselect(formatSelect,      formatsFolder,      formatToSelect,      currentFormat,      '.json');
    reselect(bgPresetSelect,    boxPresetsFolder,   bgPresetToSelect,    currentBgPreset,    '');
    reselect(boxFormatSelect,   boxFormatsFolder,   boxFormatToSelect,   currentBoxFormat,   '.json');
    reselect(styleFormatSelect, styleFormatsFolder, styleFormatToSelect, currentStyleFormat, '.json');

    ['cap-format-select', 'cap-style-select', 'cap-preset-select',
     'cap-bg-preset-select', 'cap-box-format-select', 'cap-style-format-select'].forEach(function(id) {
        if ($id(id) && window.buildCustomDropdown) window.buildCustomDropdown(id);
    });
};

window.captionAnimateRefresh = function() {
    capResetBackend();
    document.querySelectorAll('#tab-caption .cap-refresh-spin').forEach(function(svgG) {
        if (svgG.currentAnim) svgG.currentAnim.cancel();
        svgG.currentAnim = svgG.animate(
            [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
            { duration: 1500, easing: 'ease-in-out' }
        );
    });
    window.captionRefreshFolders();
};

function fillDeleteSelect(selectId, overlayId, placeholder, folder, ext, stripExt) {
    var select = $id(selectId);
    select.innerHTML = '<option value="">' + placeholder + '</option>';
    fillSelect(select, folder, ext, stripExt);
    $id(overlayId).style.display = 'flex';
    if (window.buildCustomDropdown) window.buildCustomDropdown(selectId);
}

function doDelete(selectId, overlayId, emptyMsg) {
    $id(overlayId).style.display = 'none';
    var select = $id(selectId);
    if (select.selectedIndex <= 0) return capAlert(emptyMsg);
    var fp = select.value;
    if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        window.captionRefreshFolders();
    }
}

function openPrompt(overlayId, inputId, defaultName) {
    $id(inputId).value = defaultName;
    $id(overlayId).style.display = 'flex';
    $id(inputId).focus();
    $id(inputId).select();
}

/* --- Format presets --- */
window.captionPromptSaveFormat = function() {
    var linesEl = document.querySelector('input[name="cap-set-lines"]:checked');
    capPendingFormatJson = JSON.stringify({
        chars: $id('cap-set-chars').value,
        minDur: $id('cap-set-mindur').value,
        gap: $id('cap-set-gap').value,
        lines: linesEl ? linesEl.value : 'single',
        puncComma: $id('cap-punc-comma').checked,
        puncPeriod: $id('cap-punc-period').checked,
        puncQuestion: $id('cap-punc-question').checked,
        puncExclaim: $id('cap-punc-exclaim').checked
    });
    openPrompt('cap-format-prompt-overlay', 'cap-format-prompt-input', "My Format");
};

window.captionCloseFormatPrompt = function(isSave) {
    $id('cap-format-prompt-overlay').style.display = 'none';
    if (isSave && capPendingFormatJson) {
        var name = $id('cap-format-prompt-input').value.trim();
        if (name) {
            fs.writeFileSync(path.join(formatsFolder, name + ".json"), capPendingFormatJson, 'utf8');
            window.captionRefreshFolders(null, null, name, null, null, null);
        }
    }
    capPendingFormatJson = null;
};

window.captionPromptDeleteFormat = function() {
    fillDeleteSelect('cap-delete-format-select', 'cap-delete-format-overlay', '-- Select Format --', formatsFolder, '.json', true);
};
window.captionCloseDeleteFormat = function(isDelete) {
    if (!isDelete) { $id('cap-delete-format-overlay').style.display = 'none'; return; }
    doDelete('cap-delete-format-select', 'cap-delete-format-overlay', "No format selected.");
};

/* --- Box presets --- */
window.captionPromptSaveBoxFormat = function() {
    capPendingBoxFormatJson = JSON.stringify({
        bgPreset: $id('cap-bg-preset-select').value,
        bgEnable: $id('cap-set-bg-enable').checked,
        bgPadX: $id('cap-set-bg-padx').value,
        bgPadY: $id('cap-set-bg-pady').value,
        bgRound: $id('cap-set-bg-round').value,
        bgOpacity: $id('cap-set-bg-opacity').value,
        bgColor: $id('cap-set-bg-color').value,
        bgAdj: $id('cap-set-bg-adj').checked,
        boxLabelColor: $id('cap-box-color-select') ? $id('cap-box-color-select').value : "8"
    });
    openPrompt('cap-box-format-prompt-overlay', 'cap-box-format-prompt-input', "My Box Preset");
};

window.captionCloseBoxFormatPrompt = function(isSave) {
    $id('cap-box-format-prompt-overlay').style.display = 'none';
    if (isSave && capPendingBoxFormatJson) {
        var name = $id('cap-box-format-prompt-input').value.trim();
        if (name) {
            fs.writeFileSync(path.join(boxFormatsFolder, name + ".json"), capPendingBoxFormatJson, 'utf8');
            window.captionRefreshFolders(null, null, null, null, name, null);
        }
    }
    capPendingBoxFormatJson = null;
};

window.captionPromptDeleteBoxFormat = function() {
    fillDeleteSelect('cap-delete-box-format-select', 'cap-delete-box-format-overlay', '-- Select Box Preset --', boxFormatsFolder, '.json', true);
};
window.captionCloseDeleteBoxFormat = function(isDelete) {
    if (!isDelete) { $id('cap-delete-box-format-overlay').style.display = 'none'; return; }
    doDelete('cap-delete-box-format-select', 'cap-delete-box-format-overlay', "No box preset selected.");
};

/* --- Style setting presets --- */
window.captionPromptSaveStyleFormat = function() {
    capPendingStyleFormatJson = JSON.stringify({
        stylePreset: $id('cap-style-select').value,
        effectPreset: $id('cap-preset-select').value,
        labelColor: $id('cap-color-select').value
    });
    openPrompt('cap-style-format-prompt-overlay', 'cap-style-format-prompt-input', "My Style Settings");
};

window.captionCloseStyleFormatPrompt = function(isSave) {
    $id('cap-style-format-prompt-overlay').style.display = 'none';
    if (isSave && capPendingStyleFormatJson) {
        var name = $id('cap-style-format-prompt-input').value.trim();
        if (name) {
            fs.writeFileSync(path.join(styleFormatsFolder, name + ".json"), capPendingStyleFormatJson, 'utf8');
            window.captionRefreshFolders(null, null, null, null, null, name);
        }
    }
    capPendingStyleFormatJson = null;
};

window.captionPromptDeleteStyleFormat = function() {
    fillDeleteSelect('cap-delete-style-format-select', 'cap-delete-style-format-overlay', '-- Select Style Preset --', styleFormatsFolder, '.json', true);
};
window.captionCloseDeleteStyleFormat = function(isDelete) {
    if (!isDelete) { $id('cap-delete-style-format-overlay').style.display = 'none'; return; }
    doDelete('cap-delete-style-format-select', 'cap-delete-style-format-overlay', "No style preset selected.");
};

/* --- Text Properties (style capture) --- */
window.captionPromptSaveStyle = function() {
    capHost('capGetActiveLayerStyle()', function(jsonStr) {
        if (jsonStr === "ERROR_NO_LAYER") return capAlert("Please select exactly ONE Text Layer to copy its style.");
        capPendingStyleJson = jsonStr;
        openPrompt('cap-style-prompt-overlay', 'cap-style-prompt-input', "My Style");
    });
};

window.captionCloseStylePrompt = function(isSave) {
    $id('cap-style-prompt-overlay').style.display = 'none';
    if (isSave && capPendingStyleJson) {
        var name = $id('cap-style-prompt-input').value.trim();
        if (name) {
            fs.writeFileSync(path.join(stylesFolder, name + ".json"), capPendingStyleJson, 'utf8');
            window.captionRefreshFolders(name, null, null, null, null, null);
        }
    }
    capPendingStyleJson = null;
};

window.captionPromptDeleteStyle = function() {
    fillDeleteSelect('cap-delete-style-select', 'cap-delete-style-overlay', '-- Select Style --', stylesFolder, '.json', true);
};
window.captionCloseDeleteStyle = function(isDelete) {
    if (!isDelete) { $id('cap-delete-style-overlay').style.display = 'none'; return; }
    doDelete('cap-delete-style-select', 'cap-delete-style-overlay', "No style selected.");
};

/* --- Effect presets (.ffx) --- */
window.captionPromptSaveEffectPreset = function() {
    capHost('capCheckLayerForPresetSave()', function(res) {
        if (res === "ERROR_NO_LAYER") return capAlert("Please select exactly ONE Text Layer to save its effects and animations.");
        if (res === "ERROR_NO_PROPERTIES") return capAlert("No Effects or Text Animators found on the selected layer.");
        openPrompt('cap-effect-prompt-overlay', 'cap-effect-prompt-input', "My Effect Preset");
    });
};

window.captionCloseEffectPrompt = function(isSave) {
    $id('cap-effect-prompt-overlay').style.display = 'none';
    if (!isSave) return;

    var presetName = $id('cap-effect-prompt-input').value.trim();
    if (!presetName) return;

    var safePath = capAeSafePath(path.join(presetsFolder, presetName + ".ffx"));
    capHost('capSaveLayerEffectsAndAnimatorsAsPreset("' + safePath + '")', function(res) {
        if (res === "ERROR_UNSUPPORTED") {
            capAlert("Your version of After Effects does not support silent FFX saving via script. Please save manually via Animation > Save Animation Preset.");
        } else if (res && res.indexOf("ERROR_") === 0) {
            capAlert("Error saving preset: " + res);
        } else {
            window.captionRefreshFolders(null, presetName + ".ffx", null, null, null, null);
        }
    });
};

window.captionPromptDeletePreset = function() {
    fillDeleteSelect('cap-delete-preset-select', 'cap-delete-preset-overlay', '-- Select Effect Preset --', presetsFolder, '.ffx', false);
};
window.captionCloseDeletePreset = function(isDelete) {
    if (!isDelete) { $id('cap-delete-preset-overlay').style.display = 'none'; return; }
    doDelete('cap-delete-preset-select', 'cap-delete-preset-overlay', "No preset selected.");
};

window.captionPromptDeleteBgPreset = function() {
    fillDeleteSelect('cap-delete-bg-preset-select', 'cap-delete-bg-preset-overlay', '-- Select Box Preset --', boxPresetsFolder, '.ffx', false);
};
window.captionCloseDeleteBgPreset = function(isDelete) {
    if (!isDelete) { $id('cap-delete-bg-preset-overlay').style.display = 'none'; return; }
    doDelete('cap-delete-bg-preset-select', 'cap-delete-bg-preset-overlay', "No box preset selected.");
};

window.captionAddPresetFile = function() {
    capEval('(function(){ var f = File.openDialog("Select Animation Preset", "Presets:*.ffx"); return f ? f.fsName : "CANCELLED"; })()', function(filePath) {
        if (filePath !== "CANCELLED" && filePath !== "undefined") {
            var safePath = filePath.replace(/\\\\/g, '\\');
            var fileName = path.basename(safePath);
            fs.copyFileSync(safePath, path.join(presetsFolder, fileName));
            window.captionRefreshFolders(null, fileName, null, null, null, null);
        }
    });
};

window.captionAddBgPresetFile = function() {
    capEval('(function(){ var f = File.openDialog("Select Animation Preset", "Presets:*.ffx"); return f ? f.fsName : "CANCELLED"; })()', function(filePath) {
        if (filePath !== "CANCELLED" && filePath !== "undefined") {
            var safePath = filePath.replace(/\\\\/g, '\\');
            var fileName = path.basename(safePath);
            fs.copyFileSync(safePath, path.join(boxPresetsFolder, fileName));
            window.captionRefreshFolders(null, null, null, fileName, null, null);
        }
    });
};

/* ---------------------------------------------------------------------------
   APPLY TO SELECTION
   --------------------------------------------------------------------------- */
window.captionApplyToSelection = function() {
    var presetPath = capAeSafePath($id('cap-preset-select').value);
    var stylePath = $id('cap-style-select').value;
    var colorIdx = $id('cap-color-select').value;

    if (!presetPath && !stylePath && colorIdx === "0") {
        return capAlert("Select a Preset, Style, or Label Color first!");
    }

    var styleData = "null";
    if (stylePath) {
        try { styleData = fs.readFileSync(stylePath, 'utf8'); }
        catch(e) { return capAlert("Error reading style: " + e.message); }
    }

    var encodedStyle = encodeURIComponent(styleData);
    var encodedPreset = encodeURIComponent(presetPath);

    var btnApply = $id('cap-btn-apply-styles');
    var statusContainer = $id('cap-status-container');
    var statusText = $id('cap-status-text');
    var progressBar = $id('cap-progress-bar');
    var cancelBtn = $id('cap-cancel-btn');

    if (btnApply) btnApply.disabled = true;
    statusContainer.style.display = "block";
    cancelBtn.style.display = "none";
    progressBar.classList.add('cap-indeterminate');
    progressBar.style.width = "100%";
    statusText.innerText = "Applying styles to selection...";

    setTimeout(function() {
        capHost('capApplySettingsToSelected("' + encodedPreset + '", "' + encodedStyle + '", "' + colorIdx + '")', function() {
            progressBar.classList.remove('cap-indeterminate');
            statusText.innerText = "Styles applied successfully.";
            setTimeout(function() {
                statusContainer.style.display = "none";
                if (btnApply) btnApply.disabled = false;
            }, 1500);
        }, function() {
            statusContainer.style.display = "none";
            if (btnApply) btnApply.disabled = false;
            progressBar.classList.remove('cap-indeterminate');
        });
    }, 50);
};

window.captionApplyBackgroundToSelection = function() {
    var bgSettings = {
        enable: true,
        padX: $id('cap-set-bg-padx').value,
        padY: $id('cap-set-bg-pady').value,
        roundness: $id('cap-set-bg-round').value,
        opacity: $id('cap-set-bg-opacity').value,
        color: $id('cap-set-bg-color').value,
        isAdj: $id('cap-set-bg-adj').checked,
        labelColor: $id('cap-box-color-select') ? $id('cap-box-color-select').value : "0",
        presetPath: capAeSafePath($id('cap-bg-preset-select').value)
    };
    capHost('capApplyBackgroundToSelectedLayers("' + encodeURIComponent(JSON.stringify(bgSettings)) + '")');
};

/* ---------------------------------------------------------------------------
   EXTRA FEATURES + PUNCTUATION
   --------------------------------------------------------------------------- */
window.captionOpenExtraModal = function(mode) {
    capExtraMode = mode;
    ['comma', 'period', 'question', 'exclaim'].forEach(function(t) {
        $id('cap-extra-punc-wrap-' + t).classList.toggle('active', $id('cap-extra-punc-' + t).checked);
    });
    $id('cap-extra-modal-overlay').style.display = 'flex';
};
window.captionCloseExtraModal = function() {
    $id('cap-extra-modal-overlay').style.display = 'none';
};

window.captionToggleExtraPunc = function(type) {
    var el = $id('cap-extra-punc-' + type);
    el.checked = !el.checked;
    $id('cap-extra-punc-wrap-' + type).classList.toggle('active', el.checked);
};

window.captionApplyPunctuationsToCurrentTab = function() {
    var rmComma    = $id('cap-extra-punc-comma').checked;
    var rmPeriod   = $id('cap-extra-punc-period').checked;
    var rmQuestion = $id('cap-extra-punc-question').checked;
    var rmExclaim  = $id('cap-extra-punc-exclaim').checked;

    function stripText(wText) {
        if (rmComma) wText = wText.replace(/,/g, '');
        if (rmPeriod) wText = wText.replace(/\./g, '');
        if (rmQuestion) wText = wText.replace(/\?/g, '');
        if (rmExclaim) wText = wText.replace(/!/g, '');
        return wText.trim();
    }

    if (capExtraMode === 'generate') {
        document.querySelectorAll('#cap-srt-list .cap-srt-text-input').forEach(function(inp) { inp.value = stripText(inp.value); });
    } else if (capExtraMode === 'editor') {
        document.querySelectorAll('#cap-timeline-list .cap-editor-text-input').forEach(function(inp) { inp.value = stripText(inp.value); });
    }
    window.captionCloseExtraModal();
};

/* ---------------------------------------------------------------------------
   MULTI-DELETE
   --------------------------------------------------------------------------- */
window.captionOpenMultiDeleteModal = function(mode) {
    capMultiDeleteMode = mode;
    var listEl = $id('cap-multi-delete-list');
    listEl.innerHTML = '';

    var items = [];
    if (mode === 'generate') {
        document.querySelectorAll('#cap-srt-list .cap-srt-row').forEach(function(row, i) {
            var text = row.querySelector('.cap-srt-text-input').value.trim();
            if (text.length === 0) text = "(Empty)";
            items.push({ id: i, text: text });
        });
    } else {
        items = capCurrentEditorData.map(function(d) {
            var text = d.text.trim();
            if (text.length === 0) text = "(Empty)";
            return { id: d.index, text: text };
        });
    }

    if (items.length === 0) return capAlert("There are no subtitles available to delete.");

    $id('cap-md-select-all').checked = false;

    items.forEach(function(item) {
        var div = document.createElement('div');
        div.className = 'cap-checkbox-wrapper';

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = item.id;
        cb.id = 'cap-md-' + item.id;

        var preview = document.createElement('div');
        preview.className = 'cap-md-text-preview';
        preview.innerText = item.text;

        div.appendChild(cb);
        div.appendChild(preview);
        div.addEventListener('click', function(e) { if (e.target !== cb) cb.checked = !cb.checked; });

        listEl.appendChild(div);
    });

    $id('cap-multi-delete-overlay').style.display = 'flex';
};

window.captionToggleAllMultiDelete = function(cb) {
    document.querySelectorAll('#cap-multi-delete-list input[type="checkbox"]').forEach(function(el) { el.checked = cb.checked; });
};

window.captionCloseMultiDeleteModal = function() {
    $id('cap-multi-delete-overlay').style.display = 'none';
};

window.captionExecuteMultiDelete = function() {
    var checkedBoxes = Array.prototype.slice.call(document.querySelectorAll('#cap-multi-delete-list input[type="checkbox"]:checked'));
    if (checkedBoxes.length === 0) return window.captionCloseMultiDeleteModal();

    var checkedValues = checkedBoxes.map(function(cb) { return parseInt(cb.value, 10); });

    if (capMultiDeleteMode === 'generate') {
        var rows = document.querySelectorAll('#cap-srt-list .cap-srt-row');
        checkedValues.sort(function(a, b) { return b - a; }).forEach(function(idx) {
            if (rows[idx]) rows[idx].remove();
        });
        window.captionCloseMultiDeleteModal();

        if (document.querySelectorAll('#cap-srt-list .cap-srt-row').length === 0) {
            resetTranscription();
            $id('cap-btn-generate-extra-setup').style.display = 'none';
            $id('cap-btn-generate-import-setup').style.flex = '1';
        }
    } else {
        var indexesStr = checkedValues.sort(function(a, b) { return b - a; }).join(',');
        capHost('capDeleteSpecificCaptions("' + indexesStr + '")', function() {
            window.captionRefreshEditorTimeline();
            window.captionCloseMultiDeleteModal();
        });
    }
};

/* ---------------------------------------------------------------------------
   COLOR PICKER
   --------------------------------------------------------------------------- */
function hslToHex(h, s, l) {
    l /= 100;
    var a = s * Math.min(l, 1 - l) / 100;
    var f = function(n) {
        var k = (n + h / 30) % 12;
        var color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return ('#' + f(0) + f(8) + f(4)).toUpperCase();
}

function hexToHsl(hex) {
    var r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16); g = parseInt(hex[2] + hex[2], 16); b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16); g = parseInt(hex.substring(3, 5), 16); b = parseInt(hex.substring(5, 7), 16);
    }
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function initColorPicker() {
    var hueSlider = $id('cap-cp-hue');
    var satSlider = $id('cap-cp-sat');
    var litSlider = $id('cap-cp-lit');
    var hexInput  = $id('cap-cp-hex');
    if (!hueSlider || !satSlider || !litSlider || !hexInput) return;

    function updateFromSliders() {
        var h = hueSlider.value, s = satSlider.value, l = litSlider.value;
        satSlider.style.background = 'linear-gradient(to right, hsl(' + h + ', 0%, ' + l + '%), hsl(' + h + ', 100%, ' + l + '%))';
        litSlider.style.background = 'linear-gradient(to right, #000, hsl(' + h + ', ' + s + '%, 50%), #fff)';
        var hex = hslToHex(h, s, l);
        hexInput.value = hex;
        $id('cap-cp-preview').style.backgroundColor = hex;
    }

    function updateFromHex() {
        var hex = hexInput.value;
        if (hex.charAt(0) !== '#') hex = '#' + hex;
        if (/^#[0-9A-F]{6}$/i.test(hex) || /^#[0-9A-F]{3}$/i.test(hex)) {
            var hsl = hexToHsl(hex);
            hueSlider.value = hsl[0]; satSlider.value = hsl[1]; litSlider.value = hsl[2];
            updateFromSliders();
        }
    }

    hueSlider.addEventListener('input', updateFromSliders);
    satSlider.addEventListener('input', updateFromSliders);
    litSlider.addEventListener('input', updateFromSliders);
    hexInput.addEventListener('input', updateFromHex);
    hexInput.addEventListener('blur', function() {
        var hex = hexInput.value;
        if (hex.charAt(0) !== '#') hex = '#' + hex;
        if (!/^#[0-9A-F]{6}$/i.test(hex)) hexInput.value = '#FF1493';
        updateFromHex();
    });
}

window.captionOpenColorPicker = function() {
    var cp = $id('cap-cp');
    $id('cap-cp-hex').value = $id('cap-set-bg-color').value;
    $id('cap-cp-hex').dispatchEvent(new Event('input'));
    cp.classList.add('active');
    setTimeout(function() { document.addEventListener('click', capCloseCpOutside); }, 10);
};

function capCloseCpOutside(e) {
    var cp = $id('cap-cp');
    var triggerBox = $id('cap-visual-color-box');
    if (!cp.contains(e.target) && e.target !== triggerBox) window.captionCloseColorPicker(false);
}

window.captionCloseColorPicker = function(saveChanges) {
    $id('cap-cp').classList.remove('active');
    document.removeEventListener('click', capCloseCpOutside);

    if (saveChanges) {
        var finalHex = $id('cap-cp-hex').value;
        $id('cap-set-bg-color').value = finalHex;
        $id('cap-visual-color-box').style.backgroundColor = finalHex;
        saveSettings();
    }
};

window.captionCloseWavInstructions = function() {
    $id('cap-wav-overlay').style.display = 'none';
};

/* ---------------------------------------------------------------------------
   PRESET DROPDOWN CHANGE HANDLERS
   --------------------------------------------------------------------------- */
function bindPresetLoaders() {
    var formatSelect = $id('cap-format-select');
    if (formatSelect) {
        formatSelect.addEventListener('change', function() {
            if (!this.value) return;
            try {
                var data = JSON.parse(fs.readFileSync(this.value, 'utf8'));
                if (data.chars !== undefined)  { $id('cap-set-chars').value = data.chars;   $id('cap-chars-val').value = data.chars; }
                if (data.minDur !== undefined) { $id('cap-set-mindur').value = data.minDur; $id('cap-mindur-val').value = data.minDur; }
                if (data.gap !== undefined)    { $id('cap-set-gap').value = data.gap;       $id('cap-gap-val').value = data.gap; }
                if (data.lines !== undefined) {
                    Array.prototype.forEach.call(document.getElementsByName('cap-set-lines'), function(r) { r.checked = (r.value === data.lines); });
                }
                if (data.puncComma !== undefined)    $id('cap-punc-comma').checked = data.puncComma;
                if (data.puncPeriod !== undefined)   $id('cap-punc-period').checked = data.puncPeriod;
                if (data.puncQuestion !== undefined) $id('cap-punc-question').checked = data.puncQuestion;
                if (data.puncExclaim !== undefined)  $id('cap-punc-exclaim').checked = data.puncExclaim;

                document.querySelectorAll('#tab-caption input[type=range].cap-slider').forEach(function(s) { s.dispatchEvent(new Event('input')); });
                saveSettings();
            } catch(err) {}
        });
    }

    var boxFormatSelect = $id('cap-box-format-select');
    if (boxFormatSelect) {
        boxFormatSelect.addEventListener('change', function() {
            if (!this.value) return;
            try {
                var data = JSON.parse(fs.readFileSync(this.value, 'utf8'));
                if (data.bgPreset !== undefined) {
                    $id('cap-bg-preset-select').value = data.bgPreset;
                    $id('cap-bg-preset-select').dispatchEvent(new Event('change'));
                }
                if (data.bgEnable !== undefined) $id('cap-set-bg-enable').checked = data.bgEnable;
                if (data.bgPadX !== undefined)   { $id('cap-set-bg-padx').value = data.bgPadX;   $id('cap-bg-px-val').value = data.bgPadX; }
                if (data.bgPadY !== undefined)   { $id('cap-set-bg-pady').value = data.bgPadY;   $id('cap-bg-py-val').value = data.bgPadY; }
                if (data.bgRound !== undefined)  { $id('cap-set-bg-round').value = data.bgRound; $id('cap-bg-rnd-val').value = data.bgRound; }
                if (data.bgOpacity !== undefined){ $id('cap-set-bg-opacity').value = data.bgOpacity; $id('cap-bg-op-val').value = data.bgOpacity; }
                if (data.bgColor !== undefined) {
                    $id('cap-set-bg-color').value = data.bgColor;
                    $id('cap-visual-color-box').style.backgroundColor = data.bgColor;
                }
                if (data.bgAdj !== undefined) $id('cap-set-bg-adj').checked = data.bgAdj;
                if (data.boxLabelColor !== undefined) {
                    var el = $id('cap-box-color-select');
                    if (el) { el.value = data.boxLabelColor; el.dispatchEvent(new Event('change')); }
                }

                document.querySelectorAll('#cap-box input[type=range].cap-slider').forEach(function(s) { s.dispatchEvent(new Event('input')); });

                if (window.buildCustomDropdown) {
                    window.buildCustomDropdown('cap-bg-preset-select');
                    window.buildCustomDropdown('cap-box-color-select');
                }
                saveSettings();
            } catch(err) {}
        });
    }

    var styleFormatSelect = $id('cap-style-format-select');
    if (styleFormatSelect) {
        styleFormatSelect.addEventListener('change', function() {
            if (!this.value) return;
            try {
                var data = JSON.parse(fs.readFileSync(this.value, 'utf8'));
                if (data.stylePreset !== undefined) {
                    $id('cap-style-select').value = data.stylePreset;
                    $id('cap-style-select').dispatchEvent(new Event('change'));
                }
                if (data.effectPreset !== undefined) {
                    $id('cap-preset-select').value = data.effectPreset;
                    $id('cap-preset-select').dispatchEvent(new Event('change'));
                }
                if (data.labelColor !== undefined) {
                    $id('cap-color-select').value = data.labelColor;
                    $id('cap-color-select').dispatchEvent(new Event('change'));
                }

                if (window.buildCustomDropdown) {
                    window.buildCustomDropdown('cap-style-select');
                    window.buildCustomDropdown('cap-preset-select');
                    window.buildCustomDropdown('cap-color-select');
                }
                saveSettings();
            } catch(err) {}
        });
    }
}

/* ---------------------------------------------------------------------------
   SETTINGS: presets folder, import from RFX Suite, AI engine downloads
   (dialog look shared with the other tabs via js/deps.js + css/deps.css)
   --------------------------------------------------------------------------- */
function capListFiles(dir) {
    try { return fs.readdirSync(dir).filter(function(n) { try { return fs.statSync(path.join(dir, n)).isFile(); } catch(e) { return false; } }); }
    catch(e) { return []; }
}

/* Copies presets between folder layouts. Never overwrites or deletes: identical files
   are skipped, a different file with the same name is copied as "name (imported)". */
function capCopyPresets(fromRoot, fromMap, toRoot, toMap) {
    var result = { copied: 0, renamed: 0, skipped: 0, failed: 0 };
    Object.keys(toMap).forEach(function(kind) {
        var src = path.join(fromRoot, fromMap[kind]), dst = path.join(toRoot, toMap[kind]);
        var files = capListFiles(src);
        if (!files.length) return;
        try { fs.mkdirSync(dst, { recursive: true }); } catch(e) {}
        files.forEach(function(name) {
            var from = path.join(src, name), to = path.join(dst, name);
            try {
                if (fs.existsSync(to)) {
                    var data = fs.readFileSync(from);
                    if (fs.readFileSync(to).equals(data)) { result.skipped++; return; }
                    // Same name, different content: use the first free "name (imported N)",
                    // unless an earlier import already holds this exact file.
                    var ext = path.extname(name), base = name.slice(0, name.length - ext.length), n = 1;
                    for (;;) {
                        to = path.join(dst, base + ' (imported' + (n > 1 ? ' ' + n : '') + ')' + ext);
                        if (!fs.existsSync(to)) break;
                        if (fs.readFileSync(to).equals(data)) { result.skipped++; return; }
                        n++;
                    }
                    result.renamed++;
                }
                fs.copyFileSync(from, to);
                result.copied++;
            } catch(e) { result.failed++; }
        });
    });
    return result;
}

function capLegacyPresetCount() {
    var legacy = capLegacyDataDir();
    if (path.resolve(legacy) === path.resolve(extDataDir)) return 0;
    return Object.keys(CAP_LEGACY_SUBFOLDERS).reduce(function(n, k) {
        return n + capListFiles(path.join(legacy, CAP_LEGACY_SUBFOLDERS[k])).length;
    }, 0);
}

function capImportLegacyPresets() {
    var r = capCopyPresets(capLegacyDataDir(), CAP_LEGACY_SUBFOLDERS, extDataDir, CAP_SUBFOLDERS);
    localStorage.setItem(CAP_IMPORT_KEY, 'done');
    window.captionRefreshFolders();
    capShowImportOffer();
    var msg = 'Imported ' + r.copied + ' preset' + (r.copied === 1 ? '' : 's') + ' from RFX Suite';
    if (r.renamed) msg += ' (' + r.renamed + ' renamed to avoid replacing yours)';
    if (r.skipped) msg += ', ' + r.skipped + ' already here';
    if (r.failed) msg += '. ' + r.failed + ' could not be copied';
    if (typeof showToast === 'function') showToast(msg);
    return r;
}

function capSetPresetsDir(dir) {
    if (dir) localStorage.setItem(CAP_PRESETS_DIR_KEY, path.resolve(dir));
    else localStorage.removeItem(CAP_PRESETS_DIR_KEY);
    applyPresetsDir();
    ensureFolders();
    window.captionRefreshFolders();
    capShowImportOffer();
}

function capChangePresetsDir(onDone) {
    var pick = window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx(false, true, 'Choose the caption presets folder', extDataDir, []);
    if (!pick || !pick.data || !pick.data.length) return;
    var dest = path.resolve(pick.data[0]);
    if (dest === path.resolve(extDataDir)) return;
    if (!confirm('Save caption presets in this folder from now on?\n\n' + dest +
                 '\n\nNothing is moved or deleted: presets already in the current folder stay there. You can switch back at any time.')) return;
    var from = extDataDir;
    var count = Object.keys(CAP_SUBFOLDERS).reduce(function(n, k) { return n + capListFiles(path.join(from, CAP_SUBFOLDERS[k])).length; }, 0);
    capSetPresetsDir(dest);
    if (count && confirm('Copy your ' + count + ' current preset' + (count === 1 ? '' : 's') + ' into the new folder?\n\n(Copies only; files already in the new folder are kept.)')) {
        var r = capCopyPresets(from, CAP_SUBFOLDERS, dest, CAP_SUBFOLDERS);
        window.captionRefreshFolders();
        if (typeof showToast === 'function') showToast('Copied ' + r.copied + ' preset' + (r.copied === 1 ? '' : 's') + ' into the new folder');
    }
    if (onDone) onDone();
}

function capOpenSettings(reason) {
    if (!nodeReady || !window.RFXDeps) return capAlert('Caption settings need Node.js, which is not available in this panel.');
    capRegisterDeps();
    var ui = RFXDeps.ui;
    var m = ui.modal('cap-settings-modal', 'Caption settings');
    if (reason) {
        var note = ui.el('div', 'rfxdep-msg is-error', reason);
        note.style.margin = '0 0 16px';
        m.body.appendChild(note);
    }

    var presets = ui.section('Caption presets folder');
    presets.appendChild(ui.el('div', 'rfxdep-text', 'Format, style, box and effect presets are saved here, each kind in its own subfolder (Format Presets, Text Styles, Effect Presets, Box Presets, Box Formats, Style Formats).'));
    var row = ui.el('div', 'rfxdep-folder-row');
    var p = ui.el('span', 'rfxdep-folder-path', ui.ltr(extDataDir));
    p.title = extDataDir;
    row.appendChild(p);
    var reopen = function() { m.close(); capOpenSettings(); };
    row.appendChild(ui.button('Change', '', function() { capChangePresetsDir(reopen); }));
    if (localStorage.getItem(CAP_PRESETS_DIR_KEY)) {
        row.appendChild(ui.button('Reset', 'is-ghost', function() { capSetPresetsDir(null); reopen(); }, 'Go back to ' + capDefaultPresetsDir()));
    }
    row.appendChild(ui.button('Open', 'is-ghost', function() { RFXDeps.openFolder(extDataDir); }));
    presets.appendChild(row);

    var legacyCount = capLegacyPresetCount();
    if (legacyCount) {
        var imp = ui.el('div', 'rfxdep-text', '');
        imp.style.marginTop = '10px';
        imp.textContent = legacyCount + ' preset' + (legacyCount === 1 ? '' : 's') + ' from RFX Suite are in ' + capLegacyDataDir() + '. Importing copies them here; the old folder is left as it is.';
        presets.appendChild(imp);
        presets.appendChild(ui.button('Import ' + legacyCount + ' preset' + (legacyCount === 1 ? '' : 's') + ' from RFX Suite', 'is-primary', function() {
            capImportLegacyPresets();
            reopen();
        }));
    }
    m.body.appendChild(presets);

    var engine = ui.section('AI engine and tools');
    engine.appendChild(ui.el('div', 'rfxdep-text', 'Automatic captions need the Faster-Whisper-XXL engine, the large-v3 speech model and FFmpeg. They download from their official sources into this tab\'s own dependencies folder. A transcription that is already running keeps using the files it started with.'));
    var host = ui.el('div');
    engine.appendChild(host);
    m.body.appendChild(engine);
    RFXDeps.ui.renderPanel(host, 'caption');
}
window.captionOpenSettings = function() { capOpenSettings(); };

/* One-time offer to copy presets from the old RFX Suite folder (until imported or dismissed). */
function capShowImportOffer() {
    var old = $id('cap-import-offer');
    if (old) old.remove();
    if (!nodeReady || localStorage.getItem(CAP_IMPORT_KEY)) return;
    var count = capLegacyPresetCount();
    if (!count) return;
    var bar = document.createElement('div');
    bar.id = 'cap-import-offer';
    bar.className = 'rfxdep-notice';
    var text = document.createElement('span');
    text.textContent = 'Found ' + count + ' caption preset' + (count === 1 ? '' : 's') + ' from RFX Suite. Import copies them into the new presets folder (the old folder stays as it is).';
    bar.appendChild(text);
    var imp = document.createElement('button');
    imp.className = 'rfxdep-btn is-primary';
    imp.textContent = 'Import';
    imp.onclick = function() { capImportLegacyPresets(); };
    var later = document.createElement('button');
    later.className = 'rfxdep-btn is-ghost';
    later.textContent = 'Not now';
    later.onclick = function() { localStorage.setItem(CAP_IMPORT_KEY, 'dismissed'); bar.remove(); };
    bar.appendChild(imp);
    bar.appendChild(later);
    var host = $id('tab-caption') && $id('tab-caption').querySelector('.cap-flex-col');
    if (host) host.insertBefore(bar, host.children[1] || null);
}

/* Notice at the top of Generate while an engine part is missing. */
function capUpdateEngineNotice() {
    var area = $id('cap-engine-setup-area');
    if (!area || !nodeReady) return;
    capRefreshEngine();
    var missing = capMissingEngineFiles();
    if (!resolveModelDir()) missing.push('Speech model (large-v3)');
    var bar = $id('cap-engine-notice');
    if (!missing.length) { if (bar) bar.remove(); return; }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'cap-engine-notice';
        bar.className = 'rfxdep-notice';
        bar.appendChild(document.createElement('span'));
        var btn = document.createElement('button');
        btn.className = 'rfxdep-btn is-primary';
        btn.textContent = 'Set up';
        btn.onclick = function() { capOpenSettings(); };
        bar.appendChild(btn);
        area.insertBefore(bar, area.firstChild);
    }
    bar.firstChild.textContent = 'Captions need a few downloads first: ' + missing.join(', ') + '.';
}

/* ---------------------------------------------------------------------------
   BOOT
   --------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", function() {
    if (!$id('tab-caption')) return;

    nodeReady = initNode();

    if (nodeReady && window.csInterface) {
        try {
            initPaths();
            ensureFolders();
        } catch(e) {
            nodeReady = false;
            console.warn('[Caption] Path init failed.', e);
        }
    }

    loadSettings();
    if (nodeReady) loadCaptionBackend(function(){});
    if (nodeReady) window.captionRefreshFolders();
    if (nodeReady) {
        capShowImportOffer();
        capUpdateEngineNotice();
        if (window.RFXDeps) {
            var capNoticeTimer = null;
            RFXDeps.on(function(evt) {
                if (evt.tab && evt.tab !== 'caption') return;
                clearTimeout(capNoticeTimer);
                capNoticeTimer = setTimeout(capUpdateEngineNotice, 300);
            });
            setTimeout(function() { RFXDeps.dailyCheck('caption'); }, 20000);   // quiet, at most once a day
        }
    }
    initColorPicker();

    if ($id('cap-color-select') && window.buildCustomDropdown) window.buildCustomDropdown('cap-color-select');
    if ($id('cap-box-color-select') && window.buildCustomDropdown) window.buildCustomDropdown('cap-box-color-select');
    loadCaptionTabOrder();
    initCaptionTabScroll();
    initCaptionTabDrag();
    if (nodeReady) bindPresetLoaders();

    ['cap-set-chars', 'cap-set-mindur', 'cap-set-gap', 'cap-color-select',
     'cap-set-bg-enable', 'cap-set-bg-padx', 'cap-set-bg-pady', 'cap-set-bg-round',
     'cap-set-bg-opacity', 'cap-set-bg-adj', 'cap-box-color-select'].forEach(function(id) {
        var el = $id(id);
        if (el) el.addEventListener('change', saveSettings);
    });

    Array.prototype.forEach.call(document.getElementsByName('cap-set-lines'), function(r) {
        r.addEventListener('change', saveSettings);
    });

    // Playhead sync - only while the Caption tab AND its Editor sub-tab are visible.
    capPollTimer = setInterval(function() {
        if (!isCaptionEditorVisible()) return;
        if (capIsSplitting) return;
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return;
        captionSyncEditorToPlayhead(false, true);
    }, 200);

    window.addEventListener('tabSwitched', function(e) {
        if (e.detail !== 'tab-caption') return;
        captionSyncSubTabHighlight();
        if (isCaptionEditorVisible()) window.captionRefreshEditorTimeline();
    });

    if (window.csInterface) {
        ["documentAfterActivate", "applicationActivate", "documentAfterSave"].forEach(function(evt) {
            window.csInterface.addEventListener(evt, function() {
                if (isCaptionEditorVisible()) window.captionRefreshEditorTimeline();
            });
        });
    }
});

})();
