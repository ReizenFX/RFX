/* ===== JSON polyfill (ExtendScript has no native JSON) + version marker ===== */
if (typeof JSON === "undefined") { JSON = {}; }
(function () {
    function q(s){
        var esc = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
            m = {"\b":"\\b","\t":"\\t","\n":"\\n","\f":"\\f","\r":"\\r","\"":"\\\"","\\":"\\\\"};
        esc.lastIndex = 0;
        return esc.test(s) ? "\"" + s.replace(esc, function(a){
            var c = m[a]; return typeof c === "string" ? c : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
        }) + "\"" : "\"" + s + "\"";
    }
    var gap;
    function str(key, holder){
        var i, k, v, len, partial, mind = gap, value = holder[key];
        if (value && typeof value === "object" && typeof value.toJSON === "function") value = value.toJSON(key);
        switch (typeof value){
            case "string": return q(value);
            case "number": return isFinite(value) ? String(value) : "null";
            case "boolean": case "null": return String(value);
            case "object":
                if (!value) return "null";
                gap += "  "; partial = [];
                if (Object.prototype.toString.apply(value) === "[object Array]"){
                    len = value.length;
                    for (i = 0; i < len; i += 1) partial[i] = str(i, value) || "null";
                    v = partial.length === 0 ? "[]" : "[" + partial.join(",") + "]";
                    gap = mind; return v;
                }
                for (k in value){ if (Object.prototype.hasOwnProperty.call(value, k)){ v = str(k, value); if (v) partial.push(q(k) + ":" + v); } }
                v = partial.length === 0 ? "{}" : "{" + partial.join(",") + "}";
                gap = mind; return v;
        }
        return undefined;
    }
    if (typeof JSON.stringify !== "function"){
        JSON.stringify = function (value){ gap = ""; return str("", { "": value }); };
    }
    if (typeof JSON.parse !== "function"){
        JSON.parse = function (text){
            text = String(text);
            if (/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]").replace(/(?:^|:|,)(?:\s*\[)+/g, ""))){
                return eval("(" + text + ")");
            }
            throw new Error("JSON.parse: invalid JSON");
        };
    }
}());

/* Exact backend-version marker — the panel checks this instead of decompiling a function. */
function assetsBackendVersionJSX(){ return 7; }

/* =====================================================================
   ULTIMATE FX SUITE  —  ASSETS TAB  (ExtendScript backend)
   ---------------------------------------------------------------------
   Asset model: every saved asset is a FOLDER ("bundle") that contains
     - the primary file:  <name>.aep | <name>.props.json | <name>.expr.json | <name>.<ext>
     - (Footage)/         collected dependencies (for .aep bundles)
     - .thumb.png         still thumbnail (optional)
     - .preview/          flipbook frames f000.png ... (optional, on demand)
     - .meta.json         { kind, name, created, width, height, duration,
                            frameRate, layerCount, source, hasThumb,
                            hasPreview, tags }
   A folder is treated as an ASSET when it contains .meta.json OR a legacy
   <name>.aep / <name>.expr.json. Otherwise it is a navigable FOLDER.
   NOTE: relies on a JSON polyfill already present in the JSX bundle
         (the previous code used JSON.stringify/parse in JSX too).
   ===================================================================== */

/* ---------- small helpers ---------- */
function _norm(p){ return String(p).replace(/\\/g, "/"); }
function _dec(s){ try { return decodeURIComponent(s); } catch(e){ return unescape(s); } }
function _baseNoExt(name){
    if (name.indexOf('.expr.json') !== -1) return name.substring(0, name.length - 10);
    if (name.indexOf('.props.json') !== -1) return name.substring(0, name.length - 11);
    var d = name.lastIndexOf('.');
    return d === -1 ? name : name.substring(0, d);
}
function _writeText(file, txt){
    file.encoding = 'UTF-8'; file.open('w'); file.write(txt); file.close();
}
function _readText(file){
    if (!file.exists) return null;
    file.encoding = 'UTF-8'; file.open('r'); var s = file.read(); file.close(); return s;
}
function _uniqueFolder(parentPath, name){
    var t = new Folder(parentPath + "/" + name), n = 1;
    while (t.exists){ t = new Folder(parentPath + "/" + name + " (" + n + ")"); n++; }
    return t;
}

function assetsRmDir(folder){
    if (!folder.exists) return;
    var files = folder.getFiles();
    for (var i = 0; i < files.length; i++){
        if (files[i] instanceof Folder) assetsRmDir(files[i]);
        else files[i].remove();
    }
    folder.remove();
}
function _copyFolderRecursive(srcFolder, destFolder){
    if (!destFolder.exists) destFolder.create();
    var files = srcFolder.getFiles();
    for (var i = 0; i < files.length; i++){
        if (files[i] instanceof Folder){
            _copyFolderRecursive(files[i], new Folder(_norm(destFolder.fsName) + "/" + files[i].name));
        } else {
            files[i].copy(new File(_norm(destFolder.fsName) + "/" + files[i].name));
        }
    }
}

/* ---------- project / comp state ---------- */
function assetsCheckProjectSaved(){ return app.project.file ? "saved" : "unsaved"; }

function assetsDefaultLibraryJSX(){
    try {
        var dl = new Folder("~/Downloads");
        var base = (dl.exists ? dl.fsName : Folder.userData.fsName).replace(/\\/g, "/");
        var lib = new Folder(base + "/Ultimate FX Suite");
        if (!lib.exists) lib.create();
        return lib.fsName.replace(/\\/g, "/");
    } catch (e){ return "error: " + e.toString(); }
}

