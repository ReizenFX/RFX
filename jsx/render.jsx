// ----------------------------------------------------------------------------
// RENDER MODULE
// ----------------------------------------------------------------------------
function saveRenderPreset(presetName) {
    try {
        if (app.project === null) return "ERROR:No project open.";
        if (app.project.renderQueue.numItems === 0) return "ERROR:Render Queue is empty. Please add an item first.";
        
        var targetIndex = app.project.renderQueue.numItems;
        var rqItem = app.project.renderQueue.item(targetIndex);
        
        if (rqItem.numOutputModules === 0) return "ERROR:The selected Render Queue item has no Output Module.";
        var myOM = rqItem.outputModule(1);
        
        var ext = ".mp4"; 
        var fn = "";
        try { fn = myOM.name.toLowerCase(); } catch(err) { fn = "mp4"; }
        
        if (fn.indexOf("h.264") !== -1 || fn.indexOf("mp4") !== -1) ext = ".mp4";
        else if (fn.indexOf("quicktime") !== -1 || fn.indexOf("mov") !== -1) ext = ".mov";
        else if (fn.indexOf("avi") !== -1) ext = ".avi";
        else if (fn.indexOf("png") !== -1) ext = "_[#####].png";
        else if (fn.indexOf("jpeg") !== -1 || fn.indexOf("jpg") !== -1) ext = "_[#####].jpg";
        else if (fn.indexOf("tiff") !== -1 || fn.indexOf("tif") !== -1) ext = "_[#####].tif";
        else if (fn.indexOf("wav") !== -1) ext = ".wav";
        else if (fn.indexOf("mp3") !== -1) ext = ".mp3";

        var rsName = "ZLP_RS_" + presetName;
        var omName = "ZLP_OM_" + presetName;
        
        rqItem.saveAsTemplate(rsName);
        myOM.saveAsTemplate(omName);
        
        return "SUCCESS:::&&:::" + ext;
    } catch(e) {
        return "ERROR: Could not save template. " + e.message;
    }
}

