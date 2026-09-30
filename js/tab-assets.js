/* =====================================================================
   ULTIMATE FX SUITE — ASSETS TAB  (front-end)
   Talks to assets.jsx through AX.eval(jsx, cb).
   ===================================================================== */

/* ---------------------------------------------------------------------
   Self-contained bridge. The tab no longer depends on globals.js for
   talking to ExtendScript, and never silently swallows a backend error.
   AX.eval returns the RAW string AE returns (JSON, "error: ...", or
   "EvalScript error."), so failures always show their real cause.
   --------------------------------------------------------------------- */
window.AX = window.AX || {};
AX.eval = function(script, cb){
    cb = cb || function(){};
    try {
        if (typeof csInterface !== 'undefined' && csInterface && csInterface.evalScript){
            csInterface.evalScript(script, function(r){ cb(r); });
        } else if (typeof window.safeEval === 'function'){
            window.safeEval(script, cb);
        } else {
            cb('error: no ExtendScript bridge (csInterface not available)');
        }
    } catch (e){ cb('error: eval bridge threw: ' + e); }
};
/* guarantee UI feedback exists even if globals.js failed to load */
if (typeof window.showToast !== 'function') window.showToast = function(m){ try { alert(m); } catch(e){} };
if (typeof window.showNotification !== 'function') window.showNotification = function(m){ try { alert(m); } catch(e){} };

/* getSystemPath() may return a percent-encoded file:// URL; cep.fs needs a plain
   native path. Convert "file:///C:/Program%20Files%20%28x86%29/..." -> "C:/Program Files (x86)/...". */
window.toNativePath = function(p){
    if (!p) return p;
    p = String(p);
    if (p.indexOf('file://') === 0){
        p = p.replace(/^file:\/\//, '');
        try { p = decodeURIComponent(p); } catch (e){}
        if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1);   // drop the slash before a drive letter
    }
    return p.replace(/\\/g, '/');
};

/* This tab's own FFmpeg (js/deps.js), used only for GIF previews. The managed copy
   (Settings) wins; otherwise the existing one under bin/win/assets is used. */
(function registerAssetsDeps(){
    if (!window.RFXDeps || typeof require !== 'function') return;
    var nodePath = require('path');
    RFXDeps.register('assets', { label: 'Assets', deps: [
        { id: 'ffmpeg', label: 'FFmpeg', sizeHint: '185 MB',
          description: 'Only needed for GIF previews (BtbN stable build, this tab\'s own copy). Image-sequence previews work without it.',
          main: 'ffmpeg.exe', latest: RFXDeps.sources.ffmpegStable(), sourceKey: 'ffmpeg-btbn', extractPatterns: ['*/bin/ffmpeg.exe'],
          collect: function(x, out, h){ var f = h.findFile(x, 'ffmpeg.exe', 4); if (f) h.moveInto(f, nodePath.join(out, 'ffmpeg.exe')); },
          verify: { args: ['-version'], expect: /ffmpeg version/ },
          legacy: { main: 'ffmpeg.exe' } }
    ] });
    setTimeout(function(){ RFXDeps.dailyCheck('assets'); }, 25000);   // quiet, at most once a day
})();

/* Load this tab's ExtendScript backend (assets.jsx) into the AE engine.
   Reads the file and evals its contents — more reliable than $.evalFile. */
(function loadAssetsBackend() {
    if (typeof csInterface === 'undefined' || !csInterface || !window.cep || !window.cep.fs) return;
    /* getSystemPath can return a percent-encoded file:// URL (e.g. on Windows CEP),
       but cep.fs.readFile needs a plain native path. Normalize it. */
    var rawRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
    var root    = window.toNativePath(rawRoot);
    var jsxPath = root + '/jsx/assets.jsx';
    var notes   = [];   // collected for the diagnostic file
    notes.push('rawRoot = ' + rawRoot);
    notes.push('nativeRoot = ' + root);

    /* Strategy 1: read the file in JS (native path) and eval its contents in the
       global ExtendScript scope, so every function declaration persists. */
    var loadedVia = null;
    try {
        var r = window.cep.fs.readFile(jsxPath, window.cep.encoding.UTF8);
        notes.push('cep.fs.readFile.err = ' + (r ? r.err : 'null') +
                   ' (NO_ERROR=' + window.cep.fs.NO_ERROR + ')');
        notes.push('cep.fs.readFile.dataLength = ' + ((r && r.data) ? r.data.length : 0));
        if (r && r.err === window.cep.fs.NO_ERROR && r.data && r.data.length > 0) {
            notes.push('contains _bundleReturn = ' + (r.data.indexOf('_bundleReturn') !== -1));
            csInterface.evalScript(r.data, function(){});
            loadedVia = 'readFile+eval';
        }
    } catch (e) { notes.push('readFile threw: ' + e); }

    /* Strategy 2 (fallback): let ExtendScript read the file itself via $.evalFile.
       This succeeds in cases where cep.fs.readFile cannot (encoding/permission). */
    if (!loadedVia) {
        try {
            var esc = jsxPath.replace(/\\/g, '/');
            csInterface.evalScript('(function(){try{$.evalFile(File("' + esc + '"));return "ok";}catch(e){return "evalFile-fail:"+e;}})()',
                function(rr){ notes.push('$.evalFile result = ' + rr); });
            loadedVia = '$.evalFile (attempted)';
        } catch (e) { notes.push('$.evalFile threw: ' + e); }
    }

    /* Verify +, on failure, write a full readable diagnostic to the Desktop. */
    setTimeout(function () {
        csInterface.evalScript('(function(){try{if(typeof assetsBackendVersionJSX!=="function")return "no-fn";return "v"+assetsBackendVersionJSX();}catch(e){return "throw:"+e;}})()', function (res) {
            window.__assetsBackendStatus = res;
            if (res === 'v7') return; // backend live and current — nothing to report

            /* Ask ExtendScript what IT can see at that path, and dump a report to the Desktop.
               This snippet is self-contained — it does NOT depend on assets.jsx. */
            var jsFacts = ('ROOT (extension path AE loaded):\n  ' + root +
                           '\n\nExpected backend file:\n  ' + jsxPath +
                           '\n\nHandshake returned: ' + res +
                           '\nLoad strategy used: ' + (loadedVia || 'none') +
                           '\n\nJS-side notes:\n  - ' + notes.join('\n  - ') + '\n')
                          .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
            var esProbe =
                '(function(){var o="";'
              + 'var f=new File("' + jsxPath.replace(/\\/g,'/') + '");'
              + 'o+="ExtendScript sees jsx/assets.jsx exists = "+f.exists+"\\n";'
              + 'o+="ExtendScript file length = "+(f.exists?f.length:-1)+"\\n";'
              + 'var jf=new Folder("' + (root + '/jsx').replace(/\\/g,'/') + '");'
              + 'o+="jsx folder exists = "+jf.exists+"\\n";'
              + 'if(jf.exists){var l=jf.getFiles();o+="jsx folder contains ("+l.length+"):\\n";for(var i=0;i<l.length;i++){o+="   "+l[i].name+"\\n";}}'
              + 'o+="backend version fn = "+(typeof assetsBackendVersionJSX==="function"?assetsBackendVersionJSX():"undefined")+"\\n";'
              + 'var report="=== RFX ASSETS DIAGNOSTIC ===\\n\\n' + jsFacts + '\\nExtendScript-side checks:\\n"+o;'
              + 'try{var d=new File(Folder.desktop.fsName+"/RFX_assets_diagnostic.txt");d.encoding="UTF-8";d.open("w");d.write(report);d.close();return "WROTE:"+d.fsName;}catch(e){return "WRITEFAIL:"+e;}'
              + '})()';
            csInterface.evalScript(esProbe, function(loc){
                var where = (loc && loc.indexOf('WROTE:') === 0) ? loc.substring(6) : null;
                var short = 'ASSETS BACKEND NOT READY (handshake: ' + res + ').\n\n' +
                    (where
                        ? 'A full diagnostic was written to your Desktop:\n' + where +
                          '\n\nOpen that file and send me its contents.'
                        : 'Could not write a diagnostic file (' + loc + ').\n\nAE loaded the extension from:\n' + root);
                showNotification('Assets backend not ready — see Desktop\\RFX_assets_diagnostic.txt', 'error');
                try { alert(short); } catch (e) {}
            });
        });
    }, 700);
})();

let rootAssetPath = "", currentAssetPath = "", isAssetsProcessing = false;
let assetsViewMode = localStorage.getItem('ufxAssetsView') || 'grid';
let assetsSearchTerm = "";
let assetsCurrentItems = [];          // last listing for current folder
let _thumbQueue = [], _thumbBusy = false;   // video/image thumbnails are generated one at a time
let assetsSelected = null;            // currently open asset in drawer
const MEDIA_EXT = { video: ['mp4','mov','webm','m4v','avi','mkv'], audio: ['mp3','wav','aac','m4a','ogg','flac','aif','aiff'], image: ['png','jpg','jpeg','gif','webp','bmp','tif','tiff','svg'] };

/* ---------- init ---------- */
function resolveLibraryRoot(done){
    if (typeof csInterface === 'undefined'){ if (done) done(); return; }
    /* A folder chosen in Settings always wins over the default, even when it is missing
       right now (e.g. an unplugged drive): the user is told instead of being switched. */
    const savedPath = localStorage.getItem('ultAssetsLibPath');
    if (savedPath){
        rootAssetPath = currentAssetPath = savedPath;
        if (window.cep.fs.stat(savedPath).err !== window.cep.fs.NO_ERROR)
            showToast("Library folder not found: " + savedPath + " (Settings > Change to pick another)");
        if (done) done(); return;
    }
    AX.eval('assetsDefaultLibraryJSX()', p => {
        p = (p || '').replace(/^"|"$/g, '');
        if (!p || p.indexOf('error') === 0) p = window.toNativePath(csInterface.getSystemPath(SystemPath.MY_DOCUMENTS)) + "/RFX/Library";
        rootAssetPath = currentAssetPath = p; if (done) done();
    });
}

/* ---------- utilities ---------- */
function toggleAssetLock(state){
    isAssetsProcessing = state;
    const tab = document.getElementById('tab-assets');
    if (tab) tab.classList.toggle('ui-lock', state);
    if (!state) hideAssetBusy();
}

/* =====================================================================
   BUSY MODAL

   Saving a comp, rendering its preview and encoding a GIF are blocking round
   trips through After Effects. One centred modal carries all of it: a
   spinner, what is happening, and one line of detail. Each phase updates the
   same modal in place, so nothing pops up anywhere else while it runs. The
   spinner is a pure CSS transform, so it keeps turning even while After
   Effects holds the panel.
   ===================================================================== */
function showAssetBusy(label, detail){
    let el = document.getElementById('asset-busy');
    if (!el){
        el = document.createElement('div');
        el.id = 'asset-busy';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = '<div class="ab-card"><div class="ab-spin" aria-hidden="true"></div>'
                     + '<div class="ab-label"></div><div class="ab-detail"></div></div>';
        document.body.appendChild(el);
    }
    clearTimeout(el._hideT);
    el.querySelector('.ab-label').textContent = label || 'Working…';
    updateAssetBusy(detail);
    requestAnimationFrame(() => el.classList.add('in'));
    return el;
}
function updateAssetBusy(detail){
    const el = document.getElementById('asset-busy'); if (!el) return;
    const d = el.querySelector('.ab-detail');
    d.textContent = detail || '';
    d.style.display = detail ? '' : 'none';
}
function hideAssetBusy(){
    const el = document.getElementById('asset-busy');
    if (!el) return;
    el.classList.remove('in');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(() => { try { el.remove(); } catch(e){} }, 200);
}
/* Show the modal, give it a moment to paint, THEN start the blocking call —
   otherwise After Effects can freeze the panel before the modal ever appears. */