function _getTargetComp(){
    if (app.project.activeItem instanceof CompItem) return app.project.activeItem;
    var sel = app.project.selection;
    if (sel && sel.length){
        for (var i = 0; i < sel.length; i++) if (sel[i] instanceof CompItem) return sel[i];
    }
    var comps = [];
    for (var j = 1; j <= app.project.numItems; j++)
        if (app.project.item(j) instanceof CompItem) comps.push(app.project.item(j));
    return comps.length === 1 ? comps[0] : null;
}

function _compMeta(comp, kind, layerCount){
    return {
        kind: kind, name: "", created: (new Date()).getTime(),
        width: comp.width, height: comp.height,
        duration: comp.duration, frameRate: comp.frameRate,
        layerCount: (typeof layerCount === "number" ? layerCount : comp.numLayers),
        source: "", hasThumb: false, hasPreview: false, tags: []
    };
}

/* ---------- thumbnail (still) for comps / layers ---------- */
/* Renders the comp's current frame silently. Returns temp png path or "". */
function _renderFramesRQ(comp, outFolder, prefix, frameCount){
    var savedFR = comp.frameRate, savedRes = comp.resolutionFactor, item = null, made = 0, others = [];
    try {
        app.beginSuppressDialogs();
        if (frameCount > 1){
            try { var f = Math.max(1, Math.round(comp.width / 1280)); comp.resolutionFactor = [f, f]; } catch(e){}
            var fr = frameCount / comp.duration; if (fr < 0.01) fr = 0.01;
            try { comp.frameRate = fr; } catch(e){}
        }
        item = app.project.renderQueue.items.add(comp);
        /* make sure ONLY our item renders (don't touch the user's queued items) */
        for (var i = 1; i <= app.project.renderQueue.numItems; i++){
            var it = app.project.renderQueue.item(i);
            if (it !== item){ others.push([it, it.render]); try { it.render = false; } catch(e){} }
        }
        if (frameCount <= 1){
            item.timeSpanStart = comp.time || 0;
            item.timeSpanDuration = 1 / comp.frameRate;
        } else {
            item.timeSpanStart = 0;
            item.timeSpanDuration = comp.duration;
        }
        var om = item.outputModule(1);
        var names = ["PNG Sequence", "PNG", "PNG Sequence with Alpha"];
        for (var t = 0; t < names.length; t++){ try { om.applyTemplate(names[t]); break; } catch(e){} }
        om.file = new File(_norm(outFolder.fsName) + "/" + prefix + "[###].png");
        app.project.renderQueue.render();
        var pngs = outFolder.getFiles("*.png"); made = pngs ? pngs.length : 0;
    } catch (e){ made = 0; }
    for (var j = 0; j < others.length; j++){ try { others[j][0].render = others[j][1]; } catch(e){} }
    try { if (item) item.remove(); } catch(e){}
    try { comp.frameRate = savedFR; } catch(e){}
    try { comp.resolutionFactor = savedRes; } catch(e){}
    try { app.endSuppressDialogs(false); } catch(e){}
    return made;
}
function _renderStill(comp){
    /* fast path only: saveFrameToPng (AE 2022+). If unavailable the preview
       render (on a disposable copy) supplies the thumbnail instead. */
    try {
        if (comp.saveFrameToPng){
            var tmp = new File(_norm(Folder.temp.fsName) + "/ufx_thumb_" + (new Date()).getTime() + ".png");
            comp.saveFrameToPng(comp.time, tmp);
            if (tmp.exists && tmp.length > 0) return _norm(tmp.fsName);
        }
    } catch (e){}
    return "";
}
function _inferBundle(folder){
    try {
        var MEDIA = { mp4:"video",mov:"video",webm:"video",m4v:"video",avi:"video",mkv:"video",
                      mp3:"audio",wav:"audio",aac:"audio",m4a:"audio",ogg:"audio",flac:"audio",aif:"audio",aiff:"audio",
                      png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",bmp:"image",tif:"image",tiff:"image",svg:"image" };
        var fl = folder.getFiles();
        for (var i = 0; i < fl.length; i++){
            if (!(fl[i] instanceof File)) continue;
            var nm = fl[i].name; try { nm = decodeURIComponent(nm); } catch (e){}
            if (nm.charAt(0) === ".") continue;                 // skip .meta.json / .thumb.png
            if (nm.indexOf(".aep") !== -1) return { kind:"comp", source:nm };
            if (nm.indexOf(".expr.json") !== -1) return { kind:"expr", source:nm };
            var d = nm.lastIndexOf(".");
            if (d !== -1){ var ext = nm.substring(d+1).toLowerCase(); if (MEDIA[ext]) return { kind:MEDIA[ext], source:nm }; }
        }
        return null;
    } catch (e){ return null; }
}

/* =====================================================================
   DIRECTORY LISTING  (rich)
   ===================================================================== */
function assetsGetDirJSX(encodedPath){
    try {
        var p = _norm(_dec(encodedPath));
        var folder = new Folder(p);
        if (!folder.exists) folder.create();

        var files = folder.getFiles(), out = [];
        for (var i = 0; i < files.length; i++){
            var f = files[i], n = f.name;
            try { n = decodeURIComponent(n); } catch (e){ n = unescape(n); }
            if (n.indexOf('.') === 0 || n === '(Footage)') continue;

            if (f instanceof Folder){
                var fp = _norm(f.fsName);
                var metaFile = new File(fp + "/.meta.json");
                var meta = null;
                if (metaFile.exists){
                    try { meta = JSON.parse(_readText(metaFile)); } catch (e){ meta = null; }
                }
                /* legacy single-file bundles from older builds */
                if ((!meta || !meta.kind) && (new File(fp + "/" + n + ".aep")).exists){ meta = meta || {}; meta.kind = "comp"; }
                else if ((!meta || !meta.kind) && (new File(fp + "/" + n + ".expr.json")).exists){ meta = meta || {}; meta.kind = "expr"; }
                /* still no kind? infer from the payload file inside (recovers media bundles) */
                if (!meta || !meta.kind){
                    var inf = _inferBundle(f);
                    if (inf){ meta = meta || {}; meta.kind = inf.kind; if (inf.source && !meta.source) meta.source = inf.source; }
                }
                if (meta && meta.kind){
                    /* derive preview/thumb straight from the files on disk */
                    var thumbPath = fp + "/.thumb.png";
                    var hasThumb = (new File(thumbPath)).exists;
                    var pvF = new Folder(fp + "/.preview");
                    var gifF = new File(fp + "/.preview/preview.gif");
                    var pc = 0, pfmt = "";
                    if (pvF.exists){
                        if (gifF.exists){ pfmt = "gif"; }
                        else { var pfs = pvF.getFiles("f*.png"); pc = pfs ? pfs.length : 0; if (pc > 0) pfmt = "sequence"; }
                    }
                    if (!hasThumb && pc > 0){ var ff = new File(fp + "/.preview/f000.png"); if (ff.exists){ hasThumb = true; thumbPath = fp + "/.preview/f000.png"; } }
                    meta.hasThumb = hasThumb;
                    meta.hasPreview = (pfmt !== "");
                    meta.previewCount = pc;
                    meta.previewFormat = pfmt;
                    meta.gifPath = gifF.exists ? (fp + "/.preview/preview.gif") : "";
                    out.push({
                        name: n, isFolder: false, isAsset: true,
                        kind: meta.kind, path: fp, meta: meta,
                        thumb: hasThumb ? thumbPath : ""
                    });
                    continue;
                }
                out.push({ name: n, isFolder: true, isAsset: false, path: fp });
            }
        }
        return JSON.stringify(out);
    } catch (e){ return "error: " + e.toString(); }
}

/* =====================================================================
   SAVE COMP  /  SAVE LAYERS   ->  returns JSON {status,tempDir,thumb,meta}
   ===================================================================== */
function _bundleReturn(tempDir, thumb, meta){
    return JSON.stringify({ status: "ok",
        tempDir: _norm(tempDir.fsName), thumb: thumb, meta: meta });
}

/* find a project item by its persistent id (ids survive a save-as, which
   does not reload the project — but this stays correct if it ever does) */
function _findItemById(id){
    for (var i = 1; i <= app.project.numItems; i++)
        if (app.project.item(i).id === id) return app.project.item(i);
    return null;
}

/* Stage a self-contained copy of the project at tempFile:
     1. save the user's project   (preserve their current state)
     2. save-as to tempFile        (the live project becomes the copy)
     3. stripFn()                  (pare the copy down to the target)
     4. collect footage + save     (make the copy self-contained)
     5. reopen the user's project  (always, even on error)
   stripFn takes no arguments and must leave only the wanted comp(s). */
function _stageBundle(origFile, tempFile, stripFn){
    app.beginSuppressDialogs();
    try {
        app.project.save(origFile);
        app.project.save(tempFile);
        stripFn();
        while (app.project.renderQueue.numItems > 0) app.project.renderQueue.item(1).remove();
        _collectDependenciesForTemp(tempFile);
        app.project.save(tempFile);
    } finally {
        try { app.open(origFile); } catch (e){}
        try { app.endSuppressDialogs(false); } catch (e){}
    }
}

function assetsSaveCompJSX(){
    var origFile = null;
    try {
        var comp = _getTargetComp();
        if (!comp) return "none";
        origFile = app.project.file;
        if (!origFile) return "error: save your After Effects project to disk first";

        var meta  = _compMeta(comp, "comp");
        var thumb = _renderStill(comp);          // grab BEFORE we juggle the project
        var targetId = comp.id;

        var tempDir = new Folder(_norm(Folder.temp.fsName) + "/ufx_bundle_" + (new Date()).getTime());
        if (!tempDir.exists) tempDir.create();
        var tempFile = new File(tempDir.fsName + "/" + tempDir.name + ".aep");

        _stageBundle(origFile, tempFile, function(){
            var keep = _findItemById(targetId);
            if (!keep) throw new Error("target comp was lost while staging");
            app.project.reduceProject([keep]);   // keep the comp + ALL its dependencies
        });

        return _bundleReturn(tempDir, thumb, meta);
    } catch (e){
        try { if (origFile) app.open(origFile); } catch (err){}
        try { app.endSuppressDialogs(false); } catch (e2){}
        return "error: " + e.toString() + " (line " + (e.line || "?") + ")";
    }
}

function assetsSaveLayersJSX(){
    var origFile = null;
    try {
        var comp = _getTargetComp();
        if (!comp) return "none";
        var selLayers = comp.selectedLayers;
        if (!selLayers || selLayers.length === 0) return "error: select one or more layers in the timeline first";
        origFile = app.project.file;
        if (!origFile) return "error: save your After Effects project to disk first";

        var meta  = _compMeta(comp, "layers", selLayers.length);
        var thumb = _renderStill(comp);
        var targetId = comp.id;

        var keepIdx = {};
        for (var k = 0; k < selLayers.length; k++) keepIdx[selLayers[k].index] = true;

        var tempDir = new Folder(_norm(Folder.temp.fsName) + "/ufx_bundle_" + (new Date()).getTime());
        if (!tempDir.exists) tempDir.create();
        var tempFile = new File(tempDir.fsName + "/" + tempDir.name + ".aep");

        _stageBundle(origFile, tempFile, function(){
            var tempComp = _findItemById(targetId);
            if (!tempComp || !(tempComp instanceof CompItem)) throw new Error("target comp was lost while staging");
            for (var j = tempComp.numLayers; j >= 1; j--)
                if (!keepIdx[j]){ try { tempComp.layer(j).remove(); } catch (e){} }
            app.project.reduceProject([tempComp]);   // keep the comp + footage the kept layers use
        });

        return _bundleReturn(tempDir, thumb, meta);
    } catch (e){
        try { if (origFile) app.open(origFile); } catch (err){}
        try { app.endSuppressDialogs(false); } catch (e2){}
        return "error: " + e.toString() + " (line " + (e.line || "?") + ")";
    }
}

/* ---------- dependency collection ---------- */
/* Copy every file-based footage source used by the staged project into
   (Footage)/, mirroring the project's bin structure, and relink each item
   to its copy so the saved .aep is self-contained. One bad/offline item is
   skipped without aborting the rest.
   NOTE: image sequences are collected as their first frame only for now —
   full sequence support is a follow-up. */
function _collectDependenciesForTemp(tempFile){
    var proj = app.project;
    var tempFootageDir = new Folder(_norm(tempFile.parent.fsName) + "/(Footage)");

    var itemsToProcess = [];
    for (var i = 1; i <= proj.numItems; i++){
        var item = proj.item(i);
        if (item instanceof FootageItem && item.mainSource instanceof FileSource && item.mainSource.file)
            itemsToProcess.push(item);
    }
    if (itemsToProcess.length === 0) return;

    var footageAeFolder = null;
    for (var f = 1; f <= proj.numItems; f++){
        var fItem = proj.item(f);
        if (fItem instanceof FolderItem && fItem.name === "(Footage)" && fItem.parentFolder === proj.rootFolder){ footageAeFolder = fItem; break; }
    }
    if (!footageAeFolder) footageAeFolder = proj.items.addFolder("(Footage)");
    if (!tempFootageDir.exists) tempFootageDir.create();

    for (var k = 0; k < itemsToProcess.length; k++){
        var cItem = itemsToProcess[k];
        try {
            var origFileC = cItem.mainSource.file;
            if (!origFileC || !origFileC.exists) continue;   // offline / missing → leave linked as-is

            var aePathArr = [], parent = cItem.parentFolder;
            while (parent && parent !== proj.rootFolder && parent.name !== "(Footage)"){ aePathArr.unshift(parent.name); parent = parent.parentFolder; }
            var currentAeFolder = footageAeFolder, currentOsPath = _norm(tempFootageDir.fsName);
            for (var pI = 0; pI < aePathArr.length; pI++){
                var foundAe = false;
                for (var j = 1; j <= currentAeFolder.numItems; j++){
                    var subItem = currentAeFolder.item(j);
                    if (subItem instanceof FolderItem && subItem.name === aePathArr[pI]){ currentAeFolder = subItem; foundAe = true; break; }
                }
                if (!foundAe){ var nf = proj.items.addFolder(aePathArr[pI]); nf.parentFolder = currentAeFolder; currentAeFolder = nf; }
                currentOsPath += "/" + aePathArr[pI];
                var osDir = new Folder(currentOsPath); if (!osDir.exists) osDir.create();
            }
            cItem.parentFolder = currentAeFolder;

            var base = origFileC.name, ext = "";
            var dot = base.lastIndexOf('.');
            if (dot !== -1){ ext = base.substring(dot); base = base.substring(0, dot); }
            var newFile = new File(currentOsPath + "/" + origFileC.name), n = 1;
            while (newFile.exists){ newFile = new File(currentOsPath + "/" + base + "_" + n + ext); n++; }

            if (origFileC.copy(newFile)) cItem.replace(newFile);
        } catch (itemErr){ /* skip a single bad item; keep collecting the rest */ }
    }

    for (var ci = proj.numItems; ci >= 1; ci--){
        var chk = proj.item(ci);
        if (chk instanceof FolderItem && chk.name !== "(Footage)" && chk.numItems === 0){ try { chk.remove(); } catch (e){} }
    }
}

/* =====================================================================
   FINALIZE a temp .aep bundle into the library (moves aep + footage +
   thumb, writes .meta.json). Replaces the old assetsMoveTempFileJSX.
   ===================================================================== */
function assetsFinalizeBundleJSX(encodedTempDir, encodedDest, name, encodedThumb, encodedMeta){
    var tempBundle = null, target = null, thumbFile = null, ok = false;
    try {
        tempBundle = new Folder(_norm(_dec(encodedTempDir)));

        var destRoot = new Folder(_norm(_dec(encodedDest)));
        if (!destRoot.exists){ try { destRoot.create(); } catch (ce){} }
        if (!destRoot.exists) return "error: library folder is unavailable: " + destRoot.fsName;

        target = _uniqueFolder(_norm(destRoot.fsName), name);
        if (!target.create()) return "error: could not create the asset folder (is the library writable?)";
        var tp = _norm(target.fsName);

        /* primary file — the staged .aep must exist and copy cleanly */
        var tempAep = new File(tempBundle.fsName + "/" + tempBundle.name + ".aep");
        var destAep = new File(tp + "/" + target.name + ".aep");
        if (!tempAep.exists) return "error: the staged project file is missing";
        if (!tempAep.copy(destAep) || !destAep.exists) return "error: could not copy the project into the library";

        /* collected footage (optional) */
        var tempFootage = new Folder(tempBundle.fsName + "/(Footage)");
        if (tempFootage.exists) _copyFolderRecursive(tempFootage, new Folder(tp + "/(Footage)"));

        /* metadata */
        var meta = {};
        try { meta = JSON.parse(_dec(encodedMeta)); } catch (e){ meta = { kind: "comp" }; }
        meta.name = name;

        /* thumbnail (optional) */
        var thumbSrc = _dec(encodedThumb);
        if (thumbSrc){
            thumbFile = new File(_norm(thumbSrc));
            if (thumbFile.exists && thumbFile.copy(new File(tp + "/.thumb.png"))) meta.hasThumb = true;
        }

        _writeText(new File(tp + "/.meta.json"), JSON.stringify(meta));
        ok = true;
        return "ok:" + tp;
    } catch (e){
        return "error: " + e.toString();
    } finally {
        /* the staging thumbnail + bundle always leave Temp */
        try { if (thumbFile && thumbFile.exists) thumbFile.remove(); } catch (er){}
        try { if (tempBundle && tempBundle.exists) assetsRmDir(tempBundle); } catch (er){}
        /* on failure, never leave a half-written asset behind in the library */
        try { if (!ok && target && target.exists) assetsRmDir(target); } catch (er){}
    }
}

/* =====================================================================
   IMPORT an .aep bundle back into the active comp   (unchanged behaviour)
   ===================================================================== */
function assetsImportAEPJSX(encodedPath){
    var targetComp = _getTargetComp();
    if (!targetComp) return "NO_ACTIVE_COMP";

    var filePath = _norm(_dec(encodedPath));
    var f = new File(filePath), folder = new Folder(filePath);
    if (folder.exists) f = new File(folder.fsName + "/" + folder.name + ".aep");
    if (!f.exists) return "File not found.";

    var findComp = function(item){
        if (item instanceof CompItem) return item;
        if (item instanceof FolderItem) for (var i = 1; i <= item.numItems; i++){ var c = findComp(item.item(i)); if (c) return c; }
        return null;
    };
    var rqBefore = app.project.renderQueue.numItems, newLayers = [];
    app.beginSuppressDialogs();
    app.beginUndoGroup("Import Ultimate FX Asset");
    try {
        var importedItem = app.project.importFile(new ImportOptions(f));
        var holdComp = findComp(importedItem);
        if (holdComp && targetComp.id !== holdComp.id){
            for (var sel = 1; sel <= targetComp.numLayers; sel++) targetComp.layer(sel).selected = false;
            for (var l = holdComp.numLayers; l >= 1; l--){
                var srcLayer = holdComp.layer(l);
                if (_isPreviewBackdrop(srcLayer)) continue;      // assets saved before the fix still carry it
                newLayers.push(srcLayer.copyToComp(targetComp));
            }
            holdComp.remove();
        }
        _purgePreviewBackdrops(importedItem);
        if (importedItem instanceof FolderItem && importedItem.numItems === 0) importedItem.remove();
        for (var nI = 0; nI < newLayers.length; nI++) newLayers[nI].selected = true;
        app.endUndoGroup();
    } catch (e){
        app.endUndoGroup(); app.endSuppressDialogs(false);
        return "Import error: " + e.message;
    }
    try {
        var rqAfter = app.project.renderQueue.numItems;
        if (rqAfter > rqBefore) for (var rq = rqAfter; rq > rqBefore; rq--) app.project.renderQueue.item(rq).remove();
        if (targetComp) targetComp.openInViewer();
    } catch (err){}
    app.endSuppressDialogs(false);
    return "ok";
}

/* =====================================================================
   MEDIA ASSETS  (video / audio / image)
   ===================================================================== */
/* Copy an external file into a new bundle. Returns JSON of the bundle so
   the JS side can write the client-generated thumbnail + finalize meta. */
function assetsCreateMediaBundleJSX(encodedSrc, encodedDest, name, encodedMeta){
    try {
        var src = new File(_norm(_dec(encodedSrc)));
        if (!src.exists) return "error: source file not found: " + src.fsName;

        var destRoot = new Folder(_norm(_dec(encodedDest)));
        if (!destRoot.exists){ try { destRoot.create(); } catch (ce){} }
        if (!destRoot.exists) return "error: library folder is unavailable: " + destRoot.fsName;

        var ext = ""; var dot = src.name.lastIndexOf('.');
        if (dot !== -1) ext = src.name.substring(dot);

        var target = _uniqueFolder(_norm(destRoot.fsName), name);
        if (!target.create() || !target.exists) return "error: could not create the asset folder (is the library writable?): " + target.fsName;
        var tp = _norm(target.fsName);

        var destFile = new File(tp + "/" + target.name + ext);
        if (!src.copy(destFile) || !destFile.exists){
            try { assetsRmDir(target); } catch (er){}   // don't leave an empty bundle behind
            return "error: could not copy the media into the library (permission or disk space?)";
        }

        var meta = {};
        try { meta = JSON.parse(_dec(encodedMeta)); } catch (e){ meta = {}; }
        meta.name = name; meta.source = src.name; meta.hasThumb = false;
        _writeText(new File(tp + "/.meta.json"), JSON.stringify(meta));

        return JSON.stringify({ status: "ok", bundle: tp, file: _norm(destFile.fsName) });
    } catch (e){ return "error: " + e.toString() + " (line " + (e.line || "?") + ")"; }
}

/* Import a media asset's file into the active comp as a layer. */
function assetsImportMediaToCompJSX(encodedBundle){
    var targetComp = _getTargetComp();
    if (!targetComp) return "NO_ACTIVE_COMP";
    try {
        var bundle = new Folder(_norm(_dec(encodedBundle)));
        var media = null, files = bundle.getFiles();
        for (var i = 0; i < files.length; i++){
            if (files[i] instanceof File && files[i].name.indexOf('.') !== 0
                && files[i].name.indexOf('.meta.json') === -1){ media = files[i]; break; }
        }
        if (!media || !media.exists) return "File not found.";
        app.beginUndoGroup("Import Media Asset");
        var footage = app.project.importFile(new ImportOptions(media));
        var layer = targetComp.layers.add(footage);
        for (var s = 1; s <= targetComp.numLayers; s++) targetComp.layer(s).selected = false;
        layer.selected = true;
        app.endUndoGroup();
        return "ok";
    } catch (e){ return "error: " + e.toString(); }
}

/* =====================================================================
   EXPRESSIONS  (kept, now writes meta)
   ===================================================================== */
function assetsSaveExpressionJSX(){
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) return "none";
    var props = comp.selectedProperties;
    if (!props || props.length === 0) return "none";
    var exprProp = null;
    for (var i = 0; i < props.length; i++)
        if (props[i].canSetExpression && props[i].expressionEnabled && props[i].expression !== ""){ exprProp = props[i]; break; }
    if (!exprProp) return "none";
    var data = { name: exprProp.name + " Expr", expression: exprProp.expression,
                 dimensionsSeparated: (exprProp.matchName === "ADBE Position" && exprProp.dimensionsSeparated) };
    return encodeURIComponent(JSON.stringify(data));
}

