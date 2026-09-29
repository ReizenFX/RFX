// ============================================================================
// SHARED EXTENDSCRIPT (manifest <ScriptPath>)
// Helpers used by more than one tab, then a loader that evaluates each tab's
// backend from this jsx/ folder. Mirrors js/globals.js.
// assets.jsx and caption.jsx are not loaded here: js/tab-assets.js and
// js/tab-caption.js load them on demand.
// ============================================================================

// ----------------------------------------------------------------------------
// SHARED: PASTE + DOWNLOAD
// ----------------------------------------------------------------------------
function getAepPath() {
    try {
        if (app.project !== null && app.project.file !== null) {
            return app.project.file.parent.fsName;
        } else {
            return "UNSAVED";
        }
    } catch(e) {
        return "UNSAVED";
    }
}

function getAeFolders() {
    try {
        var folders = [];
        for(var i = 1; i <= app.project.items.length; i++) {
            if (app.project.items[i] instanceof FolderItem && app.project.items[i].name !== "Solids") {
                folders.push(app.project.items[i].name);
            }
        }
        return folders.join(":::");
    } catch(e) {
        return "";
    }
}

// ----------------------------------------------------------------------------
// TAB BACKEND LOADER
// ----------------------------------------------------------------------------
(function () {
    var tabFiles = ["transform.jsx", "fx.jsx", "color.jsx", "graph.jsx", "paste.jsx", "render.jsx", "tracker.jsx", "discord.jsx", "download.jsx"];
    // $.fileName is this file. Siblings are resolved through absoluteURI so spaces
    // (and other special characters) in the install path stay safely encoded.
    var jsxFolder = new File($.fileName).parent;
    for (var i = 0; i < tabFiles.length; i++) {
        try {
            $.evalFile(new File(jsxFolder.absoluteURI + "/" + tabFiles[i]));
        } catch (e) {
            $.writeln("global.jsx: failed to load " + tabFiles[i] + ": " + e.toString());
        }
    }
})();