function busyThen(label, detail, fn){ showAssetBusy(label, detail); setTimeout(fn, 60); }
function fileUrl(p, ver){
    if (!p) return "";
    p = String(p).replace(/\\/g, "/");
    const parts = p.split('/').map(seg => encodeURIComponent(seg).replace(/%3A/g, ':'));
    let joined = parts.join('/');
    if (joined.charAt(0) !== '/') joined = '/' + joined;   // windows drive letter
    /* a version token gives a STABLE url (fetched once, replayed from memory);
       without one, cache-bust so refreshed thumbs always show */
    return 'file://' + joined + (ver != null ? '?v=' + encodeURIComponent(ver) : '?t=' + Date.now());
}
function escHtml(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtTime(sec){
    if (isNaN(sec) || sec == null) return "0:00";
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    const mm = (h ? String(m).padStart(2,'0') : String(m)), ss = String(s).padStart(2,'0');
    return (h ? h + ":" : "") + mm + ":" + ss;
}
function extOf(name){ const d = String(name).lastIndexOf('.'); return d === -1 ? "" : name.substring(d+1).toLowerCase(); }
function mediaKindOf(name){
    const e = extOf(name);
    for (const k in MEDIA_EXT) if (MEDIA_EXT[k].indexOf(e) !== -1) return k;
    return null;
}
function readMeta(bundlePath){
    try { const r = window.cep.fs.readFile(bundlePath + "/.meta.json", window.cep.encoding.UTF8);
          if (r.err === window.cep.fs.NO_ERROR) return JSON.parse(r.data); } catch(e){}
    return null;
}
function writeMeta(bundlePath, meta){
    try { window.cep.fs.writeFile(bundlePath + "/.meta.json", JSON.stringify(meta), window.cep.encoding.UTF8); } catch(e){}
}

/* ---------- navigation ---------- */
window.assetsSetCustomLibrary = function(){
    const result = window.cep.fs.showOpenDialogEx(false, true, "Select a Folder for your Assets Library", "", []);
    if (result.data && result.data.length){
        const p = result.data[0].replace(/\\/g, "/");
        localStorage.setItem('ultAssetsLibPath', p);
        rootAssetPath = p; currentAssetPath = p; assetsRefresh(); showToast("Library folder updated!");
    }
};
window.assetsNavRoot = function(){ if (isAssetsProcessing) return; currentAssetPath = rootAssetPath; assetsRefresh(); };
window.navigateTo = function(enc){ if (isAssetsProcessing) return; currentAssetPath = decodeURIComponent(enc); assetsRefresh(); };

window.assetsToggleView = function(mode){
    // no arg => flip; explicit arg => set (used on boot)
    if (!mode) mode = (assetsViewMode === 'grid') ? 'list' : 'grid';
    assetsViewMode = mode; localStorage.setItem('ufxAssetsView', mode);
    const btn = document.getElementById('assets-view-btn');
    if (btn){
        btn.classList.toggle('mode-list', mode === 'list');
        btn.classList.toggle('mode-grid', mode === 'grid');
        btn.setAttribute('data-tooltip', mode === 'grid' ? 'Switch to list view' : 'Switch to grid view');
    }
    const scroll = document.getElementById('assets-scroll'); if (scroll) scroll.classList.toggle('list', mode === 'list');
    if (assetsCurrentItems && assetsCurrentItems.length) renderAssets();
};

/* =====================================================================
   REFRESH  /  RENDER
   ===================================================================== */
window.assetsRefresh = function(){
    if (isAssetsProcessing) return; toggleAssetLock(true);
    const grid = document.getElementById('assets-grid'), breadcrumb = document.getElementById('assets-breadcrumb');
    if (!grid || !breadcrumb){ toggleAssetLock(false); return; }

    /* breadcrumb */
    breadcrumb.innerHTML = `<span class="breadcrumb-root" data-path="${encodeURIComponent(rootAssetPath)}" onclick="assetsNavRoot()">Library</span>`;
    let rel = currentAssetPath.replace(rootAssetPath, "");
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.substring(1);
    if (rel){ let accum = rootAssetPath; rel.split(/[\\/]/).forEach(part => { accum += "/" + part;
        breadcrumb.innerHTML += `<span class="breadcrumb-sep">/</span><span class="breadcrumb-item" data-path="${encodeURIComponent(accum)}" onclick="navigateTo('${encodeURIComponent(accum)}')">${escHtml(part)}</span>`; }); }

    AX.eval(`assetsGetDirJSX("${encodeURIComponent(currentAssetPath)}")`, function(jsonStr){
        try {
            if (!jsonStr) throw new Error("Empty response from AE.");
            if (jsonStr.startsWith("error")) throw new Error(jsonStr);
            if (jsonStr === "EvalScript error.") throw new Error("JSX function missing.");
            if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) jsonStr = jsonStr.substring(1, jsonStr.length-1).replace(/\\"/g, '"');
            assetsCurrentItems = JSON.parse(jsonStr);
            renderAssets();
        } catch (e){ showToast("Render Error: " + e.message); }
        finally { toggleAssetLock(false); }
    });
};

/* Frontend safety net: if the backend tagged a bundle as a plain folder but it
   actually holds a media/aep/expr payload, render it as the correct asset. Keeps
   media assets from ever falling back to folders regardless of the backend. */
function maybeAsset(item){
    if (!item || !item.isFolder) return item;
    try {
        const res = window.cep.fs.readdir(item.path);
        if (!res || res.err !== window.cep.fs.NO_ERROR || !res.data) return item;
        let payload = null, kind = null;
        for (const n of res.data){
            if (!n || n.charAt(0) === '.' || n === '(Footage)') continue;
            const low = n.toLowerCase();
            if (low.indexOf('.aep') !== -1){ kind = 'comp'; payload = n; break; }
            if (low.indexOf('.expr.json') !== -1){ kind = 'expr'; payload = n; break; }
            const k = mediaKindOf(n);
            if (k){ kind = k; payload = n; break; }
        }
        if (!kind) return item;                       // genuine folder — leave it
        const meta = readMeta(item.path) || { kind };
        if (!meta.kind) meta.kind = kind;
        let thumb = '';
        try { if (window.cep.fs.stat(item.path + '/.thumb.png').err === window.cep.fs.NO_ERROR){ thumb = item.path + '/.thumb.png'; meta.hasThumb = true; } } catch(e){}
        return { name: item.name, isFolder: false, isAsset: true, kind: meta.kind, path: item.path, meta: meta, thumb: thumb };
    } catch(e){ return item; }
}

function renderAssets(){
    const grid = document.getElementById('assets-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let items = assetsCurrentItems.slice();
    if (assetsSearchTerm){
        const t = assetsSearchTerm.toLowerCase();
        items = items.filter(it => (it.name || "").toLowerCase().indexOf(t) !== -1);
    }
    /* tag filter: an asset must carry EVERY selected tag. Folders stay visible so
       the library is still navigable while a filter is on. */
    if (assetsTagFilter.length){
        items = items.filter(it => {
            if (it.isFolder) return true;
            const tg = readTags(it.path).map(x => x.toLowerCase());
            return assetsTagFilter.every(f => tg.indexOf(f.toLowerCase()) !== -1);
        });
    }
    if (!items.length){
        const empty = document.createElement('div'); empty.className = 'assets-empty-state';
        empty.innerHTML = assetsSearchTerm
            ? `<svg viewBox="0 0 24 24" width="34" height="34" stroke="currentColor" stroke-width="1.3" fill="none" style="color:var(--rfx-text-4);margin-bottom:10px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><div class="title">No matches for “${escHtml(assetsSearchTerm)}”.</div><div class="sub">Try a different search.</div>`
            : assetsTagFilter.length
            ? `<svg viewBox="0 0 24 24" width="34" height="34" stroke="currentColor" stroke-width="1.3" fill="none" style="color:var(--rfx-text-4);margin-bottom:10px;"><path d="M20.6 8.4 12 17l-4-4"></path><path d="M3 7h6"></path><path d="M3 12h4"></path><path d="M3 17h4"></path></svg><div class="title">Nothing tagged ${escHtml(assetsTagFilter.map(t=>'#'+t).join(' '))}.</div><div class="sub">Clear the filter or tag some assets.</div>`
            : `<svg viewBox="0 0 24 24" width="38" height="38" stroke="currentColor" stroke-width="1.2" fill="none" style="color:var(--rfx-text-4);margin-bottom:12px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><div class="title">No assets yet.</div><div class="sub">Use the Save menu below to add comps, layers, expressions or media.</div>`;
        grid.appendChild(empty); return;
    }

    items = items.map(maybeAsset);   // reclassify mis-tagged media/comp/expr bundles

    if (assetsSort.by === 'name' && assetsSort.dir === 'asc' && assetsSort.group === 'none'){
        /* the default view keeps whatever order the user dragged things into */
        let savedOrder = []; try { savedOrder = JSON.parse(localStorage.getItem('rfx_order_' + currentAssetPath)) || []; } catch(e){}
        items.sort((a,b) => (savedOrder.indexOf(a.name)===-1?99999:savedOrder.indexOf(a.name)) - (savedOrder.indexOf(b.name)===-1?99999:savedOrder.indexOf(b.name)));
    } else {
        items = sortAssets(items);
    }

    const add = it => grid.appendChild(it.isFolder ? createFolderCard(it) : createAssetCard(it));
    if (assetsSort.group === 'none'){
        items.forEach(it => { if (it.isFolder) add(it); });
        items.forEach(it => { if (!it.isFolder) add(it); });
    } else {
        /* group headers span the whole grid row so both views read the same */
        const order = [], buckets = {};
        items.forEach(it => {
            const k = groupKeyFor(it);
            if (!buckets[k]){ buckets[k] = []; order.push(k); }
            buckets[k].push(it);
        });
        order.forEach(k => {
            const h = document.createElement('div');
            h.className = 'asset-group-head';
            h.innerHTML = `<span>${escHtml(k)}</span><i>${buckets[k].length}</i>`;
            grid.appendChild(h);
            buckets[k].forEach(add);
        });
    }
}

/* ---------- placeholder icons ---------- */
function kindIcon(kind, size){
    size = size || 30; const sw = 1.7;
    const wrap = svg => `<span class="placeholder ${kind}">${svg}</span>`;
    switch (kind){
        case 'folder': return wrap(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="${sw}" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`);
        case 'comp':
        case 'layers': return wrap(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="${sw}" fill="none"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`);
        case 'expr': return wrap(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="${sw}" fill="none"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`);
        case 'video': return wrap(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="${sw}" fill="none"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>`);
        case 'audio': return wrap(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="${sw}" fill="none"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`);
        case 'image': return wrap(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" stroke-width="${sw}" fill="none"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`);
        default: return wrap(kindIcon('comp', size));
    }
}
const kindLabel = { comp:'Comp', layers:'Layers', expr:'EXPR', video:'Video', audio:'Audio', image:'Image' };

/* ---------- folder card ---------- */
function createFolderCard(item){
    const card = document.createElement('div');
    card.className = 'asset-card folder-card'; card.dataset.name = item.name; card.draggable = true;
    card.innerHTML =
        `<div class="asset-thumb">${kindIcon('folder', 34)}</div>
         <div class="asset-card-body"><div class="asset-card-label" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
         <div class="asset-card-sub asset-list-kind">Folder</div></div>`;
    wireDrag(card, item, true);
    card.addEventListener('click', () => { if (!isAssetsProcessing) navigateTo(encodeURIComponent(item.path)); });
    card.addEventListener('contextmenu', e => assetContextMenu(e, item));
    return card;
}

/* ---------- asset card ---------- */
function queueAudioWave(item, card){
    const thumbEl = card.querySelector('.asset-thumb'); if (!thumbEl) return;
    const primary = findPrimaryFile(item.path);
    if (!primary){ thumbEl.insertAdjacentHTML('afterbegin', kindIcon('audio', 30)); return; }
    const cv = document.createElement('canvas');
    cv.className = 'audio-wave-thumb';
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;display:block;';
    thumbEl.style.position = thumbEl.style.position || 'relative';
    thumbEl.insertBefore(cv, thumbEl.firstChild);
    drawWaveform(cv, primary, function(ok){ if (!ok){ try { cv.remove(); } catch(e){} thumbEl.insertAdjacentHTML('afterbegin', kindIcon('audio', 30)); } });
}
function createAssetCard(item){
    const meta = item.meta || {};
    const kind = item.kind || meta.kind || 'comp';
    const displayName = (meta.name || item.name).replace(/\.(aep|expr\.json|props\.json)$/,'');
    const card = document.createElement('div');
    card.className = 'asset-card'; card.dataset.name = item.name; card.dataset.path = item.path; card.draggable = true;

    let sub = kindLabel[kind] || 'Asset';
    if ((kind === 'comp' || kind === 'layers' || kind === 'video' || kind === 'image') && meta.width) sub = meta.width + "×" + meta.height;
    else if (kind === 'audio' && meta.duration) sub = fmtTime(meta.duration);

    const durBadge = (meta.duration && (kind==='comp'||kind==='layers'||kind==='video'||kind==='audio'))
        ? `<span class="asset-duration">${fmtTime(meta.duration)}</span>` : '';
    const playHint = (kind === 'video' || kind === 'audio')
        ? `<span class="asset-play-hint"><svg viewBox="0 0 24 24" width="30" height="30" opacity="0.92"><circle cx="12" cy="12" r="12" style="fill:var(--rfx-scrim)"/><polygon points="10 8 16 12 10 16" style="fill:var(--rfx-on-media)"/></svg></span>` : '';

    let thumbInner = kindIcon(kind, 30);
    if (item.thumb || meta.hasThumb){
        const tp = item.thumb || (item.path + "/.thumb.png");
        thumbInner = `<img src="${fileUrl(tp)}" onerror="this.style.display='none';this.parentNode.insertAdjacentHTML('afterbegin', assetsIconFallback('${kind}'))" alt="">`;
    }
    if (kind === 'audio' && !(item.thumb || meta.hasThumb)) thumbInner = '';   // waveform drawn after create
    const flip = (meta.hasPreview && meta.previewCount) ? `<img class="flip" data-count="${meta.previewCount}" alt="">` : '';
    /* just the first tag, small, in the corner of the thumb — the cards are too
       narrow to carry a row of them without becoming noise */
    const cardTags = readTags(item.path);
    const cardTag = cardTags.length
        ? `<span class="card-tag" style="--th:${tagHue(cardTags[0])}" title="${escHtml(cardTags.map(t=>'#'+t).join(' '))}">#${escHtml(cardTags[0])}</span>` : '';

    card.innerHTML =
        `<div class="asset-thumb">${thumbInner}${flip}<span class="asset-badge ${kind}">${(kindLabel[kind]||'').substring(0,5)}</span>${durBadge}${playHint}${cardTag}</div>
         <div class="asset-card-body">
            <div class="asset-card-label" title="${escHtml(displayName)}">${escHtml(displayName)}</div>
            <div class="asset-card-sub">${escHtml(sub)}</div>
            <div class="asset-list-kind">${kindLabel[kind]||'Asset'}</div>
         </div>`;

    /* lazy thumbnail generation for media that has none yet */
    if (!(item.thumb || meta.hasThumb) && (kind === 'video' || kind === 'image')) queueMediaThumb(item, card);
    if (!(item.thumb || meta.hasThumb) && kind === 'audio') queueAudioWave(item, card);

    /* hover flipbook (AE motion previews) — real speed, loaded frames only.
       The overlay stays hidden until its first frame has actually loaded, so a
       cold start (first hovers after launching After Effects) never shows an
       empty or broken image over the card. It also rounds its own corners, so
       it can never spill past the thumbnail's edge while it is composited. */
    if (flip){
        const flipImg = card.querySelector('.flip');
        const n = meta.previewCount, base = item.path + "/.preview/";
        const fps = previewPlaybackFps(meta, n), stamp = previewStamp(meta);
        let timer = null, t0 = 0, shown = -1, frames = null, hovering = false;
        flipImg.style.borderRadius = 'inherit';
        flipImg.style.opacity = '0';
        const tick = () => {
            const want = Math.floor((performance.now() - t0) / 1000 * fps) % n;
            if (want === shown) return;
            const f = frames[want];
            if (f && f._ok){ flipImg.src = f.src; shown = want; }   // not loaded yet: hold the last frame, keep the clock
        };
        card.addEventListener('mouseenter', () => {
            hovering = true;
            frames = flipFrames(base, n, stamp);
            onFlipFrameReady(frames[0], () => {
                if (!hovering || !frames[0]._ok) return;
                flipImg.src = frames[0].src; shown = 0;
                flipImg.style.opacity = '';
                flipImg.classList.add('playing');
                t0 = performance.now();
                if (timer) clearInterval(timer);
                timer = setInterval(tick, Math.max(16, Math.min(100, 500 / fps)));
            });
        });
        card.addEventListener('mouseleave', () => {
            hovering = false;
            flipImg.classList.remove('playing');
            flipImg.style.opacity = '0';
            if (timer){ clearInterval(timer); timer = null; }
            shown = -1;
        });
    }

    /* hover preview for real media: video plays muted-looping, audio pulses */
    if (!flip && (item.meta && item.meta.previewFormat === 'gif')){
        const thumbEl = card.querySelector('.asset-thumb'); let gimg = null;
        thumbEl.style.position = thumbEl.style.position || 'relative';
        card.addEventListener('mouseenter', () => {
            if (!gimg){
                gimg = document.createElement('img');
                gimg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:3;border-radius:inherit;opacity:0;';
                gimg.onload = () => { if (gimg.style.display !== 'none') gimg.style.opacity = '1'; };
                thumbEl.appendChild(gimg);
            }
            gimg.style.opacity = '0'; gimg.style.display = 'block';
            gimg.src = fileUrl(item.path + "/.preview/preview.gif");   // fresh url restarts the GIF at frame 1
        });
        card.addEventListener('mouseleave', () => { if (gimg){ gimg.style.display = 'none'; gimg.style.opacity = '0'; gimg.src = ''; } });
    }
    if (kind === 'video' || kind === 'audio') wireMediaHover(card, item, kind);

    wireDrag(card, item, false);
    wireClickDblClick(card, () => openDrawer(item), () => quickImport(item));
    card.addEventListener('contextmenu', e => assetContextMenu(e, item));
    return card;
}
window.assetsIconFallback = function(kind){ return kindIcon(kind, 30); };

/* =====================================================================
   PREVIEW FRAMES  (image-sequence previews of comps / layers)

   Real-time rate: the preview is n stills spread over the comp's duration,
   so it plays at the rate recorded at render time (previewFps), else
   (n-1)/duration, else the comp frame rate. The hover flipbook and the big
   player both use this, so they match each other and the imported comp.

   Frames load through STABLE urls (versioned by the render, not by the
   clock) into a small cache. Each frame is fetched and decoded once and then
   replays from memory; the player only ever shows frames that have loaded,
   holding the last good one otherwise, so there is never a blank or broken
   frame and a slow disk drops frames rather than slowing the clock.
   ===================================================================== */
function previewPlaybackFps(meta, n){
    meta = meta || {};
    var fps;
    if (meta.previewFps > 0) fps = meta.previewFps;
    else if (n > 1 && meta.duration > 0) fps = (n - 1) / meta.duration;
    else if (meta.frameRate > 0) fps = meta.frameRate;
    else fps = 12;
    var cap = Math.max(30, meta.frameRate || 0);
    return Math.max(0.5, Math.min(cap, fps));
}
function previewStamp(meta){
    meta = meta || {};
    return meta.previewStamp ? String(meta.previewStamp) : ((meta.previewCount || 0) + '-' + (meta.created || 0));
}
var _flipCache = new Map();                 // most recently used last
function flipFrames(base, n, stamp){
    var key = base + '|' + n + '|' + stamp;
    var set = _flipCache.get(key);
    if (set){ _flipCache.delete(key); _flipCache.set(key, set); return set; }
    set = [];
    for (var i = 0; i < n; i++){
        var im = new Image();
        im.decoding = 'async';
        im._ok = false; im._settled = false; im._wait = null;
        im.onload  = function(){ this._ok = true;  _flipSettle(this); };
        im.onerror = function(){ this._ok = false; _flipSettle(this); };
        im.src = fileUrl(base + 'f' + String(i).padStart(3, '0') + '.png', stamp);
        set.push(im);
    }
    _flipCache.set(key, set);
    /* keep a handful of assets warm; older ones are simply released */
    while (_flipCache.size > 8) _flipCache.delete(_flipCache.keys().next().value);
    return set;
}
function _flipSettle(im){ im._settled = true; var w = im._wait; im._wait = null; if (w) w.forEach(function(fn){ try { fn(); } catch(e){} }); }
/* run fn once this frame has finished loading (or failed — check im._ok) */
function onFlipFrameReady(im, fn){ if (!im) return; if (im._settled){ fn(); return; } (im._wait = im._wait || []).push(fn); }

/* click vs dblclick discriminator */
function wireClickDblClick(el, onClick, onDbl){
    let t = null;
    el.addEventListener('click', () => { if (isAssetsProcessing) return; if (t){ return; } t = setTimeout(() => { t = null; onClick(); }, 210); });
    el.addEventListener('dblclick', () => { if (t){ clearTimeout(t); t = null; } if (!isAssetsProcessing) onDbl(); });
}

/* hover preview: build a muted looping <video> over the thumb on hover-intent
   (removed on leave to stay light), or an animated equaliser for audio */
function wireMediaHover(card, item, kind){
    const thumb = card.querySelector('.asset-thumb');
    if (!thumb) return;
    ensureOvcStyles();   // make sure the hover-volume styles exist even before any drawer is opened
    let hoverTimer = null, vid = null, bars = null, primary = null, aud = null, hvol = null, closeT = null;

    const activeMedia = () => vid || aud;

    const SPK = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.5 8.5a5 5 0 0 1 0 7"></path>';
    const MUT = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>';

    const ensureHvol = () => {
        if (hvol){ hvol._sync(); return hvol; }
        var sc = document.getElementById('assets-scroll');
        var isList = !!(sc && sc.classList.contains('list'));
        var host = isList ? card : thumb;
        if (!isList) thumb.style.position = thumb.style.position || 'relative';
        hvol = document.createElement('div');
        hvol.className = isList ? 'hvol hvol-list' : 'hvol';
        hvol.innerHTML =
            '<input type="range" class="rng" min="0" max="100" value="' + Math.round(getPreviewVol()*100) + '">' +
            '<button class="spk"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none">' + SPK + '</svg></button>';
        const rng = hvol.querySelector('.rng'), spk = hvol.querySelector('.spk'), ico = spk.querySelector('svg');
        const paint = () => { const m = activeMedia(); const v = Number(rng.value)/100;
            ico.innerHTML = (v === 0 || (m && m.muted)) ? MUT : SPK; };
        /* the one place this control takes its state from: the shared volume */
        const sync = (v) => { if (v == null) v = getPreviewVol();
            rng.value = Math.round(v * 100);
            const m = activeMedia(); if (m){ m.volume = v; m.muted = (v === 0); }
            paint(); };
        hvol._sync = () => sync();
        const openV  = () => { if (closeT){ clearTimeout(closeT); closeT = null; }
            var host = hvol.parentNode; var availW = (host ? host.clientWidth : 120) - 26 - 22;
            var w = Math.max(26, Math.min(72, availW)); hvol.style.setProperty('--hvw', w + 'px');
            hvol.classList.add('open'); };
        const closeV = () => { closeT = setTimeout(() => hvol.classList.remove('open'), 240); };
        hvol.draggable = false;
        spk.addEventListener('mouseenter', openV);
        hvol.addEventListener('mouseenter', function(){ card.draggable = false; openV(); });
        hvol.addEventListener('mouseleave', function(){ card.draggable = true; closeV(); });
        hvol.addEventListener('mousedown', function(e){ card.draggable = false; e.stopPropagation(); });
        hvol.addEventListener('dragstart', function(e){ e.preventDefault(); e.stopPropagation(); });
        rng.addEventListener('input', (e) => { e.stopPropagation(); setPreviewVol(Number(rng.value)/100); });
        rng.addEventListener('click', e => e.stopPropagation());
        spk.addEventListener('click', (e) => { e.stopPropagation(); togglePreviewMute(); });
        host.appendChild(hvol);
        onPreviewVol(hvol, sync);
        sync();
        return hvol;
    };
    const applyVol = (m) => { const v = getPreviewVol(); m.volume = v; m.muted = (v === 0); };

    const startVideo = () => {
        if (primary === null) primary = findPrimaryFile(item.path) || '';
        if (!primary || vid) return;
        thumb.style.position = thumb.style.position || 'relative';
        vid = document.createElement('video');
        vid.className = 'hover-vid';
        /* invisible until the first frame is decoded (cold decoder on the first
           hovers after launch), and rounded to the thumbnail's own corners */
        vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:3;border-radius:inherit;opacity:0;transition:opacity .12s ease;';
        vid.loop = true; vid.playsInline = true; vid.preload = 'auto';
        applyVol(vid);
        vid.addEventListener('loadeddata', () => { if (vid){ vid.classList.add('playing'); vid.style.opacity = '1'; } });
        vid.addEventListener('error', () => { if (vid){ vid.remove(); vid = null; } });
        thumb.appendChild(vid);
        vid.src = fileUrl(primary);
        const p = vid.play();
        if (p && p.catch) p.catch(() => { try { vid.muted = true; vid.play(); } catch(e){} });
        ensureHvol();
    };
    const stopVideo = () => { if (vid){ try { vid.pause(); } catch(e){} vid.remove(); vid = null; } };

    let specCanvas = null, specRaf = null, specData = null, specViz = null;
    const showEq = () => {
        if (!specCanvas){
            specCanvas = document.createElement('canvas');
            specCanvas.className = 'audio-spectrum';
            specCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;display:block;border-radius:inherit;';
            thumb.style.position = thumb.style.position || 'relative';
            thumb.appendChild(specCanvas);
        }
        specCanvas.style.display = 'block';
        /* hide the static icon (and anything else) while the spectrum plays; keep the volume control */
        Array.prototype.forEach.call(thumb.children, function(c){
            if (c !== specCanvas && !(c.classList && c.classList.contains('hvol'))){ c.dataset._rfxvis = c.style.visibility || ''; c.style.visibility = 'hidden'; }
        });
        try { window.__rfxActx = window.__rfxActx || new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
        var ctx = window.__rfxActx;
        if (ctx && aud){
            try { if (ctx.state === 'suspended') ctx.resume(); } catch(e){}
            if (!aud._analyser){
                try {
                    aud._srcNode = ctx.createMediaElementSource(aud);
                    aud._analyser = ctx.createAnalyser();
                    aud._analyser.fftSize = 2048;
                    aud._analyser.smoothingTimeConstant = 0.6;
                    aud._srcNode.connect(aud._analyser);
                    _vizRouteVolume(aud, ctx, aud._analyser);
                } catch(e){ aud._analyser = null; }
            }
        }
        const draw = () => {
            specRaf = requestAnimationFrame(draw);
            const an = aud && aud._analyser; const g = specCanvas.getContext('2d');
            const size = _vizFitCanvas(specCanvas); if (!size) return;
            const W = size.W, H = size.H;
            if (!an){ g.clearRect(0, 0, W, H); return; }
            if (!specData || specData.length !== an.frequencyBinCount) specData = new Uint8Array(an.frequencyBinCount);
            an.getByteFrequencyData(specData);
            if (!specViz) specViz = createPulseViz(specCanvas, { key: primary || item.path });
            var env = specViz.analyse(specData, an.frequencyBinCount);
            specViz.step(env);
            specViz.draw(g, W, H, Date.now()/1000);
        };
        if (!specRaf) draw();
    };
    const hideEq = () => {
        if (specRaf){ cancelAnimationFrame(specRaf); specRaf = null; }
        if (specCanvas) specCanvas.style.display = 'none';
        Array.prototype.forEach.call(thumb.children, function(c){
            if (c.dataset && c.dataset._rfxvis !== undefined){ c.style.visibility = c.dataset._rfxvis; delete c.dataset._rfxvis; }
        });
    };
    const startAudio = () => {
        if (primary === null) primary = findPrimaryFile(item.path) || '';
        if (!primary){ showEq(); return; }
        if (!aud){
            aud = document.createElement('audio');
            aud.preload = 'auto';
            aud.addEventListener('error', () => { if (aud){ aud.remove(); aud = null; } });
            thumb.appendChild(aud);
            aud.src = fileUrl(primary);
        }
        applyVol(aud);
        try { aud.currentTime = 0; } catch(e){}
        const p = aud.play(); if (p && p.catch) p.catch(() => {});
        showEq();          // after aud exists -> analyser attaches on the FIRST hover
        ensureHvol();
    };
    const stopAudio = () => { hideEq(); if (aud){ try { aud.pause(); aud.currentTime = 0; } catch(e){} } };

    card.addEventListener('mouseenter', () => {
        hoverTimer = setTimeout(() => { kind === 'video' ? startVideo() : startAudio(); }, 160);
    });
    card.addEventListener('mouseleave', () => {
        if (hoverTimer){ clearTimeout(hoverTimer); hoverTimer = null; }
        if (closeT){ clearTimeout(closeT); closeT = null; }
        if (hvol) hvol.classList.remove('open');
        kind === 'video' ? stopVideo() : stopAudio();
    });
}
function queueMediaThumb(item, card){ _thumbQueue.push({ item, card }); processThumbQueue(); }
function processThumbQueue(){
    if (_thumbBusy || !_thumbQueue.length) return;
    _thumbBusy = true; const { item, card } = _thumbQueue.shift();
    const kind = item.kind;
    const primary = findPrimaryFile(item.path);
    if (!primary){ _thumbBusy = false; processThumbQueue(); return; }
    const done = dataURL => {
        if (dataURL){
            const b64 = dataURL.split(',')[1];
            try { window.cep.fs.writeFile(item.path + "/.thumb.png", b64, window.cep.encoding.Base64);
                  const m = readMeta(item.path) || item.meta || {}; m.hasThumb = true; writeMeta(item.path, m);
                  const thumbEl = card.querySelector('.asset-thumb');
                  if (thumbEl){ thumbEl.querySelector('.placeholder')?.remove();
                      const img = document.createElement('img'); img.src = fileUrl(item.path + "/.thumb.png"); thumbEl.insertBefore(img, thumbEl.firstChild); }
            } catch(e){}
        }
        _thumbBusy = false; setTimeout(processThumbQueue, 30);
    };
    if (kind === 'video') makeVideoThumb(fileUrl(primary), done);
    else if (kind === 'image') makeImageThumb(fileUrl(primary), done);
    else done(null);
}
function findPrimaryFile(bundlePath){
    try {
        const res = window.cep.fs.readdir(bundlePath);
        if (!res || res.err !== window.cep.fs.NO_ERROR || !res.data) return null;
        for (const n of res.data){
            if (!n || n.charAt(0) === '.' || n === '(Footage)') continue;
            if (n.indexOf('.') === -1) continue;              // skip extension-less entries (folders)
            /* CEP's stat().data.isDirectory is a METHOD in some builds and a boolean in others —
               handle both so a real file is never rejected. */
            let isDir = false;
            try {
                const st = window.cep.fs.stat(bundlePath + "/" + n);
                if (st && st.err === window.cep.fs.NO_ERROR && st.data){
                    isDir = (typeof st.data.isDirectory === 'function') ? st.data.isDirectory() : !!st.data.isDirectory;
                }
            } catch(e){}
            if (!isDir) return bundlePath + "/" + n;
        }
    } catch(e){}
    return null;
}
function makeVideoThumb(url, cb){
    const v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.crossOrigin = 'anonymous';
    let done = false; const finish = d => { if (done) return; done = true; try { v.src=''; } catch(e){} cb(d); };
    v.addEventListener('loadeddata', () => { try { v.currentTime = Math.min(0.1, (v.duration||1)/2); } catch(e){ finish(null); } });
    v.addEventListener('seeked', () => {
        try { const c = document.createElement('canvas'); const w = 320, ratio = (v.videoHeight||9)/(v.videoWidth||16);
            c.width = w; c.height = Math.round(w*ratio); c.getContext('2d').drawImage(v,0,0,c.width,c.height);
            finish(c.toDataURL('image/png')); } catch(e){ finish(null); } });
    v.addEventListener('error', () => finish(null));
    setTimeout(() => finish(null), 8000); v.src = url;
}
function makeImageThumb(url, cb){
    const img = new Image(); let done = false; const finish = d => { if (done) return; done = true; cb(d); };
    img.onload = () => { try { const c = document.createElement('canvas'); const w = 320, ratio = img.height/img.width;
        c.width = w; c.height = Math.round(w*ratio); c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        finish(c.toDataURL('image/png')); } catch(e){ finish(null); } };
    img.onerror = () => finish(null); setTimeout(() => finish(null), 8000); img.src = url;
}
/* One volume for every preview in the panel — hover thumbs and the open asset
   alike. First run starts at 30% so the extension never blasts anyone.

   Every control that shows the volume subscribes here. A change from any of
   them — a slider or a speaker button — is stored once and pushed to all the
   others, so the level, every slider and every speaker icon always agree.
   Each subscriber is tied to an element and is dropped as soon as that
   element leaves the document, so nothing leaks as cards and drawers come
   and go. */
var _volSubs = [];
function getPreviewVol(){ var v = parseFloat(localStorage.getItem('rfx_preview_vol')); return isNaN(v) ? 0.30 : Math.max(0, Math.min(1, v)); }
function setPreviewVol(v){
    v = Math.max(0, Math.min(1, Number(v) || 0));
    try { localStorage.setItem('rfx_preview_vol', String(v)); } catch(e){}
    for (var i = _volSubs.length - 1; i >= 0; i--){
        var sub = _volSubs[i];
        if (!sub.el || !sub.el.isConnected){ _volSubs.splice(i, 1); continue; }
        try { sub.fn(v); } catch(e){}
    }
}
function onPreviewVol(el, fn){ _volSubs.push({ el: el, fn: fn }); }
/* mute remembers the level it came from, shared like the level itself, so
   un-muting from ANY control restores the same volume */
function togglePreviewMute(){
    var v = getPreviewVol();
    if (v > 0){ try { localStorage.setItem('rfx_preview_vol_last', String(v)); } catch(e){} setPreviewVol(0); return; }
    var last = parseFloat(localStorage.getItem('rfx_preview_vol_last'));
    setPreviewVol(last > 0 ? last : 0.30);
}
function _roundRectPath(g, x, y, w, h, r){
    r = Math.min(r, w/2, h/2);
    g.beginPath();
    g.moveTo(x+r, y);
    g.arcTo(x+w, y,   x+w, y+h, r);
    g.arcTo(x+w, y+h, x,   y+h, r);
    g.arcTo(x,   y+h, x,   y,   r);
    g.arcTo(x,   y,   x+w, y,   r);
    g.closePath();
}
/* =====================================================================
   FLAT PULSE VISUALIZER  —  solid core + pill equaliser + sonar ripples

   Deliberately flat: no gradients, no shadows, no glow, no blend modes,
   no motion blur. Every shape is a uniform fill.

     - one perfect, solid, accent-coloured circle in the exact centre
     - five white pill bars inside it, symmetric (tall centre -> small
       edges), stretching vertically from their own centre line
     - ripples EMITTED on beats from behind the core, scaling outward
       while their opacity falls off, fading into the background

   Each audio file gets its own accent hue, derived from its path, so the
   colour is stable across thumbnail / hover / drawer for the same file.
   The reference art is orange-on-white; AE and this panel are dark, so
   the same flat palette is rendered on the panel's dark surface. Pass
   { bg: '#ffffff', ink: 'light' } to flip it back to the white version.
   ===================================================================== */

/* hand-picked, evenly pleasing hues — warm, cool and everything between */
var VIZ_PALETTE = [16, 28, 40, 88, 142, 166, 188, 206, 232, 262, 288, 320, 344];

function vizHash(key){
    var s = String(key == null ? '' : key), h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++){ h = (h ^ s.charCodeAt(i)) >>> 0; h = (Math.imul(h, 16777619)) >>> 0; }
    return h >>> 0;
}
function vizHueFor(key){ return VIZ_PALETTE[vizHash(key) % VIZ_PALETTE.length]; }

/* =====================================================================
   AUDIO FINGERPRINT -> COLOUR

   Measured once per file when it is decoded, cached by path, and shared by
   the thumbnail, the hover preview and the drawer so one track always wears
   one colour. Three independent features drive three channels:

     brightness (spectral tilt)  -> HUE          bass-heavy reads red/orange,
                                                 airy and bright reads teal/blue/violet
     punch (transient density)   -> SATURATION   percussive is vivid, ambient is muted
     loudness (mean RMS)         -> LIGHTNESS    louder masters sit brighter

   Brightness uses mean|dx| / mean|x| — cheap, and a good stand-in for spectral
   centroid. It is measured over fixed-length windows of CONSECUTIVE samples and
   normalised against the sample rate, so the number never shifts with a file's
   length or format.
   ===================================================================== */
var VIZ_SIG = {};
/* Decoded 96-point envelopes, keyed by file path. The thumbnail pass fills this,
   so opening the drawer for a track that already has a card costs nothing — the
   old code read and decoded the whole file a SECOND time on the main thread,
   which is what stuttered the slide-up animation. */
var VIZ_ENV = {};
var VIZ_ENV_ORDER = [];
function vizEnvPut(key, levels){
    if (!key || !levels) return;
    if (!VIZ_ENV[key]) VIZ_ENV_ORDER.push(key);
    VIZ_ENV[key] = levels;
    while (VIZ_ENV_ORDER.length > 120){ const k = VIZ_ENV_ORDER.shift(); delete VIZ_ENV[k]; }  // bounded
}

/* Read + decode an audio file off the critical path.
   The base64 -> bytes conversion is chunked so a large file cannot hold the main
   thread long enough to drop frames, and the whole thing is deferred by `delay`
   so an opening animation finishes first. */
function decodeAudioEnvelope(path, delay, done){
    if (VIZ_ENV[path]){ done(VIZ_ENV[path]); return; }
    setTimeout(function(){
        try {
            const st = window.cep.fs.stat(path);
            if (st.err === window.cep.fs.NO_ERROR && st.data.size > 80*1024*1024){ done(null); return; }
            const res = window.cep.fs.readFile(path, window.cep.encoding.Base64);
            if (res.err !== window.cep.fs.NO_ERROR){ done(null); return; }
            const b = atob(res.data), buf = new Uint8Array(b.length);
            const CHUNK = 65536;
            let i = 0;
            (function fill(){
                const end = Math.min(b.length, i + CHUNK * 8);
                for (; i < end; i++) buf[i] = b.charCodeAt(i);
                if (i < b.length){ setTimeout(fill, 0); return; }   // yield so the UI keeps painting
                const actx = new (window.AudioContext || window.webkitAudioContext)();
                actx.decodeAudioData(buf.buffer, function(dec){
                    const ch = dec.getChannelData(0);
                    vizStoreSignature(path, ch, dec.sampleRate);
                    const lv = fileEnvelope(ch, 96);
                    vizEnvPut(path, lv);
                    try { actx.close(); } catch(e){}
                    done(lv);
                }, function(){ try { actx.close(); } catch(e){} done(null); });
            })();
        } catch(e){ done(null); }
    }, delay || 0);
}

function fileSignature(chan, sr){
    var n = chan && chan.length; if (!n) return null;
    var WIN = 1024, NW = 160;
    if (n < WIN * 4) WIN = Math.max(32, Math.floor(n / 8));
    if (WIN < 32) return null;
    var hop = Math.max(WIN, Math.floor((n - WIN) / NW)) || WIN;
    var rms = [], sumA = 0, sumD = 0, cnt = 0;
    for (var w = 0; w + WIN <= n && rms.length < NW; w += hop){
        var s2 = 0, prev = chan[w];
        for (var i = 0; i < WIN; i++){
            var x = chan[w + i], ax = x < 0 ? -x : x, d = x - prev;
            s2 += x * x; sumA += ax; sumD += (d < 0 ? -d : d); prev = x; cnt++;
        }
        rms.push(Math.sqrt(s2 / WIN));
    }
    if (!cnt || rms.length < 2) return null;
    var meanA = sumA / cnt;
    var bright = meanA > 1e-7 ? (sumD / cnt) / meanA * (44100 / (sr || 44100)) : 0;
    var mean = 0; for (var k = 0; k < rms.length; k++) mean += rms[k];
    mean /= rms.length;
    var rise = 0; for (var k2 = 1; k2 < rms.length; k2++){ var dd = rms[k2] - rms[k2 - 1]; if (dd > 0) rise += dd; }
    rise /= (rms.length - 1);
    return {
        bright: bright,
        loud:  Math.min(1, mean * 3.2),
        punch: Math.min(1, (mean > 1e-7 ? rise / mean : 0) * 2.6)
    };
}
function vizStoreSignature(key, chan, sr){
    try { var sg = fileSignature(chan, sr); if (sg) VIZ_SIG[String(key == null ? '' : key)] = sg; } catch(e){}
}

/* hue ramp: dark/bassy -> bright/airy, spaced so it moves quickly through the
   muddy yellow-greens and lingers in the tones that actually look good */
var VIZ_RAMP = [14, 26, 38, 52, 96, 152, 174, 190, 204, 220, 242, 266, 292];
/* brightness window the ramp is stretched across. Calibrated for full-band music:
   ~0.10 is a sub-heavy mix, ~0.65 is a very bright/noisy one. Widen or narrow these
   two numbers if a library ends up clustering at one end of the ramp. */
var VIZ_BRIGHT_LO = 0.05, VIZ_BRIGHT_HI = 0.32;

function vizSatScale(){
    var v = window.RFXTheme ? parseFloat(window.RFXTheme.cssVar('--rfx-viz-sat', '1')) : 1;
    return isNaN(v) ? 1 : v;
}
function vizPalette(key, ink){
    var k = String(key == null ? '' : key), sg = VIZ_SIG[k];
    if (!sg) return { hue: vizHueFor(k), sat: 88, light: (ink === 'light' ? 58 : 55), ripL: (ink === 'light' ? 60 : 68) };
    var t = (sg.bright - VIZ_BRIGHT_LO) / (VIZ_BRIGHT_HI - VIZ_BRIGHT_LO);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var f = t * (VIZ_RAMP.length - 1), i0 = Math.floor(f), i1 = Math.min(VIZ_RAMP.length - 1, i0 + 1);
    var hue = VIZ_RAMP[i0] + (VIZ_RAMP[i1] - VIZ_RAMP[i0]) * (f - i0);
    hue += (vizHash(k) % 15) - 7;                       // nudge so near-identical tracks still separate
    hue = ((hue % 360) + 360) % 360;
    var light = Math.round((ink === 'light' ? 48 : 46) + 14 * sg.loud);
    return {
        hue: Math.round(hue),
        sat: Math.round(62 + 30 * sg.punch),
        light: light,
        ripL: Math.min(76, light + (ink === 'light' ? 12 : 20))
    };
}

/* Size the backing store to the canvas' REAL laid-out box. Returns null while
   the element still has no layout, so callers can wait instead of guessing a
   fallback size and baking in the wrong aspect ratio (= squeezed circles). */
function _vizFitCanvas(canvas){
    var dpr = 2, cssW = 0, cssH = 0;
    try { var r = canvas.getBoundingClientRect(); cssW = r.width; cssH = r.height; } catch(e){}
    if (!cssW || !cssH){ cssW = canvas.offsetWidth; cssH = canvas.offsetHeight; }
    if ((!cssW || !cssH) && canvas.parentNode){ cssW = canvas.parentNode.clientWidth; cssH = canvas.parentNode.clientHeight; }
    if (!cssW || !cssH) return null;
    var W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== W || canvas.height !== H){ canvas.width = W; canvas.height = H; }
    return { W: W, H: H };
}

/* Move volume control to a gain node placed AFTER the analyser, so the analyser
   always taps a full-scale signal. An element's own .volume attenuates upstream of
   createMediaElementSource, which meant turning playback down also flattened the
   visualiser. The element is pinned wide open and .volume / .muted are shadowed with
   accessors driving the gain, so every existing read and write still behaves normally. */
function _vizRouteVolume(el, ctx, analyser){
    if (!el || !ctx || !analyser || el._volRouted) return;
    var gain = ctx.createGain();
    analyser.connect(gain); gain.connect(ctx.destination);
    var v = (typeof el.volume === 'number') ? el.volume : 1, mu = !!el.muted;
    el.volume = 1; el.muted = false;                // element itself always runs at unity
    var apply = function(){ try { gain.gain.value = mu ? 0 : v; } catch(e){} };
    apply();
    try {
        Object.defineProperty(el, 'volume', { configurable: true,
            get: function(){ return v; },
            set: function(x){ x = Number(x); v = x < 0 ? 0 : (x > 1 ? 1 : (x || 0)); apply(); } });
        Object.defineProperty(el, 'muted', { configurable: true,
            get: function(){ return mu; },
            set: function(x){ mu = !!x; apply(); } });
    } catch(e){}
    el._gain = gain; el._volRouted = true;
}

function createPulseViz(canvas, opts){
    opts = opts || {};

    var BARS    = 5;
    var NBAND   = 5;                                // one frequency band per bar -> independent motion
    var SHAPE   = [0.46, 0.76, 1.00, 0.76, 0.46];   // per-bar height ceiling: tall centre, small edges
    var BAND    = [3, 1, 0, 2, 4];                  // frequency fans outward from the centre:
                                                    // centre = bass (always the loudest), edges = highs
    var KEY     = String(opts.key == null ? '' : opts.key);
    var INK     = opts.ink;
    var BG      = opts.bg || null;                  // null -> transparent, let the stage show through
    var BAR     = opts.bar || '#ffffff';                 // rfx-content-color (bars drawn on the coloured core)
    var RIP_A   = (opts.alpha != null) ? opts.alpha : 0.40;
    /* macro intensity -> how much room the whole figure is allowed to take.
       Sized so the widest possible ring still clears the frame. */
    /* The figure barely changes size now — intense sections lengthen the SPIKES, they
       do not inflate the whole widget. */
    var S_LO = 0.94, S_HI = 1.07;
    /* Worst-case core swell. The circle is the entire visual now, so it breathes
       gently and sits large rather than pumping — minimal and clean. */
    var CORE_E = 0.060, CORE_P = 0.100;             // swell from loudness / from a beat
    var CR_HI = 1 + CORE_E + CORE_P * 1.30;
    /* Share of the preview box the circle may ever occupy, measured on the SHORT side so
       it fits the wide grid thumb and the small square list thumb alike. */
    var CORE_FILL = 0.88;

    var viz = {
        hue: (opts.hue != null) ? opts.hue : vizHueFor(KEY),
        energy: 0, level: 0, beat: 0, pulse: 0,
        env:   new Float32Array(NBAND),
        peak:  new Float32Array(NBAND),
        floor: new Float32Array(NBAND),
        bar:   new Float32Array(BARS),
        bins: null, fluxAvg: 0,
        macro: 0.5, mLevel: 0, mRef: 0, mN: 0,
        clock: 0,
        bPrev: new Float32Array(NBAND), bAvg: new Float32Array(NBAND), bHit: new Float32Array(NBAND),
        _t: null, _cool: 0, _frozen: false, _pal: null, _palSig: undefined
    };
    for (var b0 = 0; b0 < NBAND; b0++){ viz.peak[b0] = 0.35; viz.floor[b0] = 0; }
    for (var i0 = 0; i0 < BARS;  i0++) viz.bar[i0] = 0.50;   // pleasant resting pose before any audio

    /* ---- analysis: 5 log bands with adaptive floor/ceiling + per-bin flux beat detection ---- */
    viz.analyse = function(data, binCount){
        viz._frozen = false; viz._soft = null;      // live audio releases a frozen static pose
        var minBin = 1, maxBin = Math.max(minBin + 2, Math.floor(binCount * 0.80));

        /* spectral flux across every bin — far more reliable than band-level flux */
        if (!viz.bins || viz.bins.length !== binCount) viz.bins = new Float32Array(binCount);
        var flux = 0;
        for (var i = minBin; i < maxBin; i++){
            var x = data[i] / 255;
            var dx = x - viz.bins[i]; if (dx > 0) flux += dx;
            viz.bins[i] = x;
        }
        flux /= (maxBin - minBin);
        viz.fluxAvg = viz.fluxAvg * 0.88 + flux * 0.12;
        var ratio = flux / (viz.fluxAvg + 1e-4);
        viz.beat = (ratio > 1.40 && flux > 0.004) ? Math.min(1, (ratio - 1.40) / 1.30) : 0;

        /* band energies, each normalised against its own slow floor..ceiling window
           so every bar uses its full travel whatever the spectral tilt of the track */
        var total = 0;
        for (var b = 0; b < NBAND; b++){
            var f0 = minBin * Math.pow(maxBin / minBin, b / NBAND);
            var f1 = minBin * Math.pow(maxBin / minBin, (b + 1) / NBAND);
            var lo = Math.floor(f0), hi = Math.max(lo + 1, Math.floor(f1)), s = 0, c = 0;
            for (var j = lo; j < hi && j < binCount; j++){ s += data[j]; c++; }
            var v = c ? (s / c) / 255 : 0;
            v = Math.pow(v, 0.55);                                        // perceptual

            /* per-band onset: the rise in THIS band only, against this band's own
               recent average rise. Gated on the band also being genuinely loud right
               now, so quiet incidental detail can't throw the companion circles. */
            var bd = v - viz.bPrev[b]; if (bd < 0) bd = 0;
            viz.bPrev[b] = v;
            viz.bAvg[b] = viz.bAvg[b] * 0.90 + bd * 0.10;
            /* gate against the CURRENT raw value, not viz.env — env is still holding the
               pre-transient level at this point in the frame, which would veto the very
               onset we are trying to detect */
            var loudNow = v / (viz.peak[b] > 0.12 ? viz.peak[b] : 0.12);
            viz.bHit[b] = (bd > viz.bAvg[b] * 2.10 && bd > 0.045 && loudNow > 0.55)
                ? Math.min(1, bd / (viz.bAvg[b] * 4 + 0.05)) : 0;

            viz.env[b] += (v - viz.env[b]) * (v > viz.env[b] ? 0.70 : 0.24);

            if (viz.env[b] > viz.peak[b])  viz.peak[b]  = viz.env[b];
            else                           viz.peak[b] += (viz.env[b] - viz.peak[b])  * 0.006;   // ceiling sinks slowly
            if (viz.env[b] < viz.floor[b]) viz.floor[b] = viz.env[b];
            else                           viz.floor[b] += (viz.env[b] - viz.floor[b]) * 0.004;  // floor rises slowly
            if (viz.peak[b] - viz.floor[b] < 0.07) viz.peak[b] = viz.floor[b] + 0.07;
            total += v;
        }
        var raw = total / NBAND;
        viz.level += (raw - viz.level) * (raw > viz.level ? 0.55 : 0.12);
        viz.energy = Math.min(1, viz.level * 1.8);

        /* ---- macro intensity: how loud this passage is RELATIVE TO THE TRACK'S OWN
           running loudness. Measured as a ratio against a long-run reference rather
           than a min/max window — a window's floor creeps up during a sustained loud
           section until it swallows the ceiling, which made long drops shrink back to
           nothing. A ratio can't collapse: a drop reads high however long it lasts,
           and the reference re-centres itself as the track moves on. ---- */
        viz.mLevel += (viz.level - viz.mLevel) * (viz.level > viz.mLevel ? 0.020 : 0.006);
        /* running mean of the whole track: rate 1/n converges fast from the first
           seconds, then floors out so it keeps drifting with a long piece instead of
           chasing whatever section is playing */
        viz.mN++;
        viz.mRef += (viz.level - viz.mRef) * Math.max(0.0004, 1 / (viz.mN + 20));
        var ref = viz.mRef < 0.05 ? 0.05 : viz.mRef;
        var mr = (viz.mLevel / ref - 0.78) / 0.48;  // 0.78x baseline -> 0, 1.26x -> full size
        mr = mr < 0 ? 0 : (mr > 1 ? 1 : mr);
        viz.macro += (mr - viz.macro) * 0.035;      // glides between sections, never jitters
        return viz.env;
    };

    /* ---- bar targets: snappy attack, soft release, full 0..1 travel ---- */
    viz.step = function(){
        for (var i = 0; i < BARS; i++){
            var b    = BAND[i];
            var span = viz.peak[b] - viz.floor[b];
            var lvl  = span > 0 ? (viz.env[b] - viz.floor[b]) / span : 0;
            lvl = lvl < 0 ? 0 : (lvl > 1 ? 1 : lvl);
            /* floor of 0.15 keeps the arrow silhouette readable between hits
               instead of every bar collapsing to an identical dot */
            var target = 0.15 + 0.85 * Math.pow(lvl, 0.85);
            viz.bar[i] += (target - viz.bar[i]) * (target > viz.bar[i] ? 0.72 : 0.13);
        }
    };

    /* ---- render ---- */
    viz.draw = function(g, W, H, t){
        var m = Math.min(W, H), cx = W / 2, cy = H / 2;

        /* easing into a late-arriving static pose */
        if (viz._soft){
            var sd = 0;
            for (var sb = 0; sb < BARS; sb++){
                viz.bar[sb] += (viz._soft.bar - viz.bar[sb]) * 0.16;
                sd += Math.abs(viz._soft.bar - viz.bar[sb]);
            }
            viz.energy += (viz._soft.energy - viz.energy) * 0.16;
            viz.macro  += (0.5 - viz.macro) * 0.16;
            if (sd < 0.02 && Math.abs(viz._soft.energy - viz.energy) < 0.01){
                viz.level = viz.energy / 1.8; viz.pulse = 0; viz.beat = 0;
                viz._soft = null; viz._frozen = true;
            }
        }

        /* resolve the colour lazily: the fingerprint may land after the first paint,
           and this keeps thumbnail / hover / drawer locked to one palette per file */
        var sig = VIZ_SIG[KEY];
        if (viz._palSig !== sig || !viz._pal){
            viz._pal = vizPalette(KEY, INK); viz._palSig = sig;
            if (opts.hue != null) viz._pal.hue = opts.hue;
            viz.hue = viz._pal.hue;
        }
        var pal = viz._pal;

        if (typeof t !== 'number' || !isFinite(t)) t = 0;
        var dt = (viz._t === null) ? 0 : Math.max(0, Math.min(0.08, t - viz._t));
        viz._t = t;
        if (viz._frozen) dt = 0;                    // static pose holds exactly as posed

        /* --- macro gearing: quiet passages sit compact, intense ones open right up --- */
        var mac    = viz._frozen ? 0.5 : viz.macro;
        var scale  = S_LO  + (S_HI  - S_LO)  * mac;
        /* base radius solved from the widest state the figure can ever reach — a peak
           beat kick at full macro — so the circle fills the box without ever clipping */
        var R = (m * CORE_FILL * 0.5) / (S_HI * CR_HI);

        /* --- the core still kicks on the overall beat --- */
        if (!viz._frozen && viz.beat > 0) viz.pulse = Math.max(viz.pulse, 0.30 + 0.70 * viz.beat);

        viz.pulse *= Math.exp(-dt * 6.5);

        if (BG){ g.fillStyle = BG; g.fillRect(0, 0, W, H); }
        else   { g.clearRect(0, 0, W, H); }

        /* solid core — swells with the section, kicks on the beat */
        var cr = R * scale * (1 + CORE_E * viz.energy + CORE_P * viz.pulse * (0.7 + 0.6 * mac));

        // per-file hue; its saturation follows the theme (--rfx-viz-sat: 0 in Monochrome)
        g.fillStyle = 'hsl(' + pal.hue + ',' + Math.round(pal.sat * vizSatScale()) + '%,' + pal.light + '%)'; // rfx-content-color
        g.beginPath(); g.arc(cx, cy, cr, 0, Math.PI * 2); g.fill();

        /* five pill bars, stretching from their own centre line */
        var bw = Math.max(1, cr * 0.125), pitch = cr * 0.270, x0 = cx - pitch * 2;
        var maxH = cr * (0.420 + 0.150 * mac);      // bars get more headroom as the track opens up
        g.fillStyle = BAR;
        for (var i = 0; i < BARS; i++){
            var half = bw / 2 + SHAPE[i] * viz.bar[i] * (maxH - bw / 2);
            _roundRectPath(g, x0 + pitch * i - bw / 2, cy - half, bw, half * 2, bw / 2);
            g.fill();
        }

    };

    /* static pose from a decoded file (thumbnail / paused drawer).
       `soft` eases into the pose instead of snapping to it — used when the decode
       lands after the drawer is already on screen, so the circle and the bars glide
       to their resting shape rather than jumping a frame. */
    viz.setStatic = function(levels, soft){
        var n = (levels && levels.length) || 0, sum = 0, pk = 0;
        for (var i = 0; i < n; i++){ sum += levels[i]; if (levels[i] > pk) pk = levels[i]; }
        var avg = n ? sum / n : 0.5;
        var lvl = Math.max(0.46, Math.min(1, avg * 1.35 + pk * 0.25));
        var tgtE = Math.max(0.25, Math.min(0.80, avg * 1.6));
        if (soft){
            viz._soft = { bar: lvl, energy: tgtE };
            viz._frozen = false;                  // draw eases it in, then freezes
            return;
        }
        for (var j = 0; j < BARS; j++) viz.bar[j] = lvl;
        viz.energy = tgtE;
        viz.level = viz.energy / 1.8; viz.pulse = 0; viz.beat = 0; viz.macro = 0.5;
        viz._cool = 0; viz._frozen = true;
    };

    return viz;
}
/* back-compat alias for any older call site */
function createNcsViz(canvas, opts){ return createPulseViz(canvas, opts); }

/* Paint a frozen pose once the canvas actually has a layout box, and repaint it
   whenever that box changes (grid <-> list view, panel resize). */
function paintStaticViz(canvas, levels, key, bg){
    var viz = createPulseViz(canvas, { key: key, bg: bg }), tries = 0;
    viz.setStatic(levels);
    var paint = function(){
        if (!canvas.parentNode){ if (canvas._vizRO){ try { canvas._vizRO.disconnect(); } catch(e){} canvas._vizRO = null; } return; }
        var s = _vizFitCanvas(canvas);
        if (!s){ if (tries++ < 150) requestAnimationFrame(paint); return; }
        tries = 0; viz._t = null;
        viz.draw(canvas.getContext('2d'), s.W, s.H, 0);
    };
    canvas._vizPaint = paint;
    canvas._vizArgs = { levels: levels, key: key };
    canvas.classList.add('rfx-static-viz');
    paint();
    if (window.ResizeObserver && !canvas._vizRO){
        try { canvas._vizRO = new ResizeObserver(function(){ if (canvas._vizPaint) canvas._vizPaint(); }); canvas._vizRO.observe(canvas); } catch(e){}
    }
    return viz;
}
/* The thumbnails are drawn once, so a theme change (Monochrome <-> Color, saturation,
   brightness) repaints them with the new colours. The drawer redraws every frame. */
(function(){
    var pending = 0;
    window.addEventListener('rfx-theme-change', function(){
        if (pending) cancelAnimationFrame(pending);
        pending = requestAnimationFrame(function(){
            pending = 0;
            var bg = window.RFXTheme ? window.RFXTheme.cssVar('--rfx-input') : null;
            document.querySelectorAll('#tab-assets canvas.rfx-static-viz').forEach(function(cv){
                if (cv._vizArgs && cv.parentNode) paintStaticViz(cv, cv._vizArgs.levels, cv._vizArgs.key, bg);
            });
        });
    });
})();
/* whole-file amplitude envelope over time (for the static thumbnail / paused drawer) */
function fileEnvelope(chan, P){
    var levels = [], bucket = Math.max(1, Math.floor(chan.length/P)), peak = 0;
    for (var p=0;p<P;p++){
        var s=0, c=0, st=p*bucket, en=Math.min(st+bucket, chan.length);
        for (var j=st;j<en;j++){ var x=chan[j]; s+=x*x; c++; }
        var rms = c ? Math.sqrt(s/c) : 0; levels.push(rms); if (rms>peak) peak=rms;
    }
    var norm = peak>0 ? 1/peak : 1;
    for (var p=0;p<P;p++) levels[p] = Math.pow(levels[p]*norm, 0.7);
    return levels;
}
function drawWaveform(canvas, primaryPath, onDone){
    try {
        const st = window.cep.fs.stat(primaryPath);
        if (st.err === window.cep.fs.NO_ERROR && st.data.size > 80*1024*1024){ if (onDone) onDone(false); return; }
        const res = window.cep.fs.readFile(primaryPath, window.cep.encoding.Base64);
        if (res.err !== window.cep.fs.NO_ERROR){ if (onDone) onDone(false); return; }
        const b = atob(res.data), buf = new Uint8Array(b.length);
        for (let i=0;i<b.length;i++) buf[i] = b.charCodeAt(i);
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        actx.decodeAudioData(buf.buffer, function(decoded){
            var ch = decoded.getChannelData(0);
            vizStoreSignature(primaryPath, ch, decoded.sampleRate);
            var lv = fileEnvelope(ch, 96);
            vizEnvPut(primaryPath, lv);          // the drawer reuses this instead of decoding again
            paintStaticViz(canvas, lv, primaryPath, window.RFXTheme ? window.RFXTheme.cssVar('--rfx-input') : null);
            try { actx.close(); } catch(e){}
            if (onDone) onDone(true);
        }, function(){ try { actx.close(); } catch(e){} if (onDone) onDone(false); });
    } catch(e){ if (onDone) onDone(false); }
}
function wireReactiveWave(canvas, audioEl, primaryPath){
    if (!canvas) return;
    /* Cached from the thumbnail pass in the common case, so this is instant. On a
       miss the work is pushed past the open animation rather than running during it. */
    var fileLevels = VIZ_ENV[primaryPath] || null;
    if (!fileLevels) decodeAudioEnvelope(primaryPath, 420, function(lv){ fileLevels = lv; });
    try { window.__rfxActx = window.__rfxActx || new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
    var ctx = window.__rfxActx, an = null, data = null;
    if (ctx && audioEl){
        try { if (ctx.state === 'suspended') ctx.resume(); } catch(e){}
        if (!audioEl._analyser){ try { audioEl._srcNode = ctx.createMediaElementSource(audioEl); audioEl._analyser = ctx.createAnalyser(); audioEl._analyser.fftSize = 2048; audioEl._analyser.smoothingTimeConstant = 0.6; audioEl._srcNode.connect(audioEl._analyser); _vizRouteVolume(audioEl, ctx, audioEl._analyser); } catch(e){} }
        an = audioEl._analyser;
    }
    var dViz = null;
    function frame(){
        window.__waveRaf = requestAnimationFrame(frame);
        var g = canvas.getContext('2d');
        var size = _vizFitCanvas(canvas); if (!size) return;
        var W = size.W, H = size.H, now = Date.now()/1000;
        if (!dViz) dViz = createPulseViz(canvas, { key: primaryPath });
        if (an && audioEl && !audioEl.paused){
            if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
            an.getByteFrequencyData(data);
            var env = dViz.analyse(data, an.frequencyBinCount);
            dViz.step(env);
            dViz.draw(g, W, H, now);
        } else {
            if (fileLevels && !dViz._posed){ dViz.setStatic(fileLevels, dViz._seen > 4); dViz._posed = true; }
            dViz._seen = (dViz._seen || 0) + 1;
            dViz.draw(g, W, H, now);
        }
    }
    if (window.__waveRaf){ cancelAnimationFrame(window.__waveRaf); window.__waveRaf = null; }
    frame();
}
function ensureDrawer(){
    if (document.getElementById('asset-drawer')) return;
    const tab = document.getElementById('tab-assets');
    const back = document.createElement('div'); back.className = 'asset-drawer-backdrop'; back.id = 'asset-drawer-backdrop';
    back.addEventListener('click', closeDrawer);
    const drawer = document.createElement('div'); drawer.className = 'asset-drawer'; drawer.id = 'asset-drawer';
    drawer.innerHTML = `<div class="asset-drawer-handle"></div><div class="asset-drawer-scroll" id="asset-drawer-scroll"></div>`;
    tab.appendChild(back); tab.appendChild(drawer);
    wireSheetGesture();
}
function closeDrawer(){
    _rfxCleanPortals();
    if (window.__flipTimer){ clearInterval(window.__flipTimer); window.__flipTimer = null; }
    if (window.__waveRaf){ cancelAnimationFrame(window.__waveRaf); window.__waveRaf = null; }
    const d = document.getElementById('asset-drawer'), b = document.getElementById('asset-drawer-backdrop');
    if (d){ d.classList.remove('open'); sheetExpanded = false;
        /* the height is left alone here: it is what the slide-out animates from.
           It is re-primed on the next open. */
        setTimeout(() => { if (!d.classList.contains('open')) d.style.transition = ''; }, 340); const scr = document.getElementById('asset-drawer-scroll'); if (scr){ scr.querySelectorAll('video,audio').forEach(m=>{try{m.pause();}catch(e){}}); } }
    if (b) b.classList.remove('open');
    document.querySelectorAll('.asset-card.selected').forEach(c => c.classList.remove('selected'));
    assetsSelected = null;
}
function openDrawer(item){
    ensureDrawer(); wireSheetGesture(); _rfxCleanPortals(); if (window.__flipTimer){ clearInterval(window.__flipTimer); window.__flipTimer = null; } if (window.__waveRaf){ cancelAnimationFrame(window.__waveRaf); window.__waveRaf = null; } assetsSelected = item;
    document.querySelectorAll('.asset-card.selected').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector('.asset-card[data-path="'+ (window.CSS && CSS.escape ? CSS.escape(item.path) : item.path) +'"]');
    if (card) card.classList.add('selected');

    const meta = item.meta || readMeta(item.path) || {};
    const kind = item.kind || meta.kind || 'comp';
    const name = (meta.name || item.name).replace(/\.(aep|expr\.json|props\.json)$/,'');
    const scroll = document.getElementById('asset-drawer-scroll');

    /* Sub-line under the title: the kind label, then this asset's tags. The old
       dimensions / fps / duration string is gone — it repeated what the stage
       already shows and made the header noisy. */
    const assetTags = readTags(item.path);

    /* stage */
    const primary = findPrimaryFile(item.path);
    let stage = '', controls = '';
    if (kind === 'video' && primary){
        stage = `<div class="asset-stage" id="ad-stage" style="background:var(--rfx-media-bg);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;max-height:360px;position:relative;"><video id="ad-media" src="${fileUrl(primary)}" playsinline style="width:100%;max-height:360px;object-fit:contain;display:block;background:var(--rfx-media-bg);"></video>${mediaControlsHtml(false)}</div>`;
        controls = '';
    } else if (kind === 'audio' && primary){
        stage = `<div class="asset-stage" id="ad-stage" style="background:var(--rfx-input);border-radius:10px;overflow:hidden;position:relative;height:150px;"><canvas class="waveform" id="ad-wave" style="width:100%;height:100%;display:block;"></canvas><audio id="ad-media" src="${fileUrl(primary)}"></audio>${mediaControlsHtml(true)}</div>`;
        controls = '';
    } else if (kind === 'image' && primary){
        stage = `<div class="asset-stage"><img src="${fileUrl(primary)}" alt=""></div>`;
    } else if (kind === 'expr'){
        const exprText = readExpressionText(item.path);
        stage = `<div class="asset-stage expr-stage">
            <button class="expr-copy" id="ad-expr-copy" data-tooltip="Copy expression"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
            <pre class="expr-code" id="ad-expr">${escHtml(exprText || '// expression unavailable')}</pre>
        </div>`;
    } else if ((kind === 'comp' || kind === 'layers') && meta.previewFormat === 'gif'){
        /* a canvas, not an <img> — see decodeGif: the browser gives no control at
           all over a GIF's playback, so the frames are decoded and driven here */
        stage = `<div class="asset-stage" id="ad-stage" style="background:var(--rfx-input);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;max-height:340px;position:relative;"><canvas id="ad-gifcv" style="width:100%;max-height:340px;object-fit:contain;display:block;"></canvas>${flipControlsHtml()}</div>`;
        controls = '';
    } else if ((kind === 'comp' || kind === 'layers') && meta.previewCount > 0){
        stage = `<div class="asset-stage" id="ad-stage" style="background:var(--rfx-input);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;max-height:340px;position:relative;"><img id="ad-flip" style="width:100%;max-height:340px;object-fit:contain;display:block;background:var(--rfx-input);">${flipControlsHtml()}</div>`;
        controls = '';
    } else if (meta.hasThumb || (window.cep.fs.stat(item.path + "/.thumb.png").err === window.cep.fs.NO_ERROR)){
        stage = `<div class="asset-stage"><img src="${fileUrl(item.thumb || (item.path + "/.thumb.png"))}" alt=""></div>`;
    } else {
        stage = `<div class="asset-stage"><span class="stage-icon">${kindIcon(kind, 56)}</span></div>`;
    }

    /* motion-preview generator for aep bundles without a preview */
    let genPreview = '';
    if (kind === 'comp' || kind === 'layers')
        genPreview = `<span class="asset-genpreview" id="ad-genprev"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>${meta.hasPreview ? 'Regenerate preview' : 'Generate preview'}</span>`;

    const importLabel = (kind === 'expr') ? 'Apply Expression' : (kind === 'video'||kind==='audio'||kind==='image') ? 'Add to Comp' : 'Import';

    scroll.innerHTML =
        `<div class="asset-drawer-head">
            <div class="asset-drawer-title"><div class="name">${escHtml(name)}</div>
                <div class="meta ad-metaline"><span class="ad-kind">${(kindLabel[kind]||'Asset')}</span><span class="ad-tagrow" id="ad-tagrow">${tagChipsHtml(assetTags, { removable: true })}</span><button class="ad-tagadd" id="ad-tagadd" data-tooltip="Edit tags"><svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button></div>
            </div>
            <button class="asset-drawer-close" id="ad-close"><svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
         </div>
         ${stage}${controls}
         ${genPreview}
         <div class="asset-drawer-actions" style="margin-top:10px;">
            <button class="btn-primary" id="ad-import">${importLabel}</button>
            <button class="btn-secondary icon-btn" id="ad-reveal" data-tooltip="Reveal in Explorer"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></button>
            <button class="btn-secondary icon-btn" id="ad-rename" data-tooltip="Rename"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"></path></svg></button>
            <button class="btn-secondary icon-btn" id="ad-delete" data-tooltip="Delete"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
         </div>`;

    scroll.querySelector('#ad-close').onclick = closeDrawer;
    const tagAdd = scroll.querySelector('#ad-tagadd');
    if (tagAdd) tagAdd.onclick = () => openTagEditor(item);
    wireHeaderTagRemoval(item);
    scroll.querySelector('#ad-import').onclick = () => { quickImport(item); };
    scroll.querySelector('#ad-reveal').onclick = () => revealInExplorer(item.path);
    scroll.querySelector('#ad-rename').onclick = () => openAssetRenameModal(item.name, item.path);
    scroll.querySelector('#ad-delete').onclick = () => openAssetDeleteModal(name, item.path);
    const gp = scroll.querySelector('#ad-genprev');
    if (gp) gp.onclick = () => openGenPreviewMenu(item, gp);

    const exprCopy = scroll.querySelector('#ad-expr-copy');
    if (exprCopy) exprCopy.onclick = () => showToast(copyToClipboard(readExpressionText(item.path)) ? "Expression copied!" : "Copy failed.");

    if (kind === 'video' || kind === 'audio') wireMediaControls(scroll.querySelector('#ad-media'), scroll, { isAudio: kind === 'audio', stage: scroll.querySelector('#ad-stage'), fsTarget: scroll.querySelector('#ad-stage') });
    if ((kind === 'comp' || kind === 'layers') && meta.previewCount > 0) wireFlipPlayer(scroll, {
        base: item.path + "/.preview/", count: meta.previewCount,
        duration: meta.duration || 0, frameRate: meta.frameRate || 0, previewFps: meta.previewFps || 0,
        stamp: previewStamp(meta),
        stage: scroll.querySelector('#ad-stage') });
    if ((kind === 'comp' || kind === 'layers') && meta.previewFormat === 'gif'){
        wireGifPlayer(scroll, {
            path: meta.gifPath || (item.path + '/.preview/preview.gif'),
            stage: scroll.querySelector('#ad-stage')
        });
    }
    if (kind === 'audio' && primary) setTimeout(() => wireReactiveWave(scroll.querySelector('#ad-wave'), scroll.querySelector('#ad-media'), primary), 60);

    primeSheetHeight();                 // JS owns the height from the moment it opens
    document.getElementById('asset-drawer-backdrop').classList.add('open');
    document.getElementById('asset-drawer').classList.add('open');
}

function _rfxPortalShow(pop, anchor){
    if (!pop || !anchor) return;
    var host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
    if (pop.parentNode !== host) host.appendChild(pop);
    pop.classList.add('rfx-portaled');
    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth || 40, h = pop.offsetHeight || 100;
    var left = Math.round(r.left + r.width/2 - w/2);
    var top  = Math.round(r.top - h - 8);
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
    top  = Math.max(6, top);
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';
    requestAnimationFrame(function(){ pop.classList.add('show'); });
}
function _rfxPortalHide(pop){ if (pop) pop.classList.remove('show'); }
function _rfxCleanPortals(){ var l = document.querySelectorAll('.rfx-portaled'); for (var i=0;i<l.length;i++) l[i].remove(); }

/* Video overlay control styles live in css/tab-assets.css. */
function ensureOvcStyles(){}
/* =====================================================================
   SHARED SPEED MENU

   One implementation for every player. The flipbook used to just cycle the
   rate on each click with no menu at all; now it gets the same popup the
   video and audio players use, and clicking the button while the menu is
   open closes it instead of reopening it.
   ===================================================================== */
const OVC_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];   // slow at the top, fast at the bottom

function speedMenuHtml(id){
    let items = '';
    for (const r of OVC_RATES){
        items += '<button data-rate="' + r + '"' + (r === 1 ? ' class="cur"' : '') + '>' + r + '&times;</button>';
    }
    return '<div class="ovc-speedwrap"><button class="ovc-speed" id="' + id + '">1&times;</button>'
         + '<div class="ovc-speedpop" id="' + id + 'pop">' + items + '</div></div>';
}

/* `apply(rate)` is called with the chosen multiplier. */
function wireSpeedMenu(speed, apply){
    if (!speed) return;
    const wrap = speed.parentNode;
    const pop = wrap ? wrap.querySelector('.ovc-speedpop') : null;
    if (!pop) return;
    let hideT = null, open = false;

    const show = () => { if (hideT){ clearTimeout(hideT); hideT = null; } open = true; _rfxPortalShow(pop, speed); };
    const hide = () => { if (hideT){ clearTimeout(hideT); hideT = null; } open = false; _rfxPortalHide(pop); };
    const hideSoon = () => { hideT = setTimeout(hide, 240); };

    speed.addEventListener('mouseenter', show);
    speed.addEventListener('mouseleave', hideSoon);
    pop.addEventListener('mouseenter', () => { if (hideT){ clearTimeout(hideT); hideT = null; } });
    pop.addEventListener('mouseleave', hideSoon);
    /* a click on the button is a toggle, so it can be dismissed the same way it opened */
    speed.addEventListener('click', e => { e.stopPropagation(); open ? hide() : show(); });

    const btns = pop.querySelectorAll('button');
    btns.forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const r = parseFloat(b.getAttribute('data-rate'));
        try { apply(r); } catch(_){}
        speed.innerHTML = r + '&times;';
        btns.forEach(o => o.classList.remove('cur'));
        b.classList.add('cur');
        hide();                                  // choosing an option closes it
    }));
    return { hide };
}

