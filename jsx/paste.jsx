// ----------------------------------------------------------------------------
// PASTE MODULE
// ----------------------------------------------------------------------------
// This tab's own copies of getAepPath/getAeFolders (the Download and Paste tabs each keep
// a prefixed copy so neither depends on the other).
function pasteGetAepPath() {
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

function pasteGetAeFolders() {
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

function moveAeFolderItems(oldFolderName, newFolderName) {
    app.beginUndoGroup("Move AE Folder Items");
    try {
        var oldFolder = null;
        var newFolder = null;
        for(var i = 1; i <= app.project.items.length; i++) {
            if (app.project.items[i] instanceof FolderItem) {
                if (app.project.items[i].name === oldFolderName) oldFolder = app.project.items[i];
                if (app.project.items[i].name === newFolderName) newFolder = app.project.items[i];
            }
        }
        if (oldFolder != null) {
            if (newFolder == null) {
                newFolder = app.project.items.addFolder(newFolderName);
            }
            for (var j = oldFolder.numItems; j >= 1; j--) {
                oldFolder.item(j).parentFolder = newFolder;
            }
            if (oldFolder.numItems === 0) {
                oldFolder.remove();
            }
        }
        return "OK";
    } catch(e) {
        return "ERROR:Error moving AE items: " + e.toString();
    } finally {
        app.endUndoGroup();
    }
}

function relinkAssets(oldDir, newDir) {
    app.beginUndoGroup("Move and Relink Assets");
    try {
        var items = app.project.items;
        for (var i = 1; i <= items.length; i++) {
            var item = items[i];
            if (item instanceof FootageItem && item.file != null) {
                var currentPath = item.file.fsName;
                if (currentPath.indexOf(oldDir) === 0) {
                    var fileName = item.file.name;
                    var newFile = new File(newDir + "/" + fileName);
                    if (newFile.exists) {
                        item.replace(newFile);
                    }
                }
            }
        }
        return "OK";
    } catch (e) {
        return "ERROR:Error relinking: " + e.toString();
    } finally {
        app.endUndoGroup();
    }
}

function importAndPasteImage(filePathsString, matchDuration, stretchVideo, targetAeFolderName) {
    app.beginUndoGroup("Paste Clipboard Asset");
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "Please open a composition first.";

        var aeFolder = null;
        if (targetAeFolderName && targetAeFolderName !== "") {
            for(var f = 1; f <= app.project.items.length; f++) {
                if (app.project.items[f] instanceof FolderItem && app.project.items[f].name === targetAeFolderName) {
                    aeFolder = app.project.items[f]; break;
                }
            }
            if (aeFolder === null) aeFolder = app.project.items.addFolder(targetAeFolderName);
        }

        var paths = filePathsString.split("|");
        var targetLayer = null;
        var selLayers = comp.selectedLayers;
        if (selLayers.length > 0) {
            targetLayer = selLayers[0];
            for (var k = 1; k < selLayers.length; k++) {
                if (selLayers[k].index < targetLayer.index) targetLayer = selLayers[k];
            }
        }

        var tIn = 0, tOut = 0, tDur = 0;
        if (targetLayer !== null && matchDuration) {
            tIn = targetLayer.inPoint; tOut = targetLayer.outPoint; tDur = tOut - tIn;
        }

        for (var i = 0; i < paths.length; i++) {
            var io = new ImportOptions(new File(paths[i]));
            if (!io.canImportAs(ImportAsType.FOOTAGE)) continue;

            var importedFile = app.project.importFile(io);
            if (aeFolder !== null) importedFile.parentFolder = aeFolder;

            var newLayer = comp.layers.add(importedFile);

            if (targetLayer !== null) {
                if (newLayer.index !== (targetLayer.index - 1)) newLayer.moveBefore(targetLayer);

                if (matchDuration) {
                    newLayer.startTime = tIn;
                    var isStill = false;
                    if (importedFile.mainSource !== undefined && importedFile.mainSource.isStill) isStill = true;
                    else if (importedFile.duration === 0) isStill = true;

                    if (isStill) {
                        newLayer.inPoint = tIn; newLayer.outPoint = tOut;
                    } else {
                        if (stretchVideo) {
                            var sourceDur = importedFile.duration;
                            if (sourceDur > 0) {
                                var stretchPercentage = (tDur / sourceDur) * 100;
                                newLayer.stretch = stretchPercentage;
                                newLayer.inPoint = tIn; newLayer.outPoint = tOut;
                            }
                        } else {
                            newLayer.inPoint = tIn; newLayer.outPoint = tOut;
                        }
                    }
                }
            }
        }
        return "OK";
    } catch (e) {
        return "Error: " + e.toString();
    } finally {
        app.endUndoGroup();
    }
}

function getLayerSourcePaths() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return "ERROR:Please open a composition first.";
        
        var selLayers = comp.selectedLayers;
        if (selLayers.length === 0) return "ERROR:Please select at least one layer to copy.";

        var paths = [];
        for (var i = 0; i < selLayers.length; i++) {
            var layer = selLayers[i];
            if (layer.source != null && layer.source instanceof FootageItem && layer.source.file != null) {
                paths.push(layer.source.file.fsName);
            }
        }
        if (paths.length === 0) return "ERROR:The selected layers do not have physical source files. (e.g. Solids, Shapes, Text, and Pre-comps cannot be copied outside of AE).";
        return "SUCCESS:" + paths.join("|");
    } catch(e) {
        return "ERROR:" + e.toString();
    }
}