function assetsWriteExprJSX(encodedDest, name, encodedData){
    try {
        var destRoot = new Folder(_norm(_dec(encodedDest)));
        if (!destRoot.exists) destRoot.create();
        var target = _uniqueFolder(_norm(destRoot.fsName), name);
        target.create();
        var tp = _norm(target.fsName);
        _writeText(new File(tp + "/" + target.name + ".expr.json"), _dec(encodedData));
        var meta = { kind: "expr", name: name, created: (new Date()).getTime(),
                     hasThumb: false, hasPreview: false, tags: [] };
        _writeText(new File(tp + "/.meta.json"), JSON.stringify(meta));
        return "ok";
    } catch (e){ return "error: " + e.toString(); }
}

function assetsImportExprJSX(encodedExpr, isSeparated){
    var rawExpr = _dec(encodedExpr);
    var comp = _getTargetComp();
    if (!comp) return "NO_ACTIVE_COMP";
    var props = comp.selectedProperties;
    if (!props || props.length === 0) return "Select a property to apply to.";
    app.beginUndoGroup("Apply Asset Expression");
    try {
        for (var i = 0; i < props.length; i++){
            var p = props[i];
            if (p.canSetExpression){
                if (p.matchName === "ADBE Position" && p.dimensionsSeparated !== isSeparated) p.dimensionsSeparated = isSeparated;
                p.expression = rawExpr; p.expressionEnabled = true;
            }
        }
        app.endUndoGroup(); return "ok";
    } catch (e){ app.endUndoGroup(); return "Failed to apply expression. Check compatibility."; }
}