/* =====================================================================
   GIF DECODER

   A GIF in an <img> cannot be paused, seeked or slowed — the browser owns
   the timeline and exposes nothing. So the file is parsed here into its
   individual frames (header, LZW image data, per-frame delays and disposal
   methods) and composited onto a canvas. Once it is a frame array it is the
   same thing as an image sequence, and it can run through exactly the same
   transport as every other preview.
   ===================================================================== */
function decodeGif(bytes){
    let p = 0;
    const u8 = bytes;
    const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[p++]); return s; };
    const u16 = () => { const v = u8[p] | (u8[p + 1] << 8); p += 2; return v; };

    if (str(6).indexOf('GIF') !== 0) throw new Error('not a gif');
    const width = u16(), height = u16();
    const flags = u8[p++];
    const bgIndex = u8[p++]; p++;                       // pixel aspect ratio, unused
    let gct = null;
    if (flags & 0x80){
        const n = 1 << ((flags & 7) + 1);
        gct = u8.subarray(p, p + n * 3); p += n * 3;
    }

    const frames = [];
    let delay = 10, transparent = -1, disposal = 0;

    const readBlocks = () => {
        const parts = []; let total = 0, len;
        while ((len = u8[p++])){ parts.push(u8.subarray(p, p + len)); total += len; p += len; }
        const out = new Uint8Array(total); let o = 0;
        for (const b of parts){ out.set(b, o); o += b.length; }
        return out;
    };

    /* GIF's variable-width LZW */
    const lzw = (minCode, data, pxCount) => {
        const out = new Uint8Array(pxCount);
        const clear = 1 << minCode, eoi = clear + 1;
        let codeSize = minCode + 1, next = eoi + 1;
        const prefix = new Int32Array(4096), suffix = new Int32Array(4096), stack = new Uint8Array(4096);
        for (let i = 0; i < clear; i++){ prefix[i] = -1; suffix[i] = i; }
        let bits = 0, acc = 0, di = 0, sp = 0, oi = 0, old = -1, first = 0;
        while (oi < pxCount){
            if (bits < codeSize){
                if (di >= data.length) break;
                acc |= data[di++] << bits; bits += 8; continue;
            }
            let code = acc & ((1 << codeSize) - 1);
            acc >>= codeSize; bits -= codeSize;
            if (code === clear){ codeSize = minCode + 1; next = eoi + 1; old = -1; continue; }
            if (code === eoi) break;
            if (old === -1){ out[oi++] = suffix[code]; old = code; first = code; continue; }
            let inCode = code;
            if (code >= next){ stack[sp++] = first; code = old; }
            while (code >= clear){ stack[sp++] = suffix[code]; code = prefix[code]; }
            first = suffix[code];
            out[oi++] = first;
            while (sp > 0 && oi < pxCount) out[oi++] = stack[--sp];
            if (next < 4096){ prefix[next] = old; suffix[next] = first; next++;
                if ((next & (next - 1)) === 0 && next < 4096) codeSize++; }
            old = inCode;
        }
        return out;
    };

    while (p < u8.length){
        const block = u8[p++];
        if (block === 0x3B) break;                      // trailer
        if (block === 0x21){                            // extension
            const label = u8[p++];
            if (label === 0xF9){                        // graphic control
                p++;                                    // block size
                const packed = u8[p++];
                delay = u16() || 10;
                transparent = (packed & 1) ? u8[p++] : (p++, -1);
                disposal = (packed >> 2) & 7;
                p++;                                    // terminator
            } else { readBlocks(); }
            continue;
        }
        if (block !== 0x2C) break;                      // image descriptor
        const ix = u16(), iy = u16(), iw = u16(), ih = u16();
        const ipacked = u8[p++];
        let lct = null;
        if (ipacked & 0x80){ const n = 1 << ((ipacked & 7) + 1); lct = u8.subarray(p, p + n * 3); p += n * 3; }
        const interlaced = !!(ipacked & 0x40);
        const minCode = u8[p++];
        const indices = lzw(minCode, readBlocks(), iw * ih);
        frames.push({ x: ix, y: iy, w: iw, h: ih, indices, table: lct || gct,
                      transparent, delay: delay * 10, disposal, interlaced });
        transparent = -1; disposal = 0;
    }
    return { width, height, frames };
}