function applyRenderPreset(templateStr, targetFolder, fileExt, customFileName) {
    try {
        if (app.project === null) return "ERROR:No project open.";
        
        var compToRender = null;
        var activeItem = app.project.activeItem;
        
        if (activeItem != null && activeItem instanceof CompItem) {
            compToRender = activeItem;
        } else if (app.project.selection.length > 0 && app.project.selection[0] instanceof CompItem) {
            compToRender = app.project.selection[0];
        } else {
            return "ERROR:Please select a Composition in the Project panel first.";
        }
        
        app.beginUndoGroup("Apply ZLP Render Preset");
        var rqItem = app.project.renderQueue.items.add(compToRender);
        var myOM = rqItem.outputModule(1);
        
        var rsName = "ZLP_RS_" + templateStr;
        var omName = "ZLP_OM_" + templateStr;
        
        rqItem.applyTemplate(rsName);
        myOM.applyTemplate(omName);
        
        var destFolder;
        if (targetFolder && targetFolder !== "") {
            destFolder = new Folder(targetFolder);
            if (!destFolder.exists) destFolder.create();
        } else {
            if (app.project.file != null) {
                destFolder = new Folder(app.project.file.parent.absoluteURI + "/Export");
                if (!destFolder.exists) destFolder.create();
            } else {
                destFolder = new Folder("~/Downloads");
                if (!destFolder.exists) destFolder.create();
            }
        }
        
        var safeCompName = "";
        if (customFileName && customFileName !== "undefined" && customFileName !== "") {
            safeCompName = customFileName.replace(/[\/\\:\*\?"<>\|]/g, '_'); 
        } else {
            safeCompName = compToRender.name.replace(/[\/\\:\*\?"<>\|]/g, '_'); 
        }
        
        var finalExt = (fileExt && fileExt !== "undefined" && fileExt !== "") ? fileExt : ".mp4";
        var baseName = safeCompName;
        var counter = 1;
        var finalPath = destFolder.absoluteURI + "/" + baseName + finalExt;
        var testFile = new File(finalPath);
        
        while (testFile.exists) {
            baseName = safeCompName + " (" + counter + ")";
            finalPath = destFolder.absoluteURI + "/" + baseName + finalExt;
            testFile = new File(finalPath);
            counter++;
        }
        
        myOM.file = new File(finalPath);
        rqItem.render = true; 
        
        app.endUndoGroup();
        return "SUCCESS";
        
    } catch(e) {
        if (app.project) app.endUndoGroup();
        return "ERROR:Failed to apply preset. " + e.message;
    }
}

function prepareQueue(batchStr, targetFolder, customFileName, includeNativeStr) {
    try {
        if (app.project === null) return "ERROR:No project open.";

        var includeNative = (includeNativeStr === "true");

        if (!includeNative) {
            for (var n = 1; n <= app.project.renderQueue.numItems; n++) {
                var rqn = app.project.renderQueue.item(n);
                if (rqn.status === RQItemStatus.QUEUED || rqn.status === RQItemStatus.WILL_CONTINUE) {
                    rqn.render = false;
                }
            }
        }

        if (batchStr && batchStr !== "undefined" && batchStr !== "") {
            var compToRender = null;
            var activeItem = app.project.activeItem;
            
            if (activeItem != null && activeItem instanceof CompItem) compToRender = activeItem;
            else if (app.project.selection.length > 0 && app.project.selection[0] instanceof CompItem) compToRender = app.project.selection[0];
            else return "ERROR:Please select a Composition first to render checked presets.";

            var destFolder;
            if (targetFolder && targetFolder !== "") {
                destFolder = new Folder(targetFolder);
                if (!destFolder.exists) destFolder.create();
            } else {
                if (app.project.file != null) {
                    destFolder = new Folder(app.project.file.parent.absoluteURI + "/Export");
                    if (!destFolder.exists) destFolder.create();
                } else {
                    destFolder = new Folder("~/Downloads");
                    if (!destFolder.exists) destFolder.create();
                }
            }

            var safeCompName = (customFileName && customFileName !== "undefined" && customFileName !== "") 
                ? customFileName.replace(/[\/\\:\*\?"<>\|]/g, '_') 
                : compToRender.name.replace(/[\/\\:\*\?"<>\|]/g, '_'); 

            var presetPairs = batchStr.split("|||");
            app.beginUndoGroup("Batch Apply Presets");

            for (var i = 0; i < presetPairs.length; i++) {
                var parts = presetPairs[i].split(":::&&:::");
                if (parts.length < 2) continue;
                
                var templateStr = parts[0];
                var fileExt = parts[1];
                
                var rqItem = app.project.renderQueue.items.add(compToRender);
                var myOM = rqItem.outputModule(1);
                
                rqItem.applyTemplate("ZLP_RS_" + templateStr);
                myOM.applyTemplate("ZLP_OM_" + templateStr);
                
                var finalExt = (fileExt && fileExt !== "undefined" && fileExt !== "") ? fileExt : ".mp4";
                var baseName = safeCompName;
                var counter = 1;
                var finalPath = destFolder.absoluteURI + "/" + baseName + finalExt;
                var testFile = new File(finalPath);
                
                while (testFile.exists) {
                    baseName = safeCompName + " (" + counter + ")";
                    finalPath = destFolder.absoluteURI + "/" + baseName + finalExt;
                    testFile = new File(finalPath);
                    counter++;
                }
                
                myOM.file = new File(finalPath);
                rqItem.render = true; 
            }
            app.endUndoGroup();
        }

        var queuedItems = [];
        for (var j = 1; j <= app.project.renderQueue.numItems; j++) {
            var item = app.project.renderQueue.item(j);
            if (item.render === true) {
                var displayName = "Item " + j;
                if (item.numOutputModules > 0 && item.outputModule(1).file != null) {
                    displayName = item.outputModule(1).file.name;
                } else if (item.comp) {
                    displayName = item.comp.name;
                }
                queuedItems.push(j + ":::" + displayName);
            }
        }

        if (queuedItems.length === 0) return "ERROR:No items are checked in the Render Queue.";

        return "QUEUE_LIST:::&&:::" + queuedItems.join("|||");

    } catch(e) {
        if (app.project) app.endUndoGroup();
        return "ERROR:Queue preparation failed. " + e.message;
    }
}

function executeSpecificRender(indicesStr, doImport) {
    try {
        if (app.project === null) return "ERROR:No project open.";

        var indicesToRender = indicesStr.split(",");
        var validIndices = {};
        for (var a = 0; a < indicesToRender.length; a++) {
            validIndices[indicesToRender[a]] = true;
        }

        var outputFiles = [];
        var targetCompId = "-1";

        for (var i = 1; i <= app.project.renderQueue.numItems; i++) {
            var item = app.project.renderQueue.item(i);
            if (item.render === true) {
                if (!validIndices[i.toString()]) {
                    if (item.status === RQItemStatus.QUEUED || item.status === RQItemStatus.WILL_CONTINUE) {
                        item.render = false;
                    }
                } else {
                    if (item.numOutputModules > 0 && item.outputModule(1).file != null) {
                        outputFiles.push(item.outputModule(1).file.absoluteURI);
                    }
                    if (targetCompId === "-1" && item.comp) {
                        targetCompId = item.comp.id.toString(); 
                    }
                }
            }
        }

        if (app.project.activeItem != null && app.project.activeItem instanceof CompItem) {
            targetCompId = app.project.activeItem.id.toString();
        }

        app.project.renderQueue.render();

        if (targetCompId !== "-1") {
            for (var m = 1; m <= app.project.numItems; m++) {
                if (app.project.item(m).id.toString() === targetCompId) {
                    app.project.item(m).openInViewer();
                    break;
                }
            }
        }

        if (doImport && outputFiles.length > 0) {
            return "IMPORT_PENDING:::&&:::" + targetCompId + ":::&&:::" + outputFiles.join("|||");
        }

        return "SUCCESS";

    } catch(e) {
        return "ERROR:Render failed. " + e.message;
    }
}

function processImport(compId, filePathsString) {
    var undoOpen = false;
    try {
        if (app.project === null) return "ERROR:Project closed.";
        
        var files = filePathsString.split("|||");
        var targetComp = null;
        
        if (compId !== "-1") {
            for (var i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i).id.toString() === compId) {
                    targetComp = app.project.item(i);
                    break;
                }
            }
        }
        
        app.beginUndoGroup("Import Rendered Files");
        undoOpen = true;
        
        for (var k = 0; k < files.length; k++) {
            var fileToImport = new File(files[k]);
            if (fileToImport.exists) {
                var importOptions = new ImportOptions(fileToImport);
                var importedItem = app.project.importFile(importOptions);
                if (targetComp != null) { targetComp.layers.add(importedItem); }
            }
        }
        
        app.endUndoGroup();
        undoOpen = false;
        return "SUCCESS";
        
    } catch(e) {
        if (undoOpen) app.endUndoGroup();
        return "ERROR:Import failed. " + e.message;
    }
}

function getProjectData() {
    try {
        if (app.project !== null && app.project.file !== null) {
            var safePath = app.project.file.fsName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return '{"isSaved": true, "projectPath": "' + safePath + '"}';
        } else {
            return '{"isSaved": false}';
        }
    } catch(err) {
        return '{"error": "' + err.toString() + '"}';
    }
}