/* =====================================================================
   MOTION PREVIEW  (optional flipbook of downscaled stills)
   Renders `count` frames evenly across the comp of an .aep bundle into
   .preview/f###.png . Codec-independent; the UI animates them on hover.
   ===================================================================== */
/* ---------- the preview backdrop ----------
   Previews render over a dark solid so transparent areas read like the comp
   viewer. It exists only for the render and must never end up in an asset. */
var _PREVIEW_BG_NAMES = { ufx_bg:1, uwu_bg:1, ultfx_bg:1 };
function _isBackdropSolidItem(it){
    try {
        return (it instanceof FootageItem) && (it.mainSource instanceof SolidSource)
            && _PREVIEW_BG_NAMES.hasOwnProperty(String(it.name).toLowerCase());
    } catch (e){ return false; }
}
function _isPreviewBackdrop(layer){
    try {
        return _PREVIEW_BG_NAMES.hasOwnProperty(String(layer.name).toLowerCase())
            && layer.source && _isBackdropSolidItem(layer.source);
    } catch (e){ return false; }
}
/* remove the backdrop layer, then its solid, then a folder that left empty */
function _removePreviewBackdrop(layer){
    if (!layer) return;
    try {
        var src = layer.source, folder = src ? src.parentFolder : null;
        layer.remove();
        if (src && src.usedIn.length === 0){
            src.remove();
            if (folder && folder !== app.project.rootFolder && folder.numItems === 0) folder.remove();
        }
    } catch (e){}
}
/* Strip backdrops out of everything under an imported folder: the layers
   first, then any backdrop solid nothing uses, then folders that emptied.
   Scoped to the imported asset only — nothing else in the project is read. */