/* Composite the decoded frames into finished canvases, honouring disposal. */
function gifToCanvases(gif){
    const out = [], W = gif.width, H = gif.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    let prev = null;

    for (const f of gif.frames){
        if (f.disposal === 3){ try { prev = ctx.getImageData(0, 0, W, H); } catch(e){ prev = null; } }

        const img = ctx.createImageData(f.w, f.h);
        const d = img.data, t = f.table;
        /* interlaced GIFs arrive in four passes */
        const rows = new Int32Array(f.h);
        if (f.interlaced){
            let r = 0;
            for (let y = 0; y < f.h; y += 8) rows[r++] = y;
            for (let y = 4; y < f.h; y += 8) rows[r++] = y;
            for (let y = 2; y < f.h; y += 4) rows[r++] = y;
            for (let y = 1; y < f.h; y += 2) rows[r++] = y;
        } else for (let y = 0; y < f.h; y++) rows[y] = y;

        for (let sy = 0; sy < f.h; sy++){
            const dy = rows[sy];
            for (let x = 0; x < f.w; x++){
                const idx = f.indices[sy * f.w + x], o = (dy * f.w + x) * 4;
                if (idx === f.transparent){ d[o + 3] = 0; continue; }
                d[o] = t[idx * 3]; d[o + 1] = t[idx * 3 + 1]; d[o + 2] = t[idx * 3 + 2]; d[o + 3] = 255;
            }
        }
        /* putImageData ignores compositing, so stage the patch then draw it */
        const patch = document.createElement('canvas'); patch.width = f.w; patch.height = f.h;
        patch.getContext('2d').putImageData(img, 0, 0);
        ctx.drawImage(patch, f.x, f.y);

        const snap = document.createElement('canvas'); snap.width = W; snap.height = H;
        snap.getContext('2d').drawImage(cv, 0, 0);
        out.push({ canvas: snap, delay: f.delay });

        if (f.disposal === 2) ctx.clearRect(f.x, f.y, f.w, f.h);
        else if (f.disposal === 3 && prev) ctx.putImageData(prev, 0, 0);
    }
    return out;
}

function loadGifFrames(path, done){
    try {
        const res = window.cep.fs.readFile(path, window.cep.encoding.Base64);
        if (res.err !== window.cep.fs.NO_ERROR) throw new Error('read');
        const bin = atob(res.data), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const gif = decodeGif(bytes);
        done(gifToCanvases(gif), gif.width, gif.height);
    } catch(e){ done(null); }
}

function mediaControlsHtml(isAudio){
    ensureOvcStyles();
    /* loop sits beside play on every player. No slash — enabled is the plain icon,
       disabled is simply dimmed, which reads cleaner at this size. */
    var loopBtn = '<button id="mc-loop" class="ovc-loopbtn" data-tooltip="Loop"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg></button>';
    /* audio gets fullscreen too — it blows the waveform up to fill the screen */
    var extra = '<button id="mc-extra" class="ovc-fsbtn" data-tooltip="Fullscreen"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg></button>';
    return '<div class="ovc">'
        + '<input type="range" class="ovc-seek" id="mc-seek" min="0" max="1000" value="0">'
        + '<div class="ovc-row">'
        +   '<button id="mc-play"><svg id="mc-playico" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg></button>'
        +   loopBtn
        +   '<span class="ovc-time" id="mc-time">0:00 / 0:00</span>'
        +   '<span class="ovc-spacer"></span>'
        +   speedMenuHtml('mc-speed')
        +   '<div class="ovc-vol">'
        +     '<button id="mc-mute"><svg id="mc-volico" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.5 8.5a5 5 0 0 1 0 7"></path></svg></button>'
        +     '<div class="ovc-volpop"><input type="range" class="ovc-volrange" id="mc-vol" min="0" max="100" value="' + Math.round(getPreviewVol()*100) + '"></div>'
        +   '</div>'
        +   extra
        + '</div>'
        + '</div>';
}
function wireMediaControls(media, root, opts){
    if (!media) return;
    opts = opts || {};
    var q = function(s){ return root.querySelector(s); };
    var play=q('#mc-play'), pico=q('#mc-playico'), seek=q('#mc-seek'), time=q('#mc-time'),
        vol=q('#mc-vol'), mute=q('#mc-mute'), volico=q('#mc-volico'), speed=q('#mc-speed'),
        extra=q('#mc-extra'), loop=q('#mc-loop'), stage=opts.stage;
    var PLAY='<polygon points="6 4 20 12 6 20 6 4"></polygon>';
    var PAUSE='<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    var VOL='<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.5 8.5a5 5 0 0 1 0 7"></path>';
    var MUTE='<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>';
    var seeking=false;
    function fmt(t){ return fmtTime(t||0); }
    function setPlayIcon(){ if (pico) pico.innerHTML = media.paused ? PLAY : PAUSE; }
    function paintSeek(){ var d=media.duration||0;
        if (!seeking && seek){ seek.value = d ? media.currentTime/d*1000 : 0;
            var p=d?media.currentTime/d*100:0; seek.style.background='linear-gradient(to right,var(--rfx-on-media) '+p+'%,var(--rfx-media-track) '+p+'%)'; }
        if (time) time.textContent = fmt(media.currentTime)+' / '+fmt(d); }
    function paintVol(){ var v=Number(vol?vol.value:100); if (volico) volico.innerHTML=(media.muted||v===0)?MUTE:VOL;
        if (vol) vol.style.background='linear-gradient(to right,var(--rfx-on-media) '+v+'%,var(--rfx-media-track) '+v+'%)'; }
    function toggle(){ if (media.paused) media.play(); else media.pause(); }

    if (play) play.addEventListener('click', function(e){ e.stopPropagation(); toggle(); });
    if (stage) stage.addEventListener('click', function(e){ if (e.target.closest && e.target.closest('.ovc')) return; toggle(); });
    media.addEventListener('play', setPlayIcon);
    media.addEventListener('pause', setPlayIcon);
    media.addEventListener('timeupdate', paintSeek);
    media.addEventListener('loadedmetadata', paintSeek);

    if (seek){ seek.addEventListener('input', function(){ seeking=true; var d=media.duration||0, p=seek.value/10;
        seek.style.background='linear-gradient(to right,var(--rfx-on-media) '+p+'%,var(--rfx-media-track) '+p+'%)';
        if (time) time.textContent=fmt(seek.value/1000*d)+' / '+fmt(d); });
        seek.addEventListener('change', function(){ var d=media.duration||0; media.currentTime=seek.value/1000*d; seeking=false; }); }

    /* the slider, the speaker icon and the real level all follow the shared
       preview volume — changed here, on a hover preview, or anywhere else */
    function syncVol(v){ if (v == null) v = getPreviewVol();
        try { media.volume = v; media.muted = (v === 0); } catch(e){}
        if (vol) vol.value = Math.round(v * 100);
        paintVol(); }
    syncVol();
    onPreviewVol(media, syncVol);
    if (vol) vol.addEventListener('input', function(){ setPreviewVol(Number(vol.value) / 100); });
    if (mute) mute.addEventListener('click', function(e){ e.stopPropagation(); togglePreviewMute(); });

    /* volume popup: hover the speaker to raise it (portaled so it never gets clipped) */
    var volwrap = mute ? mute.parentNode : null;
    var volpop = volwrap ? volwrap.querySelector('.ovc-volpop') : null;
    var volT=null;
    if (mute && volpop){
        var openVol=function(){ if (volT){ clearTimeout(volT); volT=null; } _rfxPortalShow(volpop, mute); };
        var closeVol=function(){ volT=setTimeout(function(){ _rfxPortalHide(volpop); }, 240); };
        mute.addEventListener('mouseenter', openVol);
        mute.addEventListener('mouseleave', closeVol);
        volpop.addEventListener('mouseenter', function(){ if (volT){ clearTimeout(volT); volT=null; } });
        volpop.addEventListener('mouseleave', closeVol);
    }

    /* speed preset menu: hover to open (portaled, fixed position, no reflow on select) */
    wireSpeedMenu(speed, function(r){ try { media.playbackRate = r; } catch(_){} });

    if (loop){
        media.loop = !!media.loop;
        loop.classList.toggle('on', media.loop);
        loop.addEventListener('click', function(e){ e.stopPropagation();
            media.loop = !media.loop; loop.classList.toggle('on', media.loop); });
    }
    if (extra){
        extra.addEventListener('click', function(e){ e.stopPropagation(); var el=opts.fsTarget||media;
            try { if (document.fullscreenElement||document.webkitFullscreenElement){ (document.exitFullscreen||document.webkitExitFullscreen).call(document); }
                  else { (el.requestFullscreen||el.webkitRequestFullscreen||el.webkitEnterFullscreen).call(el); } } catch(_){} });
    }
    setPlayIcon(); paintVol(); paintSeek();
    try { media.playbackRate = 1; } catch(e){}
}
function flipControlsHtml(){
    ensureOvcStyles();
    return '<div class="ovc">'
        + '<input type="range" class="ovc-seek" id="fp-seek" min="0" max="1000" value="0">'
        + '<div class="ovc-row">'
        +   '<button id="fp-play"><svg id="fp-playico" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg></button>'
        +   '<button id="fp-loop" class="ovc-loopbtn on" data-tooltip="Loop"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg></button>'
        +   '<span class="ovc-time" id="fp-time">0:00 / 0:00</span>'
        +   '<span class="ovc-spacer"></span>'
        +   speedMenuHtml('fp-speed')
        +   '<button id="fp-extra" class="ovc-fsbtn" data-tooltip="Fullscreen"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg></button>'
        + '</div>'
        + '</div>';
}
/* Drive decoded GIF frames through the same transport as everything else:
   play/pause, loop, seek, the shared speed menu and fullscreen. Frame
   timing comes from the GIF's own per-frame delays, so the preview runs at
   the speed it was authored at rather than a guessed frame rate. */
function wireGifPlayer(root, opts){
    ensureOvcStyles();
    const cv = root.querySelector('#ad-gifcv');
    const play = root.querySelector('#fp-play'), pico = root.querySelector('#fp-playico'),
          seek = root.querySelector('#fp-seek'), time = root.querySelector('#fp-time'),
          speed = root.querySelector('#fp-speed'), extra = root.querySelector('#fp-extra'),
          loopBtn = root.querySelector('#fp-loop'),
          stage = opts.stage;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const PLAY = '<polygon points="6 4 20 12 6 20 6 4"></polygon>';
    const PAUSE = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';

    let frames = null, total = 0, starts = [], i = 0, playing = false, rate = 1, looping = true, timer = null;

    function setIcon(){ if (pico) pico.innerHTML = playing ? PAUSE : PLAY; }
    function draw(){
        if (!frames || !frames[i]) return;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(frames[i].canvas, 0, 0, cv.width, cv.height);
        const at = starts[i] || 0;
        if (seek){ const p = total ? (at / total * 100) : 0;
            seek.value = p * 10;
            seek.style.background = 'linear-gradient(to right,var(--rfx-on-media) ' + p + '%,var(--rfx-media-track) ' + p + '%)'; }
        if (time) time.textContent = fmtTime(at / 1000) + ' / ' + fmtTime(total / 1000);
    }
    function stop(){ playing = false; setIcon(); if (timer){ clearTimeout(timer); timer = null; } }
    function step(){
        if (!playing) return;
        const d = Math.max(20, (frames[i].delay || 100) / rate);
        timer = setTimeout(() => {
            if (i >= frames.length - 1){
                if (!looping){ stop(); return; }
                i = 0;
            } else i++;
            draw(); step();
        }, d);
    }
    function start(){ if (playing || !frames) return; playing = true; setIcon(); step(); }
    function toggle(){ playing ? stop() : start(); }

    if (play) play.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    if (stage) stage.addEventListener('click', e => { if (e.target.closest && e.target.closest('.ovc')) return; toggle(); });
    if (seek) seek.addEventListener('input', () => {
        if (!frames) return;
        stop();
        const want = seek.value / 1000 * total;
        let k = 0; while (k < starts.length - 1 && starts[k + 1] <= want) k++;
        i = k; draw();
    });
    wireSpeedMenu(speed, r => { rate = r; if (playing){ stop(); start(); } });
    if (loopBtn) loopBtn.addEventListener('click', e => { e.stopPropagation();
        looping = !looping; loopBtn.classList.toggle('on', looping); });
    if (extra) extra.addEventListener('click', e => { e.stopPropagation();
        try { if (document.fullscreenElement || document.webkitFullscreenElement)
                  (document.exitFullscreen || document.webkitExitFullscreen).call(document);
              else (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage); } catch(_){} });

    setIcon();
    loadGifFrames(opts.path, (fr, w, h) => {
        if (!fr || !fr.length){
            /* decoding failed — fall back to letting the browser animate it */
            if (stage) stage.innerHTML = '<img src="' + fileUrl(opts.path) + '" style="width:100%;height:100%;object-fit:contain;display:block;">';
            return;
        }
        frames = fr; cv.width = w; cv.height = h;
        let acc = 0; starts = frames.map(f => { const at = acc; acc += (f.delay || 100); return at; });
        total = acc;
        draw(); start();
    });
}
function wireFlipPlayer(root, opts){
    ensureOvcStyles();
    var img = root.querySelector('#ad-flip');
    var play = root.querySelector('#fp-play'), pico = root.querySelector('#fp-playico'),
        seek = root.querySelector('#fp-seek'), time = root.querySelector('#fp-time'),
        speed = root.querySelector('#fp-speed'), extra = root.querySelector('#fp-extra'),
        loopBtn = root.querySelector('#fp-loop'),
        stage = opts.stage;
    var looping = true;
    var n = opts.count || 0, dur = opts.duration || 0, base = opts.base;
    if (!img || n <= 0) return;
    var frames = flipFrames(base, n, opts.stamp || '');
    var i = 0, playing = false, rate = 1;
    var PLAY = '<polygon points="6 4 20 12 6 20 6 4"></polygon>';
    var PAUSE = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    function ftime(idx){ return (n > 1 && dur) ? (dur * idx / (n - 1)) : 0; }
    /* playback shows only loaded frames (holding the last good one); a seek
       asks for the exact frame even if it is still on its way */
    function show(idx, force){ i = ((idx % n) + n) % n;
        var f = frames[i]; if (f && (f._ok || force)) img.src = f.src;
        if (seek){ var p = n > 1 ? (i / (n - 1) * 100) : 0; seek.value = p * 10;
            seek.style.background = 'linear-gradient(to right,var(--rfx-on-media) ' + p + '%,var(--rfx-media-track) ' + p + '%)'; }
        if (time) time.textContent = fmtTime(ftime(i)) + ' / ' + fmtTime(dur); }
    function setIcon(){ if (pico) pico.innerHTML = playing ? PAUSE : PLAY; }
    function stop(){ playing = false; setIcon(); if (window.__flipTimer){ clearInterval(window.__flipTimer); window.__flipTimer = null; } }
    /* Play the sequence back at the composition's real speed.

       The preview is a SAMPLE of the comp — n stills spread over `dur` seconds —
       so the correct playback rate is n/dur, not the comp's frame rate and not a
       fixed 12. Falling back to a constant is what made every asset play at its
       own arbitrary speed. The ceiling is raised to the comp's own frame rate so
       a 60fps comp is not silently slowed to 30. */
    function nativeFps(){
        return previewPlaybackFps({ previewFps: opts.previewFps, duration: dur, frameRate: opts.frameRate }, n);
    }
    function start(){ if (playing) return; playing = true; setIcon();
        var cap = Math.max(30, opts.frameRate || 0);
        var fps = nativeFps() * rate;
        if (!isFinite(fps) || fps < 0.5) fps = 0.5;
        if (fps > cap) fps = cap;
        if (window.__flipTimer) clearInterval(window.__flipTimer);
        window.__flipTimer = setInterval(function(){
            if (!looping && i >= n - 1){ stop(); return; }    // stop on the last frame when loop is off
            show(i + 1);
        }, 1000 / fps); }
    function toggle(){ playing ? stop() : start(); }
    if (play) play.addEventListener('click', function(e){ e.stopPropagation(); toggle(); });
    if (stage) stage.addEventListener('click', function(e){ if (e.target.closest && e.target.closest('.ovc')) return; toggle(); });
    if (seek) seek.addEventListener('input', function(){ stop(); show(Math.round(seek.value / 1000 * (n - 1)), true); });
    wireSpeedMenu(speed, function(r){ rate = r; if (playing){ stop(); start(); } });
    if (loopBtn) loopBtn.addEventListener('click', function(e){ e.stopPropagation();
        looping = !looping; loopBtn.classList.toggle('on', looping); });
    if (extra) extra.addEventListener('click', function(e){ e.stopPropagation(); var el = stage;
        try { if (document.fullscreenElement || document.webkitFullscreenElement){ (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
              else { (el.requestFullscreen || el.webkitRequestFullscreen).call(el); } } catch(_){} });
    show(0, true);
    onFlipFrameReady(frames[0], function(){ if (img.isConnected && !playing) start(); });
}
/* ===================================================================
   PREVIEW FORMAT SETTINGS + GIF (ffmpeg) SUPPORT
   =================================================================== */
function getPreviewFormat(){ try { return localStorage.getItem('rfx_preview_format') === 'gif' ? 'gif' : 'sequence'; } catch(e){ return 'sequence'; } }
function setPreviewFormat(v){ try { localStorage.setItem('rfx_preview_format', v === 'gif' ? 'gif' : 'sequence'); } catch(e){} }

/* Locate ffmpeg.exe, breadth-first by folder level starting at bin/, depth-capped,
   pruning heavy/irrelevant folders. Resolved path is cached. */
function findFfmpeg(){
    if (window.RFXDeps){
        try { var managed = RFXDeps.resolve('assets', 'ffmpeg'); if (managed.state === 'managed') return managed.path.replace(/\\/g, '/'); } catch(e){}
    }
    if (typeof csInterface === 'undefined' || !window.cep || !window.cep.fs) return null;
    var root = window.toNativePath(csInterface.getSystemPath(SystemPath.EXTENSION));
    var base = root + '/bin/win/assets';          // ffmpeg lives ONLY here (or deeper) — nowhere else
    /* cache, but only honour it if it still points inside the allowed folder */
    try {
        var cached = localStorage.getItem('rfx_ffmpeg_path');
        if (cached){
            if (cached.indexOf(base) === 0){ try { if (window.cep.fs.stat(cached).err === window.cep.fs.NO_ERROR) return cached; } catch(e){} }
            localStorage.removeItem('rfx_ffmpeg_path');
        }
    } catch(e){}
    var MAXDEPTH = 6;                              // may search subfolders inside assets/
    var queue = [{ path: base, depth: 0 }];
    while (queue.length){
        var cur = queue.shift();
        var res; try { res = window.cep.fs.readdir(cur.path); } catch(e){ continue; }
        if (!res || res.err !== window.cep.fs.NO_ERROR || !res.data) continue;
        var subdirs = [];
        for (var i = 0; i < res.data.length; i++){
            var nm = res.data[i]; if (!nm) continue;
            var full = cur.path + '/' + nm;
            var st; try { st = window.cep.fs.stat(full); } catch(e){ continue; }
            if (!st || st.err !== window.cep.fs.NO_ERROR) continue;
            var isDir = (typeof st.data.isDirectory === 'function') ? st.data.isDirectory() : !!st.data.isDirectory;
            if (isDir){ if (cur.depth < MAXDEPTH) subdirs.push({ path: full, depth: cur.depth + 1 }); }
            else if (nm.toLowerCase() === 'ffmpeg.exe'){ try { localStorage.setItem('rfx_ffmpeg_path', full); } catch(e){} return full; }
        }
        for (var j = 0; j < subdirs.length; j++) queue.push(subdirs[j]);
    }
    return null;
}

/* Encode the rendered PNG frames in <previewDir> into preview.gif via ffmpeg. */
function encodeGif(previewDir, fps, width, cb){
    var ff = findFfmpeg();
    if (!ff){ cb(false, 'GIF previews need FFmpeg, which is not installed. Install it in Assets settings (gear icon), or switch the preview format to Image sequence.'); return; }
    if (!window.cep.process || !window.cep.process.createProcess){ cb(false, 'process API unavailable'); return; }
    var input = previewDir + '/f%03d.png';
    var out   = previewDir + '/preview.gif';
    var vf = 'scale=' + width + ':-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3';
    try {
        try { if (window.cep.fs.stat(out).err === window.cep.fs.NO_ERROR) window.cep.fs.deleteFile(out); } catch(e){}
        var r = window.cep.process.createProcess(ff, '-y', '-start_number', '0', '-framerate', String(fps), '-i', input, '-vf', vf, out);
        if (!r || r.err !== 0 || r.data == null){ cb(false, 'could not launch ffmpeg'); return; }
        var pid = r.data;
        window.cep.process.onquit(pid, function(){
            var ok = false; try { ok = (window.cep.fs.stat(out).err === window.cep.fs.NO_ERROR); } catch(e){}
            cb(ok, ok ? '' : 'ffmpeg produced no output');
        });
    } catch(e){ cb(false, String(e)); }
}

/* Image-sequence previews: dense enough to read as real motion (about 12
   stills per second of comp time), never more stills than the comp actually
   has frames, and clamped to 24–72 so a long comp still saves quickly. */
function seqFrameSpec(duration, frameRate){
    var d = (duration && duration > 0) ? duration : 2;
    var n = Math.round(d * 12);
    if (n < 24) n = 24; if (n > 72) n = 72;
    if (frameRate > 0){ var avail = Math.floor(d * frameRate) + 1; if (avail >= 2 && n > avail) n = avail; }
    return { frames: n, fps: n / d };
}
/* Render a bundle's preview in the given format ('sequence' | 'gif'),
   replacing any existing one. Reports through the busy modal as it goes.
   done(status, err): status is 'ok', 'fail', or 'gif-fail' (frames kept). */
function renderBundlePreview(bundlePath, duration, frameRate, done, format){
    var fmt = format || getPreviewFormat();
    var spec = (fmt === 'gif') ? gifFrameSpec(duration) : seqFrameSpec(duration, frameRate);
    busyThen('Rendering preview', 'After Effects will pause until the frames are done', function(){
        AX.eval(`assetsRenderPreviewJSX("${encodeURIComponent(bundlePath)}", ${spec.frames})`, function(res){
            if (res !== 'ok'){ done('fail', res); return; }
            if (fmt !== 'gif'){ done('ok'); return; }
            showAssetBusy('Encoding GIF', 'Almost done');
            encodeGif(bundlePath + "/.preview", spec.fps, 400, function(ok, err){
                if (ok) AX.eval(`assetsSetGifPreviewJSX("${encodeURIComponent(bundlePath)}")`, function(){ done('ok'); });
                else done('gif-fail', err);
            });
        });
    });
}
/* the listing is refreshed asynchronously, so read this asset's meta straight
   from disk — a stale copy would carry the old frame count and format */
function freshAssetItem(item){
    var found = assetsCurrentItems.find(function(i){ return i.path === item.path; }) || item;
    return Object.assign({}, found, { meta: readMeta(item.path) || found.meta });
}
function gifFrameSpec(duration){
    var d = (duration && duration > 0) ? duration : 3;
    var n = Math.round(d * 15); if (n < 20) n = 20; if (n > 72) n = 72;   // dense sampling = smooth
    var fps = n / d;                                                       // exact frames/duration = real-time speed
    if (fps > 50) fps = 50;                                                // GIF sanity cap (very short comps only)
    return { frames: n, fps: fps };
}
function generatePreviewFormat(item, format){
    if (isAssetsProcessing) return;
    toggleAssetLock(true);
    var m = item.meta || readMeta(item.path) || {};
    renderBundlePreview(item.path, m.duration, m.frameRate, function(status, err){
        toggleAssetLock(false);
        if (status === 'fail'){ assetsRefresh(); showToast("Couldn't render preview."); return; }
        showToast(status === 'gif-fail' ? "GIF failed (" + (err || 'error') + ") — kept image sequence."
                                        : (format === 'gif' ? "GIF preview ready!" : "Motion preview ready!"));
        openDrawer(freshAssetItem(item));
        assetsRefresh();
    }, format);
}

/* Small menu (Image sequence / GIF) shown from the drawer's Generate control. */
function openGenPreviewMenu(item, anchor){
    var old = document.getElementById('gen-preview-menu'); if (old) old.remove();
    var cur = (item.meta && item.meta.previewFormat) || '';
    var menu = document.createElement('div'); menu.id = 'gen-preview-menu';
    menu.className = 'ctx-menu';
    var opts = [ { fmt:'sequence', label:'Image sequence' }, { fmt:'gif', label:'GIF' } ];
    opts.forEach(function(o){
        var row = document.createElement('div');
        var disabled = (cur === o.fmt);
        row.textContent = o.label + (disabled ? '  (current)' : '');
        row.className = 'ctx-item' + (disabled ? ' ctx-menu-item disabled' : '');
        if (!disabled){
            row.onclick = function(e){ e.stopPropagation(); menu.remove(); generatePreviewFormat(item, o.fmt); };
        }
        menu.appendChild(row);
    });
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.min(r.left, window.innerWidth - mw - 6);
    var top = r.top - mh - 6; if (top < 6) top = r.bottom + 6;
    menu.style.left = Math.max(6, left) + 'px'; menu.style.top = top + 'px';
    setTimeout(function(){ document.addEventListener('mousedown', function close(ev){ if (!menu.contains(ev.target)){ menu.remove(); document.removeEventListener('mousedown', close); } }); }, 10);
}

/* Settings modal (gear button): library folder + preview format.
   Its rfxset-* styles are shared by every settings dialog and live in css/settings.css. */
function ensureSettingsStyles(){}
window.assetsOpenSettings = function(){
    ensureSettingsStyles();
    var old = document.getElementById('assets-settings-modal'); if (old) old.remove();
    var libPath = (typeof rootAssetPath !== 'undefined' && rootAssetPath) ? rootAssetPath : (typeof currentAssetPath !== 'undefined' ? currentAssetPath : '');
    var overlay = document.createElement('div'); overlay.className = 'rfxset-overlay'; overlay.id = 'assets-settings-modal';
    overlay.innerHTML =
        '<div class="rfxset">'
      +   '<div class="rfxset-head"><div class="rfxset-title">Settings</div>'
      +     '<button class="rfxset-x" id="rfxset-x"><svg viewBox="0 0 24 24" width="17" height="17" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>'
      +   '</div>'
      +   '<div class="rfxset-section">'
      +     '<div class="rfxset-label">Library folder</div>'
      +     '<div class="rfxset-librow">'
      +       '<span class="rfxset-libicon"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span>'
      +       '<span class="rfxset-libpath" id="rfxset-path" title="' + escHtml(libPath) + '">' + escHtml(libPath || '(default)') + '</span>'
      +       '<button class="rfxset-change" id="rfxset-change">Change</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="rfxset-section">'
      +     '<div class="rfxset-label">Preview format · comps &amp; layers</div>'
      +     '<div class="rfxset-seg">'
      +       '<button class="rfxset-opt" data-fmt="sequence"><span class="t">Image sequence</span><span class="d">Scrubbable · sharp</span></button>'
      +       '<button class="rfxset-opt" data-fmt="gif"><span class="t">GIF</span><span class="d">One file · hover to play</span></button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="rfxset-foot"><button class="rfxset-done" id="rfxset-done">Done</button></div>'
      + '</div>';
    document.body.appendChild(overlay);

    function paint(){ var f = getPreviewFormat();
        overlay.querySelectorAll('.rfxset-opt').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-fmt') === f); }); }
    paint();
    overlay.querySelectorAll('.rfxset-opt').forEach(function(b){ b.onclick = function(){ setPreviewFormat(b.getAttribute('data-fmt')); paint(); }; });
    overlay.querySelector('#rfxset-change').onclick = function(){ overlay.remove(); if (window.assetsSetCustomLibrary) assetsSetCustomLibrary(); };
    var close = function(){ overlay.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e){ if (e.key === 'Escape') close(); }
    overlay.querySelector('#rfxset-x').onclick = close;
    overlay.querySelector('#rfxset-done').onclick = close;
    overlay.addEventListener('mousedown', function(e){ if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    // GIF previews need this tab's FFmpeg (install / update / roll back via js/deps.js)
    if (window.RFXDeps){
        var card = overlay.querySelector('.rfxset');
        var tools = document.createElement('div');
        tools.className = 'rfxset-section';
        tools.innerHTML = '<div class="rfxset-label">GIF previews · FFmpeg</div>';
        var host = document.createElement('div');
        tools.appendChild(host);
        card.insertBefore(tools, overlay.querySelector('.rfxset-foot'));
        card.style.maxHeight = 'calc(100vh - 24px)';
        card.style.overflowY = 'auto';
        RFXDeps.ui.renderPanel(host, 'assets');
    }
};
function generatePreview(item, el){
    if (el) el.classList.add('busy');
    generatePreviewFormat(item, 'sequence');
}

/* =====================================================================
   IMPORT / APPLY
   ===================================================================== */
function quickImport(item){
    if (isAssetsProcessing) return;
    const kind = item.kind || (item.meta && item.meta.kind) || 'comp';
    toggleAssetLock(true);
    if (kind === 'comp' || kind === 'layers'){
        AX.eval(`assetsImportAEPJSX("${encodeURIComponent(item.path)}")`, res => {
            if (res === 'NO_ACTIVE_COMP') showToast("Open a comp and click its Timeline first!");
            else if (res !== 'ok') showToast(res);
            else { stripPreviewBackdrop(); showToast("Asset imported!"); }
            toggleAssetLock(false);
        });
    } else if (kind === 'video' || kind === 'audio' || kind === 'image'){
        AX.eval(`assetsImportMediaToCompJSX("${encodeURIComponent(item.path)}")`, res => {
            if (res === 'NO_ACTIVE_COMP') showToast("Open a comp and click its Timeline first!");
            else if (res !== 'ok') showToast(res); else showToast("Added to comp!");
            toggleAssetLock(false);
        });
    } else if (kind === 'expr'){
        importExpression(item.path);
    } else toggleAssetLock(false);
}
/* The dark solid added purely so previews render on an opaque background.
   assets.jsx now removes it before the preview copy is closed (and never saves
   that copy), and skips it when importing — so new assets never carry it.
   This is the safety net for assets saved BEFORE that fix: it sweeps every
   comp for the backdrop layer, deletes the backdrop solid itself once nothing
   uses it, and removes any folder that deletion left empty. Matching is by
   name AND by solid source, so the user's own layers and footage are never
   touched. */
function stripPreviewBackdrop(){
    AX.eval(`(function(){
        var names = { ufx_bg:1, uwu_bg:1, ultfx_bg:1 };
        function named(o){ try { return names.hasOwnProperty(String(o.name).toLowerCase()); } catch (e){ return false; } }
        function isSolid(it){ try { return (it instanceof FootageItem) && (it.mainSource instanceof SolidSource); } catch (e){ return false; } }
        var removed = 0, emptied = [], p, i, it;
        app.beginUndoGroup('Remove preview backdrop');
        try {
            for (p = 1; p <= app.project.numItems; p++){
                it = app.project.item(p);
                if (!(it instanceof CompItem)) continue;
                for (i = it.numLayers; i >= 1; i--){
                    var l = it.layer(i);
                    try { if (named(l) && l.source && isSolid(l.source) && named(l.source)){ l.locked = false; l.remove(); removed++; } } catch (e){}
                }
            }
            for (p = app.project.numItems; p >= 1; p--){
                it = app.project.item(p);
                try {
                    if (isSolid(it) && named(it) && it.usedIn.length === 0){
                        var pf = it.parentFolder; it.remove(); removed++;
                        if (pf && pf !== app.project.rootFolder) emptied.push(pf);
                    }
                } catch (e){}
            }
            for (i = 0; i < emptied.length; i++){ try { if (emptied[i].numItems === 0) emptied[i].remove(); } catch (e){} }
        } catch (e){}
        app.endUndoGroup();
        return 'ok|' + removed;
    })()`, () => {});
}

/* read the saved expression text out of an expr bundle */
function readExpressionText(bundlePath){
    try {
        const file = bundlePath + "/" + bundlePath.split('/').pop() + ".expr.json";
        const res = window.cep.fs.readFile(file, window.cep.encoding.UTF8);
        if (res.err !== window.cep.fs.NO_ERROR) return "";
        return (JSON.parse(res.data).expression) || "";
    } catch(e){ return ""; }
}
/* clipboard copy that works inside CEF (execCommand fallback) */
function copyToClipboard(text){
    try {
        const ta = document.createElement('textarea');
        ta.value = text || ""; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch(e){ return false; }
}

/* =====================================================================
   SAVE FLOWS
   ===================================================================== */
function checkProjectState(cb){ AX.eval(`assetsCheckProjectSaved()`, res => { if (res === 'unsaved'){ showToast("⚠️ Save your AE project file first!"); return; } cb(); }); }

window.assetsSaveComp = function(){ closeSaveMenu(); checkProjectState(() => { toggleAssetLock(true);
    busyThen('Saving composition', 'Collecting the comp and its footage', () =>
        AX.eval(`assetsSaveCompJSX()`, res => finalizeBundle(res, "New Comp"))); }); };
window.assetsSaveLayers = function(){ closeSaveMenu(); checkProjectState(() => { toggleAssetLock(true);
    busyThen('Saving layers', 'Collecting the selected layers and their footage', () =>
        AX.eval(`assetsSaveLayersJSX()`, res => finalizeBundle(res, "New Layers", "Select layers in an open comp."))); }); };

function finalizeBundle(res, defaultName, failMsg){
    if (!res || res === 'none'){ showToast(failMsg || "Nothing to save — select a comp/layers first."); toggleAssetLock(false); return; }

    let data = null;
    if (res.indexOf('{') !== -1){
        try { data = JSON.parse(res.charAt(0) === '"' ? JSON.parse(res) : res); }
        catch(e){ try { data = JSON.parse(res); } catch(e2){ data = null; } }
    }
    // Backward-compat: an older backend returns just the bare temp-dir path.
    if (!data){
        const bare = res.replace(/^"|"$/g,'').replace(/\\/g,'/').trim();
        if (/\/ufx_bundle_\d+\/?$/.test(bare)) data = { status:'ok', tempDir: bare, thumb:'', meta:{} };
    }
    if (!data || data.status !== 'ok' || !data.tempDir){
        showToast("Save failed → " + res); toggleAssetLock(false); return;
    }

    const cleanupTemp = () => { try { AX.eval(`assetsDeleteJSX("${encodeURIComponent(data.tempDir)}")`, ()=>{}); } catch(e){} };

    hideAssetBusy();                       // the name prompt has the screen to itself
    openAssetSaveModal("Asset Name", defaultName, name => {
        if (!name){ cleanupTemp(); toggleAssetLock(false); return; }
        name = name.replace(/[/\\?%*:|"<>]/g, '-');
        const metaEnc = encodeURIComponent(JSON.stringify(data.meta || {}));
        busyThen('Adding to library', 'Copying files', () => {
            AX.eval(`assetsFinalizeBundleJSX("${encodeURIComponent(data.tempDir)}","${encodeURIComponent(currentAssetPath)}","${name}","${encodeURIComponent(data.thumb||'')}","${metaEnc}")`, r => {
                const okPath = (r === 'ok') ? '' : ((r && r.indexOf('ok:') === 0) ? r.substring(3) : null);
                if (r !== 'ok' && okPath === null){
                    cleanupTemp(); toggleAssetLock(false); assetsRefresh();
                    showToast("Error saving asset: " + r); return;
                }
                if (!okPath){ toggleAssetLock(false); assetsRefresh(); showToast("Asset saved!"); return; }
                const m = data.meta || {};
                renderBundlePreview(okPath, m.duration, m.frameRate, status => {
                    toggleAssetLock(false); assetsRefresh();
                    showToast(status === 'fail' ? "Asset saved — the preview couldn't be rendered." : "Asset saved!");
                });
            });
        });
    }, () => { cleanupTemp(); toggleAssetLock(false); });
}

/* =====================================================================
   SHEET GESTURE

   JS owns the sheet's height outright. The previous version toggled an
   .expanded class carrying `height: … !important`, and an inline style can
   never beat a stylesheet !important — so while expanded the drag could not
   move the panel at all, and every settle had to remove the class first,
   which snapped the sheet to its natural height before the animation even
   started. That is the "goes back, then does it again" jump.

   Now there is exactly one source of truth: d.style.height. Drag writes to
   it with transitions off, release animates it to the target with them on,
   and it is never cleared. No class, no !important, nothing to fight.
   ===================================================================== */
const SHEET_FLICK = 0.5;               // px/ms that counts as a flick rather than a drag
const SHEET_EASE  = 'cubic-bezier(.25,.8,.35,1)';
const SHEET_MS    = 300;
let sheetExpanded = false;
let sheetBaseH = 0;                    // natural height, measured once on first open

function sheetMaxH(){
    const tab = document.getElementById('tab-assets');
    return Math.round((tab ? tab.getBoundingClientRect().height : window.innerHeight) - 8);
}
function sheetMinH(){ return 150; }

/* Called once, the first time a drawer is shown, while it still has whatever
   height the stylesheet gives it. */
function measureSheetBase(d){
    if (sheetBaseH) return sheetBaseH;
    const h = Math.round(d.getBoundingClientRect().height);
    sheetBaseH = Math.max(sheetMinH(), Math.min(h || 380, sheetMaxH()));
    return sheetBaseH;
}
function sheetTargetH(state){
    const maxH = sheetMaxH();
    return state === 'expanded' ? maxH : Math.min(sheetBaseH || 380, maxH);
}

/* Animate to a resting state from wherever the sheet currently is. */
function settleSheet(state){
    const d = document.getElementById('asset-drawer'); if (!d) return;

    if (state === 'close'){
        /* keep the current height so the slide-out begins exactly where the
           finger left it — no springing back up first */
        d.style.transition = 'transform ' + SHEET_MS + 'ms ' + SHEET_EASE + ',opacity ' + SHEET_MS + 'ms ' + SHEET_EASE;
        closeDrawer();
        return;
    }

    sheetExpanded = (state === 'expanded');
    const target = sheetTargetH(state);
    if (state === 'default' && Math.abs(target - sheetBaseH) > 1) sheetBaseH = target;
    if (Math.abs(parseFloat(d.style.height || '0') - target) < 0.5){ d.style.transition = ''; return; }

    d.style.transition = 'height ' + SHEET_MS + 'ms ' + SHEET_EASE;
    void d.offsetHeight;                       // commit the start height before changing it
    d.style.height = target + 'px';

    clearTimeout(d._settleT);
    d._settleT = setTimeout(() => {
        d.style.transition = '';
        try { window.dispatchEvent(new Event('resize')); } catch(e){}
    }, SHEET_MS + 30);
}
function setSheetExpanded(on){ settleSheet(on ? 'expanded' : 'default'); }

/* Keep the open sheet fitting the panel.

   The height is an explicit pixel value, so shrinking the After Effects panel
   used to push the handle and the title straight off the top. Now every panel
   resize re-clamps it: expanded follows the new maximum, default keeps its own
   height but is never allowed to exceed what fits, and growing the panel gives
   the space back. The stage is flexed, so the preview absorbs the difference
   and the handle, name and buttons all stay on screen. */
function refitSheet(){
    const d = document.getElementById('asset-drawer');
    if (!d || !d.classList.contains('open')) return;
    /* sheetBaseH stays the height the user actually chose and is never written
       down by a resize — it is only clamped on the way to the screen. That way
       shrinking the panel squeezes the sheet, and growing it again hands the
       space straight back instead of leaving it stuck small. */
    const want = sheetTargetH(sheetExpanded ? 'expanded' : 'default');
    const now = Math.round(d.getBoundingClientRect().height);
    if (Math.abs(now - want) < 1) return;
    d.style.transition = 'none';                 // follow the drag of the panel edge 1:1
    d.style.height = want + 'px';
    void d.offsetHeight;
    d.style.transition = '';
}
function wireSheetResize(){
    if (window._sheetResizeWired) return;
    window._sheetResizeWired = true;
    let raf = 0;
    const onResize = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; refitSheet(); }); };
    window.addEventListener('resize', onResize);
    /* window.resize does not always fire for a CEP panel being dragged, so watch
       the tab element itself as well */
    try {
        const tab = document.getElementById('tab-assets');
        if (tab && window.ResizeObserver) new ResizeObserver(onResize).observe(tab);
    } catch(e){}
}

function primeSheetHeight(){
    const d = document.getElementById('asset-drawer'); if (!d) return;
    d.style.transition = 'none';
    if (!sheetBaseH){ d.style.height = ''; measureSheetBase(d); }   // still measured: it is the collapse target
    /* open fully expanded — as tall as the panel is RIGHT NOW. It stays
       expanded as After Effects resizes the panel (refitSheet follows
       sheetExpanded), and dragging down still collapses it as before. */
    sheetExpanded = true;
    d.style.height = sheetTargetH('expanded') + 'px';
    void d.offsetHeight;
    d.style.transition = '';
    wireSheetResize();
}

function wireSheetGesture(){
    const d = document.getElementById('asset-drawer'); if (!d || d._gestureWired) return;
    const handle = d.querySelector('.asset-drawer-handle'); if (!handle) return;
    d._gestureWired = true;

    let startY = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, startH = 0, curH = 0;

    const onDown = e => {
        const p = e.touches ? e.touches[0] : e;
        clearTimeout(d._settleT);
        measureSheetBase(d);
        dragging = true; startY = lastY = p.clientY; lastT = Date.now(); vel = 0;
        startH = curH = Math.round(d.getBoundingClientRect().height);
        d.classList.add('dragging-sheet');
        d.style.transition = 'none';
        d.style.height = startH + 'px';
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
        e.preventDefault();
    };
    const onMove = e => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e, now = Date.now();
        if (now !== lastT) vel = (p.clientY - lastY) / (now - lastT);   // +ve = moving down
        lastY = p.clientY; lastT = now;

        const maxH = sheetMaxH(), minH = sheetMinH();
        let h = startH + (startY - p.clientY);                 // dragged up = taller
        if (h > maxH) h = maxH + (h - maxH) * 0.14;            // rubber-band past the top
        if (h < minH) h = minH - (minH - h) * 0.55;            // and keep following past the bottom
        curH = h;
        d.style.height = Math.max(0, h) + 'px';
        if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        d.classList.remove('dragging-sheet');
        document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);

        const maxH = sheetMaxH(), base = sheetBaseH || 380, minH = sheetMinH();
        let state;
        if (curH <= minH * 0.92){
            state = 'close';                                   /* dragged it off the bottom: just go */
        } else if (vel > SHEET_FLICK){
            state = (curH > base * 1.15) ? 'default' : 'close';
        } else if (vel < -SHEET_FLICK){
            state = (curH < base * 1.05) ? 'default' : 'expanded';
        } else {
            /* released slowly: land on whichever resting height is nearest, so a
               half-drag back down from expanded settles on default */
            const dClose = Math.abs(curH - minH * 0.6),
                  dDef   = Math.abs(curH - base),
                  dExp   = Math.abs(curH - maxH);
            state = (dClose < dDef && dClose < dExp) ? 'close' : (dExp < dDef ? 'expanded' : 'default');
        }
        /* a deliberate slow drag that lands near default redefines default, so the
           sheet keeps the size the user chose */
        if (state === 'default' && Math.abs(vel) <= SHEET_FLICK){
            const maxH2 = sheetMaxH();
            sheetBaseH = Math.max(sheetMinH(), Math.min(Math.round(curH), maxH2));
        }
        settleSheet(state);
    };

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    handle.addEventListener('dblclick', e => {
        e.preventDefault(); clearTimeout(d._settleT);
        setSheetExpanded(!sheetExpanded);
    });
}

/* ---------- chrome: grab handle, dark buttons, tags: styles live in css/tab-assets.css ---------- */

/* =====================================================================
   TAGS

   Per-asset tags live in that asset's own .meta.json, so they travel with
   the bundle if the library is moved or shared. The catalogue of every tag
   that exists (plus its colour) is kept in localStorage, which is what
   lets the filter list show tags that no asset currently uses.
   ===================================================================== */
const TAG_STORE = 'rfxAssetTags';
let assetsTagFilter = JSON.parse(localStorage.getItem('rfxAssetTagFilter') || '[]');

/* a tag's colour is derived from its name, so it is stable everywhere it appears */
const TAG_HUES = [4, 22, 40, 86, 150, 172, 192, 210, 238, 266, 292, 322];
function tagHue(name){
    let h = 2166136261 >>> 0, s = String(name || '').toLowerCase();
    for (let i = 0; i < s.length; i++){ h = (h ^ s.charCodeAt(i)) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
    return TAG_HUES[h % TAG_HUES.length];
}
function allTags(){
    try { const a = JSON.parse(localStorage.getItem(TAG_STORE) || '[]'); return Array.isArray(a) ? a : []; }
    catch(e){ return []; }
}
function saveAllTags(list){
    const seen = {}, out = [];
    list.forEach(t => { const k = String(t).trim(); if (k && !seen[k.toLowerCase()]){ seen[k.toLowerCase()] = 1; out.push(k); } });
    out.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
    localStorage.setItem(TAG_STORE, JSON.stringify(out));
    return out;
}
function registerTag(name){ const l = allTags(); l.push(name); return saveAllTags(l); }

function readTags(bundlePath){
    const m = readMeta(bundlePath);
    return (m && Array.isArray(m.tags)) ? m.tags.filter(t => !!t) : [];
}
function writeTags(bundlePath, tags){
    const m = readMeta(bundlePath) || {};
    m.tags = tags; writeMeta(bundlePath, m);
    tags.forEach(registerTag);
}

function tagChipsHtml(tags, opts){
    opts = opts || {};
    if (!tags || !tags.length) return '';
    return tags.map(t =>
        `<span class="tag-chip${opts.small ? ' tag-chip-sm' : ''}" style="--th:${tagHue(t)}">#${escHtml(t)}${
            opts.removable ? `<i class="tag-x" data-tag="${escHtml(t)}">×</i>` : ''}</span>`).join('');
}

/* Walk the whole library and strip a tag from every asset that carries it.
   Deleting a tag has to mean deleting it, otherwise it lingers on assets as a
   chip whose origin no longer exists. */
function stripTagEverywhere(tag, root, depth){
    root = root || rootAssetPath; depth = depth || 0;
    if (!root || depth > 6) return 0;
    let hit = 0;
    let listing;
    try { listing = window.cep.fs.readdir(root); } catch(e){ return 0; }
    if (!listing || listing.err !== window.cep.fs.NO_ERROR || !listing.data) return 0;

    for (const nm of listing.data){
        if (!nm || nm.charAt(0) === '.' || nm === '(Footage)') continue;
        const full = root + "/" + nm;
        let isDir = false;
        try {
            const st = window.cep.fs.stat(full);
            if (st && st.err === window.cep.fs.NO_ERROR && st.data)
                isDir = (typeof st.data.isDirectory === 'function') ? st.data.isDirectory() : !!st.data.isDirectory;
        } catch(e){}
        if (!isDir) continue;

        const m = readMeta(full);
        if (m && Array.isArray(m.tags) && m.tags.length){
            const left = m.tags.filter(t => String(t).toLowerCase() !== String(tag).toLowerCase());
            if (left.length !== m.tags.length){ m.tags = left; writeMeta(full, m); hit++; }
        }
        hit += stripTagEverywhere(tag, full, depth + 1);   // bundles can nest inside folders
    }
    return hit;
}

/* ---- tag editor ----
   Every edit is staged in memory. Cancel throws the whole session away;
   Save is the only thing that touches disk or the catalogue. ---- */
function openTagEditor(item){
    const old = document.getElementById('tag-editor-modal'); if (old) old.remove();

    /* session state — nothing here is committed until Save */
    let chosen    = readTags(item.path).slice();
    let catalogue = allTags().slice();
    const deletes = [];                       // tags to remove from the library entirely

    const modal = document.createElement('div'); modal.id = 'tag-editor-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:var(--rfx-overlay);z-index:2147483647;display:flex;justify-content:center;align-items:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--rfx-dialog);border:1px solid var(--rfx-line);border-radius:12px;width:330px;box-shadow:var(--rfx-shadow-lg);overflow:hidden;';
    box.innerHTML =
        `<div style="padding:16px 18px 12px;">
            <div style="font-size:14px;font-weight:600;color:var(--rfx-text-1);">Tags</div>
            <div style="font-size:11px;color:var(--rfx-text-3);margin-top:3px;">${escHtml(item.name.replace(/\.(aep|expr\.json|props\.json)$/,''))}</div>
         </div>
         <div style="padding:0 18px;"><div class="tag-picked" id="tg-picked"></div></div>
         <div style="padding:10px 18px 0;">
            <input id="tg-input" placeholder="Type a tag and press Enter…" spellcheck="false"
                   style="width:100%;box-sizing:border-box;background:var(--rfx-input);border:1px solid transparent;border-radius:8px;color:var(--rfx-text-1);font-size:12px;padding:8px 10px;outline:none;">
         </div>
         <div style="padding:12px 18px 0;font-size:10px;color:var(--rfx-text-3);letter-spacing:.08em;text-transform:uppercase;">All tags</div>
         <div class="tag-all" id="tg-all"></div>
         <div id="tg-warn" style="padding:8px 18px 0;font-size:10.5px;color:var(--rfx-warn);line-height:1.5;"></div>
         <div style="display:flex;gap:10px;padding:14px 18px 16px;"></div>`;

    const picked = box.querySelector('#tg-picked'), allBox = box.querySelector('#tg-all'),
          input = box.querySelector('#tg-input'), warn = box.querySelector('#tg-warn');

    function renderWarn(){
        warn.textContent = deletes.length
            ? `Deleting ${deletes.map(t => '#' + t).join(', ')} will also remove ${deletes.length > 1 ? 'them' : 'it'} from every asset. Save to confirm.`
            : '';
    }
    function renderPicked(){
        picked.innerHTML = chosen.length ? tagChipsHtml(chosen, { removable: true })
            : '<span style="font-size:11px;color:var(--rfx-text-3);">No tags yet.</span>';
        picked.querySelectorAll('.tag-x').forEach(x => x.onclick = () => {
            chosen = chosen.filter(t => t !== x.dataset.tag); renderPicked(); renderAll();
        });
    }
    function renderAll(){
        if (!catalogue.length){ allBox.innerHTML = '<span style="font-size:11px;color:var(--rfx-text-3);">None created yet — type one above.</span>'; return; }
        allBox.innerHTML = catalogue.map(t => {
            const on = chosen.some(c => c.toLowerCase() === t.toLowerCase());
            return `<span class="tag-opt${on ? ' on' : ''}" data-tag="${escHtml(t)}" style="--th:${tagHue(t)}">#${escHtml(t)}<i class="tag-del" data-del="${escHtml(t)}" title="Delete this tag everywhere">×</i></span>`;
        }).join('');
        allBox.querySelectorAll('.tag-opt').forEach(el => {
            el.onclick = e => {
                if (e.target.classList.contains('tag-del')) return;
                const t = el.dataset.tag;
                if (chosen.some(c => c.toLowerCase() === t.toLowerCase())) chosen = chosen.filter(c => c.toLowerCase() !== t.toLowerCase());
                else chosen.push(t);
                renderPicked(); renderAll();
            };
        });
        allBox.querySelectorAll('.tag-del').forEach(el => {
            el.onclick = e => {
                e.stopPropagation();
                const t = el.dataset.del;
                catalogue = catalogue.filter(x => x !== t);
                chosen = chosen.filter(c => c !== t);
                if (deletes.indexOf(t) === -1) deletes.push(t);
                renderPicked(); renderAll(); renderWarn();
            };
        });
    }
    function addTyped(){
        const v = input.value.trim().replace(/^#+/, '').replace(/[,\s]+/g, '-');
        if (!v) return;
        if (!chosen.some(c => c.toLowerCase() === v.toLowerCase())) chosen.push(v);
        if (!catalogue.some(c => c.toLowerCase() === v.toLowerCase())) catalogue.push(v);
        const i = deletes.indexOf(v); if (i !== -1) deletes.splice(i, 1);
        input.value = ''; renderPicked(); renderAll(); renderWarn();
    }
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter'){ e.preventDefault(); addTyped(); }
        if (e.key === 'Escape'){ e.preventDefault(); modal.remove(); }
    });

    const btnRow = box.lastElementChild;
    const cancel = mkBtn('Cancel','btn-secondary');
    cancel.onclick = () => modal.remove();       // nothing was written, so there is nothing to undo
    const save = mkBtn('Save','btn-primary');
    save.onclick = () => {
        addTyped();
        let removed = 0;
        deletes.forEach(t => { removed += stripTagEverywhere(t); });
        saveAllTags(catalogue);
        assetsTagFilter = assetsTagFilter.filter(f => catalogue.some(c => c.toLowerCase() === f.toLowerCase()));
        localStorage.setItem('rfxAssetTagFilter', JSON.stringify(assetsTagFilter));
        writeTags(item.path, chosen);
        modal.remove();
        const row = document.getElementById('ad-tagrow');
        if (row){ row.innerHTML = tagChipsHtml(readTags(item.path), { removable: true }); wireHeaderTagRemoval(item); }
        syncTagFilterButton(); assetsRefresh();
        showToast(deletes.length
            ? `Tags updated · removed from ${removed} asset${removed === 1 ? '' : 's'}.`
            : (chosen.length ? "Tags updated!" : "Tags cleared."));
    };
    btnRow.appendChild(cancel); btnRow.appendChild(save);

    renderPicked(); renderAll(); renderWarn();
    modal.appendChild(box); document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => { try { input.focus(); } catch(e){} }, 50);
}

/* =====================================================================
   SORT · GROUP · FILTER

   One menu behind the toolbar button, laid out the way Windows 11 does it:
   a Sort by list, then Group by, then direction, then the tag filter. Every
   row is a radio except the tags, which are multi-select. Choices persist.
   ===================================================================== */
const SORT_STORE = 'rfxAssetSort';
let assetsSort = (function(){
    try { const o = JSON.parse(localStorage.getItem(SORT_STORE) || '{}');
          return { by: o.by || 'name', dir: o.dir || 'asc', group: o.group || 'none' }; }
    catch(e){ return { by: 'name', dir: 'asc', group: 'none' }; }
})();
function saveSort(){ try { localStorage.setItem(SORT_STORE, JSON.stringify(assetsSort)); } catch(e){} }

const SORT_BY = [
    { id:'name', label:'Name' },
    { id:'date', label:'Date modified' },
    { id:'type', label:'Type' },
    { id:'size', label:'Size' }
];
const GROUP_BY = [
    { id:'none', label:'(None)' },
    { id:'type', label:'Type' },
    { id:'tag',  label:'Tag' },
    { id:'date', label:'Date modified' }
];
const KIND_ORDER = { comp:0, layers:1, expr:2, video:3, audio:4, image:5 };

/* stat() is a synchronous round trip, so each path is asked for once and kept */
const statCache = {};
function assetStat(path){
    if (statCache[path]) return statCache[path];
    let out = { mtime: 0, size: 0 };
    try {
        const st = window.cep.fs.stat(path);
        if (st && st.err === window.cep.fs.NO_ERROR && st.data){
            out.mtime = Number(st.data.mtime) || 0;
            out.size  = Number(st.data.size) || 0;
        }
    } catch(e){}
    statCache[path] = out;
    return out;
}
/* a bundle's own size is meaningless — measure what is inside it */
function assetSize(item){
    if (item.isFolder) return 0;
    const f = findPrimaryFile(item.path);
    return f ? assetStat(f).size : assetStat(item.path).size;
}
function assetDate(item){
    const f = item.isFolder ? null : findPrimaryFile(item.path);
    return Math.max(assetStat(item.path).mtime, f ? assetStat(f).mtime : 0);
}

function dateBucket(ms){
    if (!ms) return 'Older';
    const d = new Date(ms), now = new Date();
    const day = 864e5, midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= midnight) return 'Today';
    if (ms >= midnight - day) return 'Yesterday';
    if (ms >= midnight - day * 7) return 'Earlier this week';
    if (ms >= midnight - day * 30) return 'Earlier this month';
    if (d.getFullYear() === now.getFullYear()) return 'Earlier this year';
    return 'Older';
}
function groupKeyFor(item){
    if (assetsSort.group === 'type') return item.isFolder ? 'Folders' : (kindLabel[item.kind] || 'Asset');
    if (assetsSort.group === 'tag'){ const t = readTags(item.path); return t.length ? '#' + t[0] : 'Untagged'; }
    if (assetsSort.group === 'date') return item.isFolder ? 'Folders' : dateBucket(assetDate(item));
    return '';
}

function sortAssets(items){
    const dir = assetsSort.dir === 'desc' ? -1 : 1;
    const cmp = (a, b) => {
        /* folders always lead, whatever the sort — they are navigation, not content */
        if (!!a.isFolder !== !!b.isFolder) return a.isFolder ? -1 : 1;
        let r = 0;
        switch (assetsSort.by){
            case 'date': r = assetDate(a) - assetDate(b); break;
            case 'size': r = assetSize(a) - assetSize(b); break;
            case 'type': r = (KIND_ORDER[a.kind] === undefined ? 9 : KIND_ORDER[a.kind])
                           - (KIND_ORDER[b.kind] === undefined ? 9 : KIND_ORDER[b.kind]); break;
        }
        if (!r) r = String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
        return r * dir;
    };
    return items.slice().sort(cmp);
}

/* ---------- the menu ---------- */
window.assetsToggleSortMenu = function(anchor){
    const old = document.getElementById('assets-sort-menu');
    if (old){ old.remove(); return; }
    if (!anchor) anchor = findTagFilterButton();

    const menu = document.createElement('div'); menu.id = 'assets-sort-menu';
    const tags = allTags();

    const row = (checked, label, kind) =>
        `<div class="sm-row${checked ? ' on' : ''}" data-kind="${kind}">
            <span class="sm-tick">${checked
                ? '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
                : ''}</span><span>${label}</span></div>`;

    menu.innerHTML =
        `<div class="sm-head">Sort by</div>
         ${SORT_BY.map(o => row(assetsSort.by === o.id, escHtml(o.label), 'by:' + o.id)).join('')}
         <div class="sm-sep"></div>
         ${row(assetsSort.dir === 'asc',  'Ascending',  'dir:asc')}
         ${row(assetsSort.dir === 'desc', 'Descending', 'dir:desc')}
         <div class="sm-sep"></div>
         <div class="sm-head">Group by</div>
         ${GROUP_BY.map(o => row(assetsSort.group === o.id, escHtml(o.label), 'group:' + o.id)).join('')}
         <div class="sm-sep"></div>
         <div class="sm-head">Filter by tag</div>
         ${tags.length
            ? `<div class="sm-tags">${tags.map(t => `<span class="tag-opt${assetsTagFilter.indexOf(t) !== -1 ? ' on' : ''}" data-tag="${escHtml(t)}" style="--th:${tagHue(t)}">#${escHtml(t)}</span>`).join('')}</div>`
            : `<div class="sm-empty">No tags yet — open an asset and press + beside its type.</div>`}
         ${assetsTagFilter.length ? '<div class="sm-row sm-clear" data-kind="clear">Clear tag filter</div>' : ''}`;

    document.body.appendChild(menu);

    menu.querySelectorAll('.sm-row').forEach(el => el.onclick = () => {
        const [k, v] = (el.dataset.kind || '').split(':');
        if (k === 'by') assetsSort.by = v;
        else if (k === 'dir') assetsSort.dir = v;
        else if (k === 'group') assetsSort.group = v;
        else if (k === 'clear'){ assetsTagFilter = []; localStorage.setItem('rfxAssetTagFilter', '[]'); }
        saveSort(); menu.remove(); syncTagFilterButton(); renderAssets();
    });
    menu.querySelectorAll('.tag-opt').forEach(el => el.onclick = () => {
        const t = el.dataset.tag, i = assetsTagFilter.indexOf(t);
        if (i === -1) assetsTagFilter.push(t); else assetsTagFilter.splice(i, 1);
        localStorage.setItem('rfxAssetTagFilter', JSON.stringify(assetsTagFilter));
        el.classList.toggle('on'); syncTagFilterButton(); renderAssets();
    });

    /* place it under the button, flipping or nudging so it is never off-screen */
    const r = anchor ? anchor.getBoundingClientRect() : { left: 20, right: 60, bottom: 50, top: 20 };
    let x = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8);
    let y = r.bottom + 6;
    if (y + menu.offsetHeight > window.innerHeight - 8) y = Math.max(8, r.top - menu.offsetHeight - 6);
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = y + 'px';
    requestAnimationFrame(() => menu.classList.add('in'));

    setTimeout(() => {
        const away = e => {
            if (!menu.contains(e.target) && e.target !== anchor){
                menu.remove(); document.removeEventListener('mousedown', away);
            }
        };
        document.addEventListener('mousedown', away);
    }, 0);
};
/* the old name still works if anything else calls it */
window.assetsToggleTagFilter = function(a){ window.assetsToggleSortMenu(a); };

/* remove a tag straight from the drawer header, no editor needed */
function wireHeaderTagRemoval(item){
    const row = document.getElementById('ad-tagrow'); if (!row) return;
    row.querySelectorAll('.tag-x').forEach(x => x.onclick = e => {
        e.stopPropagation();
        const left = readTags(item.path).filter(t => t !== x.dataset.tag);
        writeTags(item.path, left);
        row.innerHTML = tagChipsHtml(left, { removable: true });
        wireHeaderTagRemoval(item);
        assetsRefresh();
    });
}

/* Finding the toolbar's filter button.

   This file does not own the panel's HTML, so the button is located by id, then
   by wording, then by position — it is the control sitting beside the view
   toggle. Whatever is found is cached.

   The binding itself is a CAPTURE-PHASE listener on document, installed the
   moment this file runs. Everything used to be wired inside DOMContentLoaded,
   which never fires when a tab's script is injected after the document is
   already parsed — so the click handler was simply never attached. Delegation
   removes the timing question completely: it works whenever the toolbar
   appears, however it appears. */
let _sortBtnCache = null;

function findTagFilterButton(){
    if (_sortBtnCache && document.contains(_sortBtnCache)) return _sortBtnCache;
    _sortBtnCache = null;

    const byId = ['assets-tag-filter','assets-filter-btn','assets-tagfilter','tag-filter-btn','assets-sort-btn','assets-filter'];
    for (const id of byId){ const el = document.getElementById(id); if (el){ _sortBtnCache = el; return el; } }

    /* wording, anywhere in the document */
    const cands = document.querySelectorAll('button,[role="button"],.icon-btn,[data-tooltip],[title]');
    for (const el of cands){
        if (el.id === 'assets-view-btn') continue;
        const t = ((el.getAttribute('data-tooltip') || '') + ' ' + (el.getAttribute('title') || '')
                 + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).toLowerCase();
        if (t.indexOf('tag') !== -1 || t.indexOf('filter') !== -1 || t.indexOf('sort') !== -1){ _sortBtnCache = el; return el; }
    }
    /* position: the control next to the view toggle */
    const view = document.getElementById('assets-view-btn');
    if (view && view.parentNode){
        const sibs = Array.prototype.filter.call(view.parentNode.children,
            el => el !== view && (el.tagName === 'BUTTON' || el.classList.contains('icon-btn') || el.querySelector('svg')));
        if (sibs.length){ _sortBtnCache = sibs[sibs.length - 1]; return _sortBtnCache; }
    }
    return null;
}

/* Delegated, capture phase, installed immediately. */
document.addEventListener('click', function(e){
    const btn = findTagFilterButton();
    if (!btn) return;
    let n = e.target;
    while (n && n !== document){ if (n === btn) break; n = n.parentNode; }
    if (n !== btn) return;
    e.preventDefault(); e.stopPropagation();
    window.assetsToggleSortMenu(btn);
}, true);

/* Tells you exactly what was found, for when the toolbar markup changes. */
window.assetsSortMenuDebug = function(){
    const b = findTagFilterButton();
    const info = {
        buttonFound: !!b,
        id: b ? (b.id || '(no id)') : null,
        tooltip: b ? (b.getAttribute('data-tooltip') || b.getAttribute('title') || '(none)') : null,
        viewBtnPresent: !!document.getElementById('assets-view-btn'),
        menuOpen: !!document.getElementById('assets-sort-menu')
    };
    console.log('[assets] sort button:', info);
    showToast(b ? ('Sort button found: ' + (b.id || 'unnamed')) : 'Sort button NOT found — call assetsForceSortButton()');
    return info;
};
/* Last resort you can call from the console: builds one into the toolbar. */
window.assetsForceSortButton = function(){
    _sortBtnCache = null;
    const b = buildTagFilterButton();
    if (b){ _sortBtnCache = b; syncTagFilterButton(); showToast('Sort button added to the toolbar.'); }
    else showToast('Could not find the toolbar to add it to.');
    return b;
};
function syncTagFilterButton(){
    const b = findTagFilterButton(); if (!b) return;
    const active = assetsTagFilter.length > 0 || assetsSort.by !== 'name'
                || assetsSort.dir !== 'asc' || assetsSort.group !== 'none';
    b.classList.toggle('tag-filter-on', active);
    const byLbl = (SORT_BY.find(o => o.id === assetsSort.by) || {}).label || 'Name';
    b.setAttribute('data-tooltip', 'Sort: ' + byLbl + ' · ' + (assetsSort.dir === 'asc' ? 'Asc' : 'Desc')
        + (assetsSort.group !== 'none' ? ' · Grouped' : '')
        + (assetsTagFilter.length ? ' · ' + assetsTagFilter.map(t => '#' + t).join(' ') : ''));
}
function buildTagFilterButton(){
    const view = document.getElementById('assets-view-btn');
    if (!view || !view.parentNode || document.getElementById('assets-tag-filter')) return null;
    const b = document.createElement('button');
    b.id = 'assets-tag-filter';
    b.className = view.className;                    // inherit whatever the toolbar uses
    b.setAttribute('data-tooltip', 'Sort and filter');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"></path><path d="M7 12h10"></path><path d="M10 18h4"></path></svg>';
    view.parentNode.insertBefore(b, view);
    return b;
}
function wireTagFilterButton(){
    let b = findTagFilterButton();
    if (!b) b = buildTagFilterButton();      // nothing in the markup: build one
    if (!b) return;
    _sortBtnCache = b; b._tagWired = true;
    syncTagFilterButton();
}

/* =====================================================================
   ERROR MODAL

   A dedicated modal for hard failures, matching the delete-confirm styling.
   Used wherever an action simply cannot proceed and a toast would be too
   easy to miss — wrong selection, no comp open, nothing to save.
   ===================================================================== */
window.openAssetErrorModal = function(title, message, hint){
    const old = document.getElementById('asset-error-modal'); if (old) old.remove();
    const modal = document.createElement('div'); modal.id = 'asset-error-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:var(--rfx-overlay);z-index:2147483647;display:flex;justify-content:center;align-items:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--rfx-dialog);padding:20px;border-radius:10px;border:1px solid var(--rfx-line);width:300px;text-align:center;box-shadow:var(--rfx-shadow-lg);';
    box.innerHTML =
        `<div style="width:38px;height:38px;border-radius:50%;background:var(--rfx-warn-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
            <svg viewBox="0 0 24 24" width="19" height="19" stroke="currentColor" style="color:var(--rfx-warn)" stroke-width="2" fill="none" stroke-linecap="round"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>
         </div>
         <div style="font-size:14px;font-weight:600;color:var(--rfx-text-1);margin-bottom:8px;">${escHtml(title)}</div>
         <div style="font-size:12px;color:var(--rfx-text-2);margin-bottom:${hint?'8px':'18px'};line-height:1.5;">${escHtml(message)}</div>
         ${hint ? `<div style="font-size:11px;color:var(--rfx-text-3);margin-bottom:18px;line-height:1.5;">${escHtml(hint)}</div>` : ''}`;
    const ok = mkBtn('Got it','btn-primary');
    ok.onclick = () => modal.remove();
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;';
    wrap.appendChild(ok); box.appendChild(wrap); modal.appendChild(box); document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => { try { ok.focus(); } catch(e){} }, 40);
};

/* =====================================================================
   REVEAL IN EXPLORER

   Done natively through cep.process rather than round-tripping to
   ExtendScript. The old path called assetsRevealJSX(), which is what
   raised After Effects' "run this script?" prompt and then opened the
   library root instead of the asset. Here the bundle is resolved down to
   the real file and the OS file manager is asked to SELECT it.
   ===================================================================== */
function revealInExplorer(bundleOrFile){
    let target = bundleOrFile, dir = bundleOrFile;
    try {
        const st = window.cep.fs.stat(bundleOrFile);
        const isDir = (st && st.err === window.cep.fs.NO_ERROR && st.data)
            ? ((typeof st.data.isDirectory === 'function') ? st.data.isDirectory() : !!st.data.isDirectory) : false;
        if (isDir){
            const f = findPrimaryFile(bundleOrFile);
            if (f){ target = f; dir = bundleOrFile; }          // select the file inside its bundle
            else  { target = bundleOrFile; dir = bundleOrFile; }
        } else {
            dir = bundleOrFile.replace(/[/\\][^/\\]*$/, '');
        }
    } catch(e){}

    const isWin = (navigator.platform || '').toLowerCase().indexOf('win') === 0;
    const native = window.toNativePath(target).replace(/\//g, isWin ? '\\' : '/');

    try {
        if (window.cep && window.cep.process && window.cep.process.createProcess){
            const r = isWin
                ? window.cep.process.createProcess('C:\\Windows\\explorer.exe', '/select,' + native)
                : window.cep.process.createProcess('/usr/bin/open', '-R', native);
            /* explorer.exe reports a non-zero exit even on success, so only a hard
               "couldn't launch" is treated as a failure worth falling back on */
            if (r && r.err === 0) return;
        }
    } catch(e){}

    /* fallback: open the containing folder in the default handler */
    try {
        let url = window.toNativePath(dir);
        if (url.charAt(0) !== '/') url = '/' + url;
        window.cep.util.openURLInDefaultBrowser('file://' + url);
    } catch(e){ showToast("Couldn't open the folder."); }
}

/* =====================================================================
   EXPRESSIONS  —  save from / apply to the timeline selection

   Both run as inline ExtendScript through AX.eval rather than calling
   assetsSaveExpressionJSX / assetsImportExprJSX in assets.jsx, so the
   whole flow lives here and the selection rules can be enforced properly.

   Return codes, pipe-delimited so no JSON parser is needed host-side:
     NO_COMP                    no comp open / timeline not focused
     NO_SEL                     nothing selected in the timeline
     MULTI                      more than one property (save only)
     NO_EXPR                    the property carries no expression
     ok|<expr>|<name>|<sep>     save succeeded (expr and name are URI-encoded)
     ok|<applied>|<total>       apply finished
   ===================================================================== */
const JSX_SELECTED_PROPS = `
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return 'NO_COMP';
    var sel = comp.selectedProperties, list = [];
    for (var i = 0; i < sel.length; i++){
        var p = sel[i];
        try {
            if (p.propertyType === PropertyType.PROPERTY && p.canSetExpression) list.push(p);
        } catch (e){}
    }
    if (!list.length) return 'NO_SEL';`;

function jsxReadSelectedExpression(){
    return `(function(){
        ${JSX_SELECTED_PROPS}
        if (list.length > 1) return 'MULTI';
        var pr = list[0];
        var expr = '';
        try { expr = pr.expression || ''; } catch (e){ expr = ''; }
        /* a disabled expression is still text on the property, but saving it would
           hand back something the user cannot see, so it counts as "none" */
        var on = true; try { on = pr.expressionEnabled; } catch (e){}
        if (!expr || !expr.replace(/^\\s+|\\s+$/g, '').length || !on) return 'NO_EXPR';
        var nm = '';
        try { nm = pr.parentProperty && pr.parentProperty.name ? (pr.parentProperty.name + ' ' + pr.name) : pr.name; } catch (e){ nm = pr.name; }
        var sep = false; try { sep = pr.dimensionsSeparated === true; } catch (e){}
        return 'ok|' + encodeURIComponent(expr) + '|' + encodeURIComponent(nm) + '|' + (sep ? '1' : '0');
    })()`;
}

function jsxApplyExpression(encExpr){
    return `(function(){
        ${JSX_SELECTED_PROPS}
        var expr = decodeURIComponent("${encExpr}");
        var done = 0;
        app.beginUndoGroup('Apply Expression');
        for (var k = 0; k < list.length; k++){
            try { list[k].expression = expr; list[k].expressionEnabled = true; done++; } catch (e){}
        }
        app.endUndoGroup();
        return 'ok|' + done + '|' + list.length;
    })()`;
}

/* strip the quoting evalScript sometimes wraps around a returned string */
function unquoteJsx(r){
    r = (r === null || r === undefined) ? '' : String(r);
    if (r.length > 1 && r.charAt(0) === '"' && r.charAt(r.length - 1) === '"')
        r = r.substring(1, r.length - 1).replace(/\\"/g, '"');
    return r;
}

/* the two selection failures both sides share */
function expressionSelectionError(code){
    if (code === 'NO_COMP'){
        openAssetErrorModal("No comp is active",
            "Open a comp and click its Timeline first!",
            "After Effects only reports a selection while a composition's timeline has focus.");
        return true;
    }
    if (code === 'NO_SEL'){
        openAssetErrorModal("Nothing selected",
            "Select a property in the Timeline first.",
            "Click a property name such as Rotation, Position or Scale.");
        return true;
    }
    return false;
}

window.assetsSaveExpression = function(){
    closeSaveMenu(); toggleAssetLock(true);
    AX.eval(jsxReadSelectedExpression(), raw => {
        const res = unquoteJsx(raw);

        if (expressionSelectionError(res)){ toggleAssetLock(false); return; }
        if (res === 'MULTI'){
            openAssetErrorModal("Select one property",
                "Expressions are saved one at a time.",
                "You have several properties selected. Pick the single property whose expression you want to save.");
            toggleAssetLock(false); return;
        }
        if (res === 'NO_EXPR'){
            openAssetErrorModal("No expression found",
                "That property doesn't have an expression on it.",
                "Add an expression to the property first, then save it to the library.");
            toggleAssetLock(false); return;
        }
        if (res.indexOf('ok|') !== 0){
            openAssetErrorModal("Couldn't read the expression", res || "After Effects returned nothing.");
            toggleAssetLock(false); return;
        }

        const parts = res.split('|');
        let expression = '', suggested = 'Expression', sep = false;
        try {
            expression = decodeURIComponent(parts[1] || '');
            suggested  = decodeURIComponent(parts[2] || '') || 'Expression';
            sep        = parts[3] === '1';
        } catch(e){
            openAssetErrorModal("Couldn't read the expression", "The expression text came back malformed.");
            toggleAssetLock(false); return;
        }
        if (!expression.trim()){          // belt and braces: never open the name modal empty-handed
            openAssetErrorModal("No expression found", "That property doesn't have an expression on it.");
            toggleAssetLock(false); return;
        }

        /* only now — with real expression text in hand — ask for a name */
        openAssetSaveModal("Expression Name", suggested, name => {
            if (!name){ toggleAssetLock(false); return; }
            name = name.replace(/[/\\?%*:|"<>]/g, '-');
            const payload = { name: name, expression: expression, dimensionsSeparated: sep };
            AX.eval(`assetsWriteExprJSX("${encodeURIComponent(currentAssetPath)}","${name}","${encodeURIComponent(JSON.stringify(payload))}")`, r => {
                const ok = unquoteJsx(r) === 'ok';
                if (ok) showToast("Expression saved!");
                else openAssetErrorModal("Save failed", "The expression couldn't be written to the library.", String(r || ''));
                toggleAssetLock(false); assetsRefresh();
            });
        }, () => toggleAssetLock(false));
    });
};

function importExpression(bundlePath){
    let data;
    try {
        const file = bundlePath + "/" + bundlePath.split('/').pop() + ".expr.json";
        const res = window.cep.fs.readFile(file, window.cep.encoding.UTF8);
        if (res.err !== window.cep.fs.NO_ERROR) throw new Error("read");
        data = JSON.parse(res.data);
    } catch(e){
        openAssetErrorModal("Couldn't read the asset", "This expression asset is missing or damaged.");
        toggleAssetLock(false); return;
    }
    if (!data || !data.expression){
        openAssetErrorModal("Nothing to apply", "This expression asset has no expression text in it.");
        toggleAssetLock(false); return;
    }

    AX.eval(jsxApplyExpression(encodeURIComponent(data.expression)), raw => {
        const res = unquoteJsx(raw);
        if (expressionSelectionError(res)){ toggleAssetLock(false); return; }
        if (res.indexOf('ok|') !== 0){
            openAssetErrorModal("Couldn't apply the expression", res || "After Effects returned nothing.");
            toggleAssetLock(false); return;
        }
        const done = parseInt(res.split('|')[1], 10) || 0, total = parseInt(res.split('|')[2], 10) || 0;
        if (!done) openAssetErrorModal("Couldn't apply the expression",
            "None of the selected properties would accept it.",
            "Some properties — text source, shape paths and similar — can't take this expression.");
        else if (done < total) showToast(`Applied to ${done} of ${total} properties.`);
        else showToast(total > 1 ? `Expression applied to ${total} properties!` : "Expression applied!");
        toggleAssetLock(false);
    });
}

/* Save external media into the library (video or audio) */
window.assetsSaveVideo = function(){ saveMediaOfKind('video', "Select a video to save", MEDIA_EXT.video); };
window.assetsSaveAudio = function(){ saveMediaOfKind('audio', "Select audio to save", MEDIA_EXT.audio); };

function handleOsFileDrop(fileList){
    if (isAssetsProcessing) return;
    const paths = [];
    for (let i = 0; i < fileList.length; i++){
        const p = fileList[i].path;                 // CEF exposes the native path on dropped files
        if (p) paths.push(p.replace(/\\/g, '/'));
    }
    if (!paths.length){ showToast("This build can't read dropped paths — use the Save menu instead."); return; }
    const supported = paths.filter(p => mediaKindOf(p.split('/').pop()));
    const skipped = paths.length - supported.length;
    if (!supported.length){ showToast("Drop video, audio or image files."); return; }
    let idx = 0; toggleAssetLock(true);
    const run = () => {
        if (idx >= supported.length){
            toggleAssetLock(false); assetsRefresh();
            showToast((supported.length > 1 ? supported.length + " files added!" : "Added to library!") + (skipped ? "  (" + skipped + " skipped)" : ""));
            return;
        }
        const p = supported[idx++];
        busyThen('Adding to library' + (supported.length > 1 ? ' ' + idx + ' of ' + supported.length : ''),
                 p.split('/').pop(), () => addOneMedia(p, mediaKindOf(p.split('/').pop()), run));
    };
    run();
}

function saveMediaOfKind(kind, prompt, exts){
    closeSaveMenu();
    const result = window.cep.fs.showOpenDialogEx(true, false, prompt, "", exts);   // one or more files
    if (!result || !result.data || !result.data.length) return;
    const files = result.data.map(f => f.replace(/\\/g, '/'));
    let idx = 0, okCount = 0, failCount = 0, lastErr = "";
    toggleAssetLock(true);
    const run = () => {
        if (idx >= files.length){
            toggleAssetLock(false); assetsRefresh();
            if (okCount && !failCount)     showToast(okCount > 1 ? okCount + " " + kind + "s saved!" : (kind === 'audio' ? "Audio saved!" : kind === 'video' ? "Video saved!" : "Saved!"));
            else if (okCount && failCount) showToast(okCount + " saved, " + failCount + " failed" + (lastErr ? " (" + lastErr + ")" : "") + ".");
            else {
                showToast("Import failed — " + (lastErr || "check the file and try again."));
                try { alert("Import failed.\n\nReason from After Effects:\n" + (lastErr || "(no reason returned — the assets backend may not be loaded)")); } catch (e){}
            }
            return;
        }
        const f = files[idx++];
        busyThen('Saving ' + (kind === 'audio' ? 'audio' : 'video') + (files.length > 1 ? ' ' + idx + ' of ' + files.length : ''),
                 f.split('/').pop(), () =>
            addOneMedia(f, kind, (ok, err) => { if (ok) okCount++; else { failCount++; if (err) lastErr = err; } run(); }));
    };
    run();
}

function addOneMedia(srcPath, kind, cb){
    const fileName = srcPath.split('/').pop();
    const baseName = (fileName.replace(/\.[^.]+$/, '') || fileName).replace(/[/\\?%*:|"<>]/g, '-');
    kind = kind || mediaKindOf(fileName) || 'video';

    /* probe dims/duration, but never let a slow or undecodable file block the copy */
    probeMedia(fileUrl(srcPath), kind, probe => {
        const meta = { kind, name: baseName, created: Date.now(), source: fileName,
                       width: probe.width || 0, height: probe.height || 0, duration: probe.duration || 0,
                       hasThumb: false, hasPreview: false, tags: [] };
        AX.eval(`assetsCreateMediaBundleJSX("${encodeURIComponent(srcPath)}","${encodeURIComponent(currentAssetPath)}","${baseName}","${encodeURIComponent(JSON.stringify(meta))}")`, res => {
            const info = parseJsxJson(res);
            if (!info || info.status !== 'ok'){
                var why = (info && info.error) ? info.error : (res ? String(res) : "unknown error");
                cb(false, fileName + ": " + why); return;
            }
            /* thumbnail is best-effort and never decides success */
            if (kind === 'video' || kind === 'image'){
                (kind === 'video' ? makeVideoThumb : makeImageThumb)(fileUrl(info.file), dataURL => {
                    if (dataURL){ try {
                        window.cep.fs.writeFile(info.bundle + "/.thumb.png", dataURL.split(',')[1], window.cep.encoding.Base64);
                        const m = readMeta(info.bundle) || meta; m.hasThumb = true; writeMeta(info.bundle, m);
                    } catch(e){} }
                    cb(true);
                });
            } else {
                cb(true);   // audio has no still thumbnail
            }
        });
    });
}

/* robustly parse whatever evalScript hands back (JSON, quoted JSON, or "error: …") */
function parseJsxJson(res){
    if (res == null) return null;
    const s = String(res);
    if (s.indexOf('{') === -1) return (s.toLowerCase().indexOf('error') !== -1) ? { status: 'error', error: s } : null;
    try { return JSON.parse(s.charAt(0) === '"' ? JSON.parse(s) : s); }
    catch(e){ try { return JSON.parse(s); } catch(e2){ return null; } }
}

function probeMedia(url, kind, cb){
    let done = false; const finish = o => { if (done) return; done = true; cb(o || {}); };
    if (kind === 'image'){
        const img = new Image();
        img.onload  = () => finish({ width: img.naturalWidth, height: img.naturalHeight, duration: 0 });
        img.onerror = () => finish({});
        setTimeout(() => finish({}), 2500); img.src = url; return;
    }
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video'); el.preload = 'metadata';
    el.addEventListener('loadedmetadata', () => finish({ width: el.videoWidth || 0, height: el.videoHeight || 0, duration: el.duration || 0 }));
    el.addEventListener('error', () => finish({}));
    setTimeout(() => finish({}), 2500);   // don't hang on codecs CEF can't decode
    el.src = el ? url : url;
}

/* =====================================================================
   SAVE MENU
   ===================================================================== */
window.assetsToggleSaveMenu = function(){ const m = document.getElementById('assets-save-menu'); if (m) m.classList.toggle('open'); };
function closeSaveMenu(){ const m = document.getElementById('assets-save-menu'); if (m) m.classList.remove('open'); }

/* =====================================================================
   NEW FOLDER / RENAME / DELETE / CONTEXT MENU  (modals reuse global look)
   ===================================================================== */
window.assetsNewFolder = function(){ openAssetSaveModal("New Folder Name", "New Folder", name => {
    if (!name) return; const clean = name.replace(/[/\\?%*:|"<>]/g,'-');
    AX.eval(`assetsMakeDirJSX("${encodeURIComponent(currentAssetPath)}","${clean}")`, () => assetsRefresh()); }); };

window.openAssetSaveModal = function(titleText, defaultText, onConfirm, onCancel){
    const old = document.getElementById('asset-save-input-modal'); if (old) old.remove();
    const modal = document.createElement('div'); modal.id = 'asset-save-input-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:var(--rfx-overlay);z-index:2147483647;display:flex;justify-content:center;align-items:center;';
    const box = document.createElement('div'); box.style.cssText = 'background:var(--rfx-dialog);padding:20px;border-radius:8px;border:1px solid var(--rfx-line);width:280px;box-shadow:var(--rfx-shadow-lg);display:flex;flex-direction:column;';
    const title = document.createElement('div'); title.style.cssText = 'font-size:14px;font-weight:600;color:var(--rfx-text-1);margin-bottom:15px;'; title.textContent = titleText;
    const input = document.createElement('input'); input.type='text'; input.placeholder = defaultText + "..."; input.value='';
    input.style.cssText = 'width:100%;background:var(--rfx-input);border:1px solid transparent;color:var(--rfx-text-1);padding:10px 12px;border-radius:4px;margin-bottom:20px;font-size:13px;outline:none;box-sizing:border-box;transition:border-color .2s;';
    input.onfocus = () => input.style.background = 'var(--rfx-surface-2)'; input.onblur = () => input.style.background = 'var(--rfx-input)';
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:10px;';
    const cancel = mkBtn('Cancel','btn-secondary'), ok = mkBtn('OK','btn-primary');
    cancel.onclick = () => { modal.remove(); if (onCancel) onCancel(); };
    ok.onclick = () => { const v = input.value.trim() || defaultText; modal.remove(); if (onConfirm) onConfirm(v); };
    input.onkeydown = e => { if (e.key==='Enter'){ e.preventDefault(); ok.click(); } if (e.key==='Escape'){ e.preventDefault(); cancel.click(); } };
    wrap.appendChild(cancel); wrap.appendChild(ok); box.appendChild(title); box.appendChild(input); box.appendChild(wrap); modal.appendChild(box); document.body.appendChild(modal);
    setTimeout(() => input.focus(), 50);
};
function mkBtn(text, cls){ const b = document.createElement('button'); b.className = cls;
    b.style.cssText = 'flex:1;margin-top:0 !important;height:34px !important;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer;'; b.textContent = text; return b; }

window.openAssetRenameModal = function(currentName, fullPath){
    const clean = currentName.replace(/\.(aep|expr\.json|props\.json)$/,'');
    openAssetSaveModal("Rename Asset", clean, newName => {
        newName = newName.replace(/[/\\?%*:|"<>]/g,'-');
        AX.eval(`assetsRenameJSX("${encodeURIComponent(fullPath)}","${newName}")`, res => {
            if (res === 'ok'){ showToast("Renamed!"); closeDrawer(); assetsRefresh(); } else showToast("Failed to rename."); });
    });
    setTimeout(() => { const i = document.querySelector('#asset-save-input-modal input'); if (i){ i.value = clean; i.select(); } }, 60);
};

window.openAssetDeleteModal = function(name, fullPath){
    const old = document.getElementById('asset-delete-modal'); if (old) old.remove();
    const modal = document.createElement('div'); modal.id = 'asset-delete-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:var(--rfx-overlay);z-index:2147483647;display:flex;justify-content:center;align-items:center;';
    const box = document.createElement('div'); box.style.cssText = 'background:var(--rfx-dialog);padding:20px;border-radius:8px;border:1px solid var(--rfx-line);width:260px;text-align:center;box-shadow:var(--rfx-shadow-lg);';
    box.innerHTML = `<div style="font-size:14px;font-weight:600;color:var(--rfx-text-1);margin-bottom:10px;">Confirm Delete</div>
        <div style="font-size:12px;color:var(--rfx-text-2);margin-bottom:20px;line-height:1.4;">Delete “${escHtml(name.replace(/\.(aep|expr\.json|props\.json)$/,''))}”? This cannot be undone.</div>`;
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:10px;';
    const cancel = mkBtn('Cancel','btn-secondary'); cancel.onclick = () => modal.remove();
    const del = mkBtn('Delete','btn-primary');
    del.onclick = () => { modal.remove(); AX.eval(`assetsDeleteJSX("${encodeURIComponent(fullPath)}")`, res => {
        if (res === 'ok'){ showToast("Deleted!"); closeDrawer(); assetsRefresh(); } else showToast("Failed to delete."); }); };
    wrap.appendChild(cancel); wrap.appendChild(del); box.appendChild(wrap); modal.appendChild(box); document.body.appendChild(modal);
};

function assetContextMenu(e, item){
    e.preventDefault(); e.stopPropagation();
    const old = document.getElementById('asset-ctx-menu'); if (old) old.remove();
    const menu = document.createElement('div'); menu.id = 'asset-ctx-menu'; menu.className = 'ctx-menu';
    const entries = item.isFolder
        ? [ {label:'Open', action:()=>navigateTo(encodeURIComponent(item.path))},
            {label:'Rename', action:()=>openAssetRenameModal(item.name, item.path)},
            {sep:true}, {label:'Delete', action:()=>openAssetDeleteModal(item.name, item.path)} ]
        : [ {label:'Preview', action:()=>openDrawer(item)},
            {label:(item.kind==='expr'?'Apply':'Import'), action:()=>quickImport(item)},
            {label:'Reveal in Explorer', action:()=>revealInExplorer(item.path)},
            {label:'Edit tags…', action:()=>openTagEditor(item)},
            {sep:true}, {label:'Rename', action:()=>openAssetRenameModal(item.name, item.path)},
            {label:'Delete', action:()=>openAssetDeleteModal(item.name, item.path)} ];
    entries.forEach(it => {
        if (it.sep){ const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s); return; }
        const d = document.createElement('div'); d.className = 'ctx-item'; d.textContent = it.label;
        d.onclick = ev => { ev.stopPropagation(); menu.remove(); it.action(); };
        menu.appendChild(d);
    });
    document.body.appendChild(menu);
    let x = e.clientX, y = e.clientY; const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (x+mw > window.innerWidth) x = window.innerWidth-mw-4; if (y+mh > window.innerHeight) y = window.innerHeight-mh-4;
    menu.style.left = Math.max(4,x)+'px'; menu.style.top = Math.max(4,y)+'px';
    setTimeout(() => document.addEventListener('mousedown', function close(ev){ const m = document.getElementById('asset-ctx-menu'); if (m && !m.contains(ev.target)){ m.remove(); document.removeEventListener('mousedown', close); } }), 10);
}

/* =====================================================================
   DRAG & DROP  (reorder + move into folder / breadcrumb)
   ===================================================================== */
window._draggedItemData = null;
function wireDrag(card, item, isFolder){
    card.addEventListener('dragstart', e => { window._draggedItemData = { name:item.name, path:item.path, isFolder }; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain','moving'); setTimeout(()=>card.classList.add('dragging'),0); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); saveGridOrder(); });
    card.addEventListener('dragover', e => {
        e.preventDefault(); if (card.classList.contains('dragging')) return;
        const b = card.getBoundingClientRect(), xo = e.clientX-b.left, yo = e.clientY-b.top;
        if (isFolder && xo>b.width*0.2 && xo<b.width*0.8 && yo>b.height*0.2 && yo<b.height*0.8){ card.classList.add('drop-folder-target'); return; }
        card.classList.remove('drop-folder-target');
        const grid = document.getElementById('assets-grid'), dc = grid.querySelector('.dragging');
        if (dc && dc !== card) performSmoothReorder(grid, dc, card, xo > b.width/2);
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-folder-target'));
    card.addEventListener('drop', e => {
        e.preventDefault(); card.classList.remove('drop-folder-target');
        if (isFolder){ const b = card.getBoundingClientRect(), xo = e.clientX-b.left, yo = e.clientY-b.top;
            if (xo>b.width*0.2 && xo<b.width*0.8 && yo>b.height*0.2 && yo<b.height*0.8){
                const dd = window._draggedItemData; if (!dd || dd.path === item.path) return;
                AX.eval(`assetsMoveItemJSX("${encodeURIComponent(dd.path)}","${encodeURIComponent(item.path)}")`, res => {
                    if (res === 'ok'){ showToast("Moved to folder!"); assetsRefresh(); } else showToast("Failed to move."); }); } }
    });
}
window.performSmoothReorder = function(grid, dragging, target, after){
    if (dragging.nextSibling === target && !after) return;
    if (dragging.previousSibling === target && after) return;
    const cards = Array.from(grid.children), oldPos = cards.map(c=>c.getBoundingClientRect());
    if (after) grid.insertBefore(dragging, target.nextSibling); else grid.insertBefore(dragging, target);
    const newPos = cards.map(c=>c.getBoundingClientRect());
    cards.forEach((c,i) => { const dx = oldPos[i].left-newPos[i].left, dy = oldPos[i].top-newPos[i].top; if (!dx && !dy) return;
        c.style.transform = `translate(${dx}px,${dy}px)`; c.style.transition='none'; c.style.pointerEvents='none';
        requestAnimationFrame(()=>requestAnimationFrame(()=>{ c.style.transition='transform .3s ease-out'; c.style.transform=''; setTimeout(()=>c.style.pointerEvents='',300); })); });
};
window.saveGridOrder = function(){ const grid = document.getElementById('assets-grid'); if (grid) localStorage.setItem('rfx_order_' + currentAssetPath, JSON.stringify(Array.from(grid.children).map(c=>c.dataset.name))); };

/* =====================================================================
   BOOT
   ===================================================================== */
/* Run at load if the document is already parsed. A tab script injected after
   DOMContentLoaded would otherwise never boot — which is exactly what kept the
   toolbar button dead. */
function assetsBoot(){
    if (typeof csInterface !== 'undefined'){
        resolveLibraryRoot(() => setTimeout(assetsRefresh, 300));
        /* sweep any staging folders a previous crash or cancel left in Temp */
        AX.eval(`assetsCleanTempBundlesJSX()`, () => {});
    }
    assetsToggleView(assetsViewMode);
    /* the tag-filter button lives in the panel HTML, so bind it once the DOM is up.
       Retried a few times in case the toolbar is built after this fires. */
    wireTagFilterButton();
    let tagTries = 0;
    const tagPoll = setInterval(() => {
        wireTagFilterButton();
        const b = findTagFilterButton();
        if (++tagTries > 20 || (b && b._tagWired)) clearInterval(tagPoll);
    }, 250);

    /* drag files in from Explorer / Finder */
    const scrollEl = document.getElementById('assets-scroll');
    if (scrollEl){
        scrollEl.addEventListener('dragover', e => {
            const types = (e.dataTransfer && e.dataTransfer.types) ? Array.prototype.slice.call(e.dataTransfer.types) : [];
            if (types.indexOf('Files') !== -1){ e.preventDefault(); scrollEl.classList.add('os-drop'); }
        });
        scrollEl.addEventListener('dragleave', e => { if (e.target === scrollEl) scrollEl.classList.remove('os-drop'); });
        scrollEl.addEventListener('drop', e => {
            if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
            e.preventDefault(); scrollEl.classList.remove('os-drop');
            handleOsFileDrop(e.dataTransfer.files);
        });
    }

    const search = document.getElementById('assets-search');
    if (search){
        const wrap = search.closest('.assets-search-wrap');
        search.addEventListener('input', () => { assetsSearchTerm = search.value.trim(); if (wrap) wrap.classList.toggle('has-text', !!assetsSearchTerm); renderAssets(); });
        const clr = document.querySelector('.assets-search-clear'); if (clr) clr.onclick = () => { search.value=''; assetsSearchTerm=''; wrap.classList.remove('has-text'); renderAssets(); search.focus(); };
    }

    /* breadcrumb as drop target (move out of folder) */
    const bc = document.getElementById('assets-breadcrumb');
    if (bc){
        bc.addEventListener('dragover', e => { const t = e.target.closest('.breadcrumb-root,.breadcrumb-item'); if (t && window._draggedItemData){ e.preventDefault(); t.style.background='var(--rfx-fill-selected)'; t.style.color='var(--rfx-text-1)'; } });
        bc.addEventListener('dragleave', e => { const t = e.target.closest('.breadcrumb-root,.breadcrumb-item'); if (t){ t.style.color=''; t.style.background=''; } });
        bc.addEventListener('drop', e => { const t = e.target.closest('.breadcrumb-root,.breadcrumb-item');
            if (t && window._draggedItemData){ e.preventDefault(); t.style.color=''; t.style.background='';
                const dest = decodeURIComponent(t.getAttribute('data-path'));
                if (dest && dest !== currentAssetPath) AX.eval(`assetsMoveItemJSX("${encodeURIComponent(window._draggedItemData.path)}","${encodeURIComponent(dest)}")`, res => {
                    if (res === 'ok'){ showToast("Moved!"); assetsRefresh(); } else showToast("Failed to move."); }); } });
    }

    document.addEventListener('click', e => { const m = document.getElementById('assets-save-menu'); const btn = document.getElementById('assets-save-menu-btn');
        if (m && m.classList.contains('open') && !m.contains(e.target) && e.target !== btn && !(btn && btn.contains(e.target))) closeSaveMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape'){ closeSaveMenu(); if (document.getElementById('asset-drawer')?.classList.contains('open')) closeDrawer(); } });

    /* keep the open sheet fitting the panel as After Effects resizes it */
    wireSheetResize();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', assetsBoot);
else assetsBoot();