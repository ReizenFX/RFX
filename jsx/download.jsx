// ----------------------------------------------------------------------------
// DOWNLOAD MODULE
// ----------------------------------------------------------------------------
// getAepPath() and getAeFolders() are shared with the Paste tab: see global.jsx.
// Function to handle the downloaded files in After Effects
function importDownloadedMedia(pathsStr, importToProj, aeFolder, importToComp, matchDur, stretch) {
    app.beginUndoGroup("Import & Paste Downloaded Media");
    try {
        var paths = pathsStr.split("|||");
        var importedItems = [];
        
        // 1. Import to Project Panel
        for (var i = 0; i < paths.length; i++) {
            var file = new File(paths[i]);
            if (file.exists) {
                var importedItem = app.project.importFile(new ImportOptions(file));
                importedItems.push(importedItem);
                
                // Move to Target AE Folder
                if (importToProj && aeFolder !== "") {
                    var targetFolderItem = null;
                    for (var j = 1; j <= app.project.numItems; j++) {
                        if (app.project.item(j) instanceof FolderItem && app.project.item(j).name === aeFolder) {
                            targetFolderItem = app.project.item(j);
                            break;
                        }
                    }
                    if (!targetFolderItem) {
                        targetFolderItem = app.project.items.addFolder(aeFolder);
                    }
                    importedItem.parentFolder = targetFolderItem;
                }
            }
        }

        // 2. Import into Active Comp & Handle Layers
        if (importToComp && app.project.activeItem && app.project.activeItem instanceof CompItem) {
            var comp = app.project.activeItem;
            var selectedLayers = comp.selectedLayers;
            
            var refInPoint = comp.time;
            var refDuration = -1;
            var topLayer = null;

            if (selectedLayers.length > 0) {
                // Find top-most selected layer
                topLayer = selectedLayers[0];
                for (var s = 1; s < selectedLayers.length; s++) {
                    if (selectedLayers[s].index < topLayer.index) {
                        topLayer = selectedLayers[s];
                    }
                }
                
                // CRITICAL FIX: Use inPoint instead of startTime to match the visible clip
                refInPoint = topLayer.inPoint;
                refDuration = topLayer.outPoint - topLayer.inPoint;
            }

            // Helper function to apply timeline manipulation logic cleanly
            function applyTiming(newLayer) {
                // Anchor the start of the new media to the exact visible start of the reference layer
                newLayer.startTime = refInPoint;

                // Stretch Layer to Fit Duration Logic (Takes priority)
                if (stretch && refDuration > 0) {
                    var currentDuration = newLayer.source.duration;
                    if (currentDuration > 0) { // Ensures we don't try to stretch still images
                        var stretchFactor = (refDuration / currentDuration) * 100;
                        newLayer.stretch = stretchFactor;
                        newLayer.startTime = refInPoint; // Re-anchor after stretch
                    }
                } 
                // Match Duration Logic (Only trim if not stretching)
                else if (matchDur && refDuration > 0) {
                    newLayer.inPoint = refInPoint;
                    newLayer.outPoint = refInPoint + refDuration;
                }
            }

            // If layers are selected, loop FORWARD and place exactly above the top layer to preserve order
            if (topLayer !== null) {
                for (var k = 0; k < importedItems.length; k++) {
                    var newLayer = comp.layers.add(importedItems[k]);
                    newLayer.moveBefore(topLayer);
                    applyTiming(newLayer);
                }
            } 
            // If NO layers are selected, loop BACKWARD and drop at the top to preserve order
            else {
                for (var k = importedItems.length - 1; k >= 0; k--) {
                    var newLayer = comp.layers.add(importedItems[k]);
                    applyTiming(newLayer);
                }
            }
        }
    } catch(e) {
        alert("AE Error: " + e.message);
    }
    app.endUndoGroup();
    return "OK";
}

// Function to dynamically relink assets when the local save folder is changed/renamed
function relinkDirectoryAssets(oldDir, newDir) {
    app.beginUndoGroup("Relink Moved Assets");
    try {
        // Normalize paths for OS compatibility
        var oldPathStr = oldDir.replace(/\\/g, "/").toLowerCase();
        if (oldPathStr.charAt(oldPathStr.length - 1) !== "/") oldPathStr += "/";
        
        var newPathStr = newDir.replace(/\\/g, "/");
        if (newPathStr.charAt(newPathStr.length - 1) !== "/") newPathStr += "/";

        var count = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            
            // Look for footage items that use actual files on the hard drive
            if (item instanceof FootageItem && item.mainSource instanceof FileSource && item.mainSource.file != null) {
                var currentPath = item.mainSource.file.fsName.replace(/\\/g, "/");
                
                // If the file is inside our old target folder
                if (currentPath.toLowerCase().indexOf(oldPathStr) === 0) {
                    var relativePath = currentPath.substring(oldPathStr.length);
                    var newFullPath = newPathStr + relativePath;
                    var newFile = new File(newFullPath);
                    
                    if (newFile.exists) {
                        item.replace(newFile);
                        count++;
                    }
                }
            }
        }
        app.endUndoGroup();
        return "Relinked " + count + " items.";
    } catch(e) {
        app.endUndoGroup();
        return "ERROR: " + e.message;
    }
}