function _purgePreviewBackdrops(root){
    if (!root || !(root instanceof FolderItem)) return;
    var items = [], k, j, it;
    (function walk(f){
        for (var i = 1; i <= f.numItems; i++){ var c = f.item(i); items.push(c); if (c instanceof FolderItem) walk(c); }
    })(root);
    for (k = 0; k < items.length; k++){
        it = items[k];
        if (!(it instanceof CompItem)) continue;
        for (j = it.numLayers; j >= 1; j--){
            try { var l = it.layer(j); if (_isPreviewBackdrop(l)){ l.locked = false; l.remove(); } } catch (e){}
        }
    }
    for (k = items.length - 1; k >= 0; k--){
        it = items[k];
        try {
            if (_isBackdropSolidItem(it) && it.usedIn.length === 0){
                var pf = it.parentFolder; it.remove();
                if (pf && pf !== root && pf.numItems === 0) pf.remove();
            }
        } catch (e){}
    }
}

function assetsRenderPreviewJSX(encodedBundle, count){
    var made = 0, origFile = app.project.file, opened = false;
    var recDur = 0, recFR = 0, usedRQ = false;
    try {
        var bundle = new Folder(_norm(_dec(encodedBundle)));
        var aep = new File(bundle.fsName + "/" + bundle.name + ".aep");
        if (!aep.exists) return "error: no aep";

        app.beginSuppressDialogs();
        if (origFile) app.project.save(origFile);
        app.open(aep); opened = true;

        /* the asset's own comp: the top-level one (not nested in another comp).
           Picking simply the first comp in the project could land on a precomp,
           whose length — and so the preview's speed — differs from the asset. */
        var comp = null, firstComp = null;
        for (var i = 1; i <= app.project.numItems; i++){
            var ci = app.project.item(i);
            if (!(ci instanceof CompItem)) continue;
            if (!firstComp) firstComp = ci;
            var nested = false; try { nested = ci.usedIn.length > 0; } catch (e){}
            if (!nested){ comp = ci; break; }
        }
        if (!comp) comp = firstComp;
        if (comp){
            recDur = comp.duration; recFR = comp.frameRate;

            /* opaque #141414 background so frames match the comp viewer. Removed
               again right after rendering, and the file is closed without saving. */
            var _bg = null;
            try { _bg = comp.layers.addSolid([20/255,20/255,20/255], "ufx_bg", comp.width, comp.height, comp.pixelAspect); _bg.moveToEnd(); } catch (e){ _bg = null; }

            /* previews are shown at panel size: render near 960px wide, not full res */
            var savedRF = null;
            try { savedRF = comp.resolutionFactor; var rf = Math.max(1, Math.round(comp.width / 960)); comp.resolutionFactor = [rf, rf]; } catch (e){}

            var pv = new Folder(bundle.fsName + "/.preview");
            if (pv.exists) assetsRmDir(pv);
            pv.create();

            var frames = count || 12;
            if (comp.saveFrameToPng){
                var dur = comp.duration;
                for (var fI = 0; fI < frames; fI++){
                    var t = (frames <= 1) ? 0 : (dur * (fI / (frames - 1)));
                    if (t >= dur) t = dur - (1 / comp.frameRate);
                    if (t < 0) t = 0;
                    var nn = "" + fI; while (nn.length < 3) nn = "0" + nn;
                    var outF = new File(pv.fsName + "/f" + nn + ".png");
                    try { comp.saveFrameToPng(t, outF); if (outF.exists) made++; } catch (e){}
                }
            }
            if (made === 0){
                var rqFolder = new Folder(_norm(Folder.temp.fsName) + "/ufx_prevrq_" + (new Date()).getTime());
                rqFolder.create();
                var n = _renderFramesRQ(comp, rqFolder, "p", frames);
                if (n > 0){
                    usedRQ = true;
                    var pngs = rqFolder.getFiles("*.png");
                    pngs.sort(function(a, b){ return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
                    for (var k = 0; k < pngs.length; k++){
                        var mm = "" + k; while (mm.length < 3) mm = "0" + mm;
                        if (pngs[k].copy(new File(pv.fsName + "/f" + mm + ".png"))) made++;
                    }
                }
                try { assetsRmDir(rqFolder); } catch (e){}
            }

            /* take the backdrop straight back out and put the resolution back */
            _removePreviewBackdrop(_bg);
            try { if (savedRF) comp.resolutionFactor = savedRF; } catch (e){}
        }
    } catch (e){ /* fall through: still finalise whatever rendered */ }

    /* Close the library file WITHOUT saving. Switching projects with dialogs
       suppressed could otherwise write the render's scratch changes (the
       backdrop solid above all) back into the asset's .aep. */
    try { if (opened) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e){}
    /* always restore the user's project, then record what actually rendered */
    try { if (opened && origFile) app.open(origFile); } catch (e){}
    try { app.endSuppressDialogs(false); } catch (e){}

    if (made > 0){
        try {
            var b2 = new Folder(_norm(_dec(encodedBundle)));
            var pv2 = new Folder(b2.fsName + "/.preview");
            var mf = new File(b2.fsName + "/.meta.json");
            var meta = mf.exists ? JSON.parse(_readText(mf)) : { kind: "comp" };
            meta.hasPreview = true; meta.previewCount = made; meta.previewFormat = "sequence";
            /* the real-time rate of these stills, so every player runs them at
               the comp's true speed. Sampled stills span (made-1) gaps over the
               duration; a render-queue pass lays made frames across it. */
            if (recDur > 0 && made > 1) meta.previewFps = usedRQ ? (made / recDur) : ((made - 1) / recDur);
            else meta.previewFps = recFR || 12;
            if (!meta.duration && recDur) meta.duration = recDur;
            if (!meta.frameRate && recFR) meta.frameRate = recFR;
            meta.previewStamp = (new Date()).getTime();   // new frames -> new cache key in the panel
            var f0 = new File(pv2.fsName + "/f000.png"), thumbF = new File(b2.fsName + "/.thumb.png");
            if (f0.exists){ if (thumbF.exists) thumbF.remove(); if (f0.copy(thumbF)) meta.hasThumb = true; }
            _writeText(mf, JSON.stringify(meta));
        } catch (e){}
        return "ok";
    }
    return "error: no frames rendered";
}
function assetsSetGifPreviewJSX(encodedBundle){
    try {
        var b = new Folder(_norm(_dec(encodedBundle)));
        var pv = new Folder(b.fsName + "/.preview");
        /* guarantee a still thumbnail (first frame) BEFORE removing the frames */
        var thumbF = new File(b.fsName + "/.thumb.png");
        var f0 = new File(pv.fsName + "/f000.png");
        if (f0.exists){ try { if (thumbF.exists) thumbF.remove(); f0.copy(thumbF); } catch (e){} }
        if (pv.exists){ var pngs = pv.getFiles("f*.png"); for (var i = 0; i < pngs.length; i++){ try { pngs[i].remove(); } catch (e){} } }
        var mf = new File(b.fsName + "/.meta.json");
        var meta = mf.exists ? JSON.parse(_readText(mf)) : { kind: "comp" };
        meta.previewFormat = "gif"; meta.hasPreview = true; meta.previewCount = 0; meta.hasThumb = thumbF.exists;
        _writeText(mf, JSON.stringify(meta));
        return "ok";
    } catch (e){ return "error: " + e.toString(); }
}
function assetsDeleteJSX(encodedPath){
    try {
        var p = _norm(_dec(encodedPath));
        var d = new Folder(p);
        if (d.exists){ assetsRmDir(d); return "ok"; }        // bundle or folder
        var f = new File(p);
        if (f.exists){ f.remove(); return "ok"; }            // stray legacy file
        return "error: not found";
    } catch (e){ return "error: " + e.toString(); }
}

/* Rename a bundle: rename folder, its primary file, and meta.name */
function assetsRenameJSX(encodedPath, newBaseName){
    try {
        var p = _norm(_dec(encodedPath));
        var d = new Folder(p);
        if (!d.exists){
            var legacy = new File(p);          // very old stray .expr.json
            if (legacy.exists){ var ext = legacy.name.indexOf('.expr.json') !== -1 ? ".expr.json" : ""; legacy.rename(newBaseName + ext); return "ok"; }
            return "error";
        }
        var parent = _norm(d.parent.fsName);
        var files = d.getFiles();
        for (var i = 0; i < files.length; i++){
            if (files[i] instanceof File){
                var nm = files[i].name;
                if (nm.indexOf('.aep') !== -1 && nm.indexOf('.') !== 0) files[i].rename(newBaseName + ".aep");
                else if (nm.indexOf('.props.json') !== -1) files[i].rename(newBaseName + ".props.json");
                else if (nm.indexOf('.expr.json') !== -1) files[i].rename(newBaseName + ".expr.json");
                else if (nm.indexOf('.') !== 0 && nm.indexOf('.meta.json') === -1){
                    var dot = nm.lastIndexOf('.'); var ex = dot !== -1 ? nm.substring(dot) : "";
                    files[i].rename(newBaseName + ex);       // media primary file
                }
            }
        }
        var mf = new File(d.fsName + "/.meta.json");
        if (mf.exists){ try { var meta = JSON.parse(_readText(mf)); meta.name = newBaseName; _writeText(mf, JSON.stringify(meta)); } catch (e){} }
        d.rename(newBaseName);
        return "ok";
    } catch (e){ return "error: " + e.toString(); }
}

function assetsMoveItemJSX(encodedPath, encodedDestFolder){
    try {
        var itemPath = _norm(_dec(encodedPath));
        var destFolderPath = _norm(_dec(encodedDestFolder));
        var destRoot = new Folder(destFolderPath);
        if (!destRoot.exists) return "error: destination folder does not exist";
        var d = new Folder(itemPath);
        if (d.exists){
            if (_norm(d.parent.fsName) === destFolderPath) return "ok";      // already there
            var target = _uniqueFolder(destFolderPath, d.name);
            _copyFolderRecursive(d, target);                                  // reliable everywhere
            if (!target.exists) return "error: copy into destination failed";
            assetsRmDir(d);
            return "ok";
        }
        var f = new File(itemPath);
        if (f.exists){ var df = new File(destFolderPath + "/" + f.name); if (f.copy(df) && df.exists){ f.remove(); return "ok"; } return "error: file copy failed"; }
        return "error: item not found";
    } catch (e){ return "error: " + e.toString(); }
}

function assetsMakeDirJSX(encodedPath, name){
    try {
        var parent = new Folder(_norm(_dec(encodedPath)));
        var target = _uniqueFolder(_norm(parent.fsName), name);
        target.create();
        return "ok";
    } catch (e){ return "error"; }
}

/* Reveal a bundle in the OS file browser */
function assetsRevealJSX(encodedPath){
    try { var f = new File(_norm(_dec(encodedPath))); if (!f.exists) f = new Folder(_norm(_dec(encodedPath))); f.parent.execute(); return "ok"; }
    catch (e){ return "error"; }
}

/* Purge orphaned staging folders left in the OS temp dir */
function assetsCleanTempBundlesJSX(){
    try {
        var t = new Folder(_norm(Folder.temp.fsName));
        var list = t.getFiles("ufx_bundle_*"), n = 0;
        for (var i = 0; i < list.length; i++) if (list[i] instanceof Folder){ assetsRmDir(list[i]); n++; }
        var thumbs = t.getFiles("ufx_thumb_*.png");
        for (var j = 0; j < thumbs.length; j++){ try { thumbs[j].remove(); } catch (e){} }
        return "cleaned " + n;
    } catch (e){ return "error: " + e.toString(); }
}