var TAG = "AutoCaption";

function exportAudioData(outputPath) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return "ERROR_NO_COMP";
    }
    
    var fps = comp.frameRate;
    var waStart = comp.workAreaStart;
    var waDuration = comp.workAreaDuration;

    for (var i = app.project.renderQueue.numItems; i >= 1; i--) {
        if (app.project.renderQueue.item(i).status == RQItemStatus.QUEUED) {
            app.project.renderQueue.item(i).remove();
        }
    }
    
    var rqItem = app.project.renderQueue.items.add(comp);
    rqItem.timeSpanStart = waStart;
    rqItem.timeSpanDuration = waDuration;

    var outMod = rqItem.outputModule(1);
    
    var templateFound = false;
    var preferredTemplates = ["WAV", "Audio Only", "AIFF", "MP3"];
    
    for (var j = 0; j < preferredTemplates.length; j++) {
        try { outMod.applyTemplate(preferredTemplates[j]); templateFound = true; break; } catch(e) {}
    }

    if (!templateFound) {
        var allTemplates = outMod.templates;
        for (var t = 0; t < allTemplates.length; t++) {
            var tName = allTemplates[t].toLowerCase();
            if (tName.indexOf("wav") !== -1 || tName.indexOf("audio") !== -1 || tName.indexOf("mp3") !== -1) {
                try { outMod.applyTemplate(allTemplates[t]); templateFound = true; break; } catch(e) {}
            }
        }
    }

    if (!templateFound) { rqItem.remove(); return "WAV_MISSING"; }

    try {
        outMod.file = new File(outputPath);
        var actualRenderedPath = outMod.file.fsName;
        app.project.renderQueue.render();
        rqItem.remove(); 
        return "SUCCESS|" + actualRenderedPath + "|" + fps + "|" + waStart;
    } catch(e) {
        if (rqItem) rqItem.remove();
        return "RENDER_FAILED_" + e.toString();
    }
}

function scaleKeyframes(layer) {
    var props = [];
    function findKeys(p) {
        if (!p) return;
        for (var i = 1; i <= p.numProperties; i++) {
            var prop = p.property(i);
            if (prop.propertyType === PropertyType.PROPERTY) {
                if (prop.canVaryOverTime && prop.numKeys > 1) props.push(prop);
            } else { try{ findKeys(prop); }catch(e){} }
        }
    }
    findKeys(layer);
    
    var inT = layer.inPoint;
    var targetDur = layer.outPoint - inT;
    
    for (var p = 0; p < props.length; p++) {
        var prop = props[p];
        var n = prop.numKeys, fT = prop.keyTime(1), lT = prop.keyTime(n);
        var origDur = lT - fT;
        if (origDur <= 0) continue;
        
        var ratio = targetDur / origDur;
        var kData = [];
        for (var k = 1; k <= n; k++) {
            kData.push({
                t: inT + ((prop.keyTime(k) - fT) * ratio),
                v: prop.keyValue(k),
                iI: prop.keyInInterpolationType(k),
                oI: prop.keyOutInterpolationType(k),
                iT: (prop.keyInInterpolationType(k) === KeyframeInterpolationType.BEZIER) ? prop.keyInTemporalEase(k) : null,
                oT: (prop.keyOutInterpolationType(k) === KeyframeInterpolationType.BEZIER) ? prop.keyOutTemporalEase(k) : null
            });
        }
        for (var k = n; k >= 1; k--) prop.removeKey(k);
        for (var k = 0; k < kData.length; k++) {
            var d = kData[k];
            var idx = prop.addKey(d.t);
            prop.setValueAtKey(idx, d.v);
            prop.setInterpolationTypeAtKey(idx, d.iI, d.oI);
            if (d.iT && d.oT) try{ prop.setTemporalEaseAtKey(idx, d.iT, d.oT); }catch(e){}
        }
    }
}

function applyPresetClean(layer, fileUri, comp) {
    if (!fileUri || fileUri === "" || fileUri === "undefined" || fileUri === "null") return;
    
    var decoded = fileUri;
    try { decoded = decodeURIComponent(fileUri); } catch(e) {}
    
    var file = new File(decoded);
    if (!file.exists) {
        file = new File(fileUri); 
        if (!file.exists) return;
    }
    
    var currentSelection = [];
    for (var x = 0; x < comp.selectedLayers.length; x++) {
        currentSelection.push(comp.selectedLayers[x]);
        comp.selectedLayers[x].selected = false;
    }
    layer.selected = true;

    if (layer instanceof TextLayer) {
        try {
            var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
            if (animators) { for (var i = animators.numProperties; i >= 1; i--) animators.property(i).remove(); }
        } catch(e) {}
    }

    var oldTime = comp.time;
    comp.time = layer.inPoint;
    try { layer.applyPreset(file); } catch(err){}
    comp.time = oldTime; 

    scaleKeyframes(layer);
    
    layer.selected = false;
    for (var y = 0; y < currentSelection.length; y++) {
        currentSelection[y].selected = true;
    }
}

function checkLayerForPresetSave() {
    var comp = app.project.activeItem;
    if (!comp || comp.selectedLayers.length !== 1 || !(comp.selectedLayers[0] instanceof TextLayer)) {
        return "ERROR_NO_LAYER";
    }
    
    var layer = comp.selectedLayers[0];
    var hasStuffToSave = false;
    
    var effects = layer.property("ADBE Effect Parade");
    if (effects && effects.numProperties > 0) hasStuffToSave = true;
    
    var textProp = layer.property("ADBE Text Properties");
    if (textProp) {
        var animators = textProp.property("ADBE Text Animators");
        if (animators && animators.numProperties > 0) hasStuffToSave = true;
    }
    
    if (!hasStuffToSave) return "ERROR_NO_PROPERTIES";
    
    return "SUCCESS";
}

function saveLayerEffectsAndAnimatorsAsPreset(fileUri) {
    var comp = app.project.activeItem;
    if (!comp || comp.selectedLayers.length !== 1 || !(comp.selectedLayers[0] instanceof TextLayer)) {
        return "ERROR_NO_LAYER";
    }
    
    var layer = comp.selectedLayers[0];
    var decoded = fileUri;
    try { decoded = decodeURIComponent(fileUri); } catch(e) {}
    
    var file = new File(decoded);
    
    try {
        // Clear out any currently selected properties so we don't save unwanted transforms
        var selProps = layer.selectedProperties;
        if (selProps && selProps.length > 0) {
            for (var i = 0; i < selProps.length; i++) {
                selProps[i].selected = false;
            }
        }
        
        var hasStuffToSave = false;
        
        // Target Effects
        var effects = layer.property("ADBE Effect Parade");
        if (effects && effects.numProperties > 0) {
            for (var j = 1; j <= effects.numProperties; j++) {
                effects.property(j).selected = true;
                hasStuffToSave = true;
            }
        }
        
        // Target Text Animators
        var textProp = layer.property("ADBE Text Properties");
        if (textProp) {
            var animators = textProp.property("ADBE Text Animators");
            if (animators && animators.numProperties > 0) {
                for (var k = 1; k <= animators.numProperties; k++) {
                    animators.property(k).selected = true;
                    hasStuffToSave = true;
                }
            }
        }
        
        if (!hasStuffToSave) {
            return "ERROR_NO_PROPERTIES";
        }

        // Write the properties natively to the user's disk
        if (typeof layer.savePreset === "function") {
            layer.savePreset(file);
            return "SUCCESS";
        } else {
            return "ERROR_UNSUPPORTED";
        }
    } catch(e) {
        return "ERROR_" + e.toString();
    }
}

function getActiveLayerStyle() {
    var comp = app.project.activeItem;
    if (!comp || comp.selectedLayers.length !== 1 || !(comp.selectedLayers[0] instanceof TextLayer)) {
        return "ERROR_NO_LAYER";
    }
    var doc = comp.selectedLayers[0].property("Source Text").value;
    var obj = {};
    
    var props = [
        "font", "fontSize", "applyFill", "fillColor", "applyStroke", "strokeColor", 
        "strokeWidth", "strokeOverFill", "tracking", "leading", "autoLeading", 
        "baselineShift", "justification", "fauxBold", "fauxItalic", "allCaps", 
        "smallCaps", "superscript", "subscript", "verticalScale", "horizontalScale", "tsume"
    ];

    for (var i = 0; i < props.length; i++) {
        var p = props[i];
        try {
            if (doc[p] !== undefined) {
                obj[p] = doc[p];
            }
        } catch(e) {} 
    }

    var str = "{";
    var keys = [];
    for (var k in obj) {
        if (obj.hasOwnProperty(k)) {
            var val = obj[k];
            if (typeof val === "string") {
                keys.push('"' + k + '":"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
            } else if (typeof val === "number" || typeof val === "boolean") {
                keys.push('"' + k + '":' + val);
            } else if (val instanceof Array) {
                keys.push('"' + k + '":[' + val[0] + ',' + val[1] + ',' + val[2] + ']');
            }
        }
    }
    str += keys.join(",") + "}";
    return str;
}

function applyStyleToLayer(layer, styleJsonStr) {
    if (!styleJsonStr || styleJsonStr === "null" || styleJsonStr === "undefined" || styleJsonStr === "") return;
    try {
        var styleObj = eval("(" + decodeURIComponent(styleJsonStr) + ")");
        var doc = layer.property("Source Text").value;
        
        var props = [
            "font", "fontSize", "applyFill", "fillColor", "applyStroke", "strokeColor", 
            "strokeWidth", "strokeOverFill", "tracking", "leading", "autoLeading", 
            "baselineShift", "justification", "fauxBold", "fauxItalic", "allCaps", 
            "smallCaps", "superscript", "subscript", "verticalScale", "horizontalScale", "tsume"
        ];

        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (styleObj[p] !== undefined) {
                try { doc[p] = styleObj[p]; } catch(e) {}
            }
        }
        
        layer.property("Source Text").setValue(doc);
    } catch(e) {}
}

function deleteAutoCaptions() {
    var comp = app.project.activeItem;
    if (!comp) return;
    app.beginUndoGroup("Delete Captions");
    for (var i = comp.numLayers; i >= 1; i--) {
        var l = comp.layer(i);
        if ((l instanceof TextLayer && l.comment === TAG) || l.comment === TAG + "_BG") l.remove();
    }
    app.endUndoGroup();
}

function deleteSpecificCaptions(indexesStr) {
    app.beginUndoGroup("Delete Selected Subtitles");
    var comp = app.project.activeItem;
    if (!comp) { app.endUndoGroup(); return; }
    
    var indexes = indexesStr.split(',');
    var toDelete = [];
    for(var i = 0; i < indexes.length; i++) {
        toDelete.push(parseInt(indexes[i]));
    }
    
    var layersToDelete = [];
    for(var j = 0; j < toDelete.length; j++) {
        var idx = toDelete[j];
        if (idx >= 1 && idx <= comp.numLayers) {
            var l = comp.layer(idx);
            if (l.comment === TAG) {
                layersToDelete.push(l);
                if (idx < comp.numLayers) {
                    var possibleBg = comp.layer(idx + 1);
                    if (possibleBg.comment === TAG + "_BG") {
                        layersToDelete.push(possibleBg);
                    }
                }
            }
        }
    }
    
    for (var k = 0; k < layersToDelete.length; k++) {
        try { layersToDelete[k].remove(); } catch(e){}
    }
    
    app.endUndoGroup();
}

function applySettingsToSelected(encPreset, encStyle, colorIdxStr) {
    var comp = app.project.activeItem;
    if (!comp || comp.selectedLayers.length === 0) return;
    
    app.beginUndoGroup("Apply Styles");
    var selection = [];
    for (var i = 0; i < comp.selectedLayers.length; i++) selection.push(comp.selectedLayers[i]);
    
    var safeColor = 0;
    if (colorIdxStr !== undefined && colorIdxStr !== "undefined" && colorIdxStr !== "null") {
        safeColor = parseInt(colorIdxStr, 10);
    }

    for (var j = 0; j < selection.length; j++) {
        if (selection[j] instanceof TextLayer) {
            applyPresetClean(selection[j], encPreset, comp);
            applyStyleToLayer(selection[j], encStyle);
            
            if (safeColor > 0) {
                selection[j].label = safeColor;
            }
        }
    }
    for (var k = 0; k < selection.length; k++) selection[k].selected = true;
    app.endUndoGroup();
}

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    var r = parseInt(hex.substring(0, 2), 16) / 255;
    var g = parseInt(hex.substring(2, 4), 16) / 255;
    var b = parseInt(hex.substring(4, 6), 16) / 255;
    return [r, g, b, 1];
}

function getPropByMatchName(parentGroup, matchName) {
    if (!parentGroup) return null;
    for (var i = 1; i <= parentGroup.numProperties; i++) {
        if (parentGroup.property(i).matchName === matchName) {
            return parentGroup.property(i);
        }
    }
    return null;
}

function buildBackgroundLayer(comp, textLayer, bgSettings, safeColor) {
    try {
        var shapeLayer = comp.layers.addShape();
        shapeLayer.name = textLayer.name + " BG";
        shapeLayer.comment = TAG + "_BG";
        
        shapeLayer.moveAfter(textLayer);
        shapeLayer.parent = textLayer; 
        
        shapeLayer.inPoint = textLayer.inPoint;
        shapeLayer.outPoint = textLayer.outPoint;
        
        var boxLabelColor = safeColor; 
        if (bgSettings && bgSettings.labelColor !== undefined) {
            var explicitColor = parseInt(bgSettings.labelColor, 10);
            if (!isNaN(explicitColor)) {
                boxLabelColor = explicitColor;
            }
        }
        if (boxLabelColor > 0 && boxLabelColor <= 16) {
            shapeLayer.label = boxLabelColor;
        } else if (boxLabelColor === 0) {
            shapeLayer.label = 0; 
        }

        try { shapeLayer.property("ADBE Transform Group").property("ADBE Position").setValue([0,0,0]); } catch(e) {}
        try { shapeLayer.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0,0,0]); } catch(e) {}

        var shapeContents = shapeLayer.property("ADBE Root Vectors Group");
        var rectGroup = shapeContents.addProperty("ADBE Vector Group");
        var vectorsGroup = rectGroup.property("ADBE Vectors Group");
        
        var rectPath = vectorsGroup.addProperty("ADBE Vector Shape - Rect");
        var fill = vectorsGroup.addProperty("ADBE Vector Graphic - Fill");

        if (bgSettings.presetPath && bgSettings.presetPath !== "") {
            try { applyPresetClean(shapeLayer, bgSettings.presetPath, comp); } catch(e){}
        }

        var finalRectGroup = getPropByMatchName(shapeContents, "ADBE Vector Group") || rectGroup;
        var finalVectors = getPropByMatchName(finalRectGroup, "ADBE Vectors Group") || vectorsGroup;
        var finalRectPath = getPropByMatchName(finalVectors, "ADBE Vector Shape - Rect") || rectPath;
        var finalFill = getPropByMatchName(finalVectors, "ADBE Vector Graphic - Fill") || fill;

        try { finalFill.property("ADBE Vector Fill Color").setValue(hexToRgb(bgSettings.color)); } catch(e){}
        try { shapeLayer.property("ADBE Transform Group").property("ADBE Opacity").setValue(parseFloat(bgSettings.opacity)); } catch(e){}

        var userPadX = parseFloat(bgSettings.padX); if (isNaN(userPadX)) userPadX = 0;
        var userPadY = parseFloat(bgSettings.padY); if (isNaN(userPadY)) userPadY = 0;
        var roundness = parseFloat(bgSettings.roundness); if (isNaN(roundness)) roundness = 20;

        var sizeExpr = "var uX = " + userPadX + ";\r" +
                       "var uY = " + userPadY + ";\r" +
                       "var basePadX = 100;\r" +
                       "var basePadY = 80;\r" +
                       "var ref = null;\r" +
                       "try { ref = thisLayer.parent; } catch(e) {}\r" +
                       "if (!ref) { ref = thisComp.layer(index - 1); }\r" +
                       "var s = ref.sourceRectAtTime(time, false);\r" +
                       "var fSize = 100;\r" +
                       "try { fSize = ref.text.sourceText.style.fontSize; } catch(e) {}\r" +
                       "var mult = fSize / 100;\r" +
                       "var pX = (basePadX + uX) * mult;\r" +
                       "var pY = (basePadY + uY) * mult;\r" +
                       "[Math.max(s.width + pX, 0.1), Math.max(s.height + pY, 0.1)];";

        var posExpr = "var ref = null;\r" +
                      "try { ref = thisLayer.parent; } catch(e) {}\r" +
                      "if (!ref) { ref = thisComp.layer(index - 1); }\r" +
                      "var s = ref.sourceRectAtTime(time, false);\r" +
                      "[s.left + (s.width / 2), s.top + (s.height / 2)];";

        try { finalRectPath.property("ADBE Vector Rect Size").expression = sizeExpr; } catch(e) {}
        try { finalRectPath.property("ADBE Vector Rect Position").expression = posExpr; } catch(e) {}
        try { finalRectPath.property("ADBE Vector Rect Roundness").setValue(roundness); } catch(e){}

        if (bgSettings.isAdj === true || String(bgSettings.isAdj) === "true") { 
            try { shapeLayer.adjustmentLayer = true; } catch(e){}
        }
    } catch(fatalError) {}
}

function applyBackgroundToSelectedLayers(encBgSettingsStr) {
    app.beginUndoGroup("Apply Background");
    var comp = app.project.activeItem;
    if (!comp || comp.selectedLayers.length === 0) { app.endUndoGroup(); return; }

    var bgSettings = null;
    try { bgSettings = eval("(" + decodeURIComponent(encBgSettingsStr) + ")"); } catch(e){ app.endUndoGroup(); return; }

    var selLayers = [];
    for (var i = 0; i < comp.selectedLayers.length; i++) selLayers.push(comp.selectedLayers[i]);

    for (var j = 0; j < selLayers.length; j++) {
        var l = selLayers[j];
        if (l instanceof TextLayer) {
            if (l.index < comp.numLayers) {
                var possibleBg = comp.layer(l.index + 1);
                if (possibleBg.comment === TAG + "_BG") possibleBg.remove(); 
            }
            buildBackgroundLayer(comp, l, bgSettings, l.label);
        }
    }
    app.endUndoGroup();
}

function generateCaptionsFromProcessedJSON(encodedJsonString, encPreset, encStyle, colorIdxStr, encBgSettingsStr) {
    app.beginUndoGroup("AutoCaptions Generation");
    var comp = app.project.activeItem;
    if (!comp) {
        app.endUndoGroup();
        return;
    }

    var bgSettings = null;
    if (encBgSettingsStr && encBgSettingsStr !== "undefined") {
        try { bgSettings = eval("(" + decodeURIComponent(encBgSettingsStr) + ")"); } catch(e){}
    }

    try {
        var decodedString = decodeURIComponent(encodedJsonString);
        var chunks = eval("(" + decodedString + ")"); 
        
        var safeColor = 0;
        if (colorIdxStr !== undefined && colorIdxStr !== "undefined" && colorIdxStr !== "null") {
            safeColor = parseInt(colorIdxStr, 10);
        }

        var centerX = Math.floor(comp.width / 2);
        var centerY = Math.floor(comp.height / 2);

        for (var i = 0; i < chunks.length; i++) {
            try {
                var c = chunks[i];
                if (c.text && c.text.length > 0) {
                    var txtLayer = comp.layers.addText(c.text);
                    txtLayer.startTime = c.start; 
                    txtLayer.inPoint = c.start;
                    txtLayer.outPoint = c.end;
                    txtLayer.comment = TAG; 
                    
                    if (safeColor > 0) txtLayer.label = safeColor;

                    var textProp = txtLayer.property("Source Text");
                    var textDoc = textProp.value;
                    textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
                    textProp.setValue(textDoc);

                    var posProp = txtLayer.property("ADBE Transform Group").property("ADBE Position");
                    if (posProp !== null) {
                        posProp.setValue([centerX, centerY]);
                    }

                    applyPresetClean(txtLayer, encPreset, comp);
                    applyStyleToLayer(txtLayer, encStyle);

                    if (bgSettings && bgSettings.enable) {
                        buildBackgroundLayer(comp, txtLayer, bgSettings, safeColor);
                    }
                }
            } catch(loopError) {}
        }
    } catch (err) {}
    app.endUndoGroup();
}

function pad(n, width) {
    width = width || 2;
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join('0') + n;
}

function formatTimeSRT(seconds) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    var ms = Math.floor((seconds % 1) * 1000);
    return pad(h) + ":" + pad(m) + ":" + pad(s) + "," + pad(ms, 3);
}

function parseTime(tStr) {
    var t = tStr.split(":");
    if (t.length < 3) return 0;
    var sec = parseFloat(t[2].replace(",","."));
    return parseInt(t[0], 10) * 3600 + parseInt(t[1], 10) * 60 + sec;
}

function updateAllCaptionLayers(encodedPayload) {
    app.beginUndoGroup("Update Captions");
    var comp = app.project.activeItem;
    if (comp) {
        var data = eval("(" + decodeURIComponent(encodedPayload) + ")");
        for (var i = 0; i < data.length; i++) {
            var d = data[i];
            var l = comp.layer(d.index);
            if (l && l instanceof TextLayer) {
                var currentText = "";
                try { currentText = l.property("Source Text").value.text; } catch(e){}
                var currentIn = formatTimeSRT(l.inPoint);
                var currentOut = formatTimeSRT(l.outPoint);
                
                if (currentText !== d.text || currentIn !== d.inTime || currentOut !== d.outTime) {
                    var doc = l.property("Source Text").value;
                    doc.text = d.text;
                    l.property("Source Text").setValue(doc);
                    l.inPoint = parseTime(d.inTime);
                    l.outPoint = parseTime(d.outTime);
                    scaleKeyframes(l);

                    if (l.index < comp.numLayers) {
                        var possibleBg = comp.layer(l.index + 1);
                        if (possibleBg.comment === TAG + "_BG") {
                            possibleBg.inPoint = l.inPoint;
                            possibleBg.outPoint = l.outPoint;
                            scaleKeyframes(possibleBg);
                        }
                    }
                }
            }
        }
    }
    app.endUndoGroup();
    return "SUCCESS";
}

function getTimelineCaptions() {
    var comp = app.project.activeItem;
    if (!comp) return "[]";
    var caps = [];
    
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (l instanceof TextLayer && l.comment === TAG) {
            
            var safeText = l.name; 
            try {
                safeText = l.property("Source Text").value.text;
            } catch(e) {} 

            caps.push({
                index: i,
                text: safeText,
                inTimeStr: formatTimeSRT(l.inPoint),
                outTimeStr: formatTimeSRT(l.outPoint)
            });
        }
    }
    caps.sort(function(a, b) { return parseTime(a.inTimeStr) - parseTime(b.inTimeStr); });
    
    var jsonStr = "[";
    for (var j = 0; j < caps.length; j++) {
        var c = caps[j];
        var safeEncText = c.text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        jsonStr += '{"index":' + c.index + ',"text":"' + safeEncText + '","inTimeStr":"' + c.inTimeStr + '","outTimeStr":"' + c.outTimeStr + '"}';
        if (j < caps.length - 1) jsonStr += ",";
    }
    jsonStr += "]";
    return encodeURIComponent(jsonStr);
}

function splitCaptionLayerAtPlayhead() {
    app.beginUndoGroup("Split Subtitle");
    var comp = app.project.activeItem;
    if (!comp) { app.endUndoGroup(); return "ERROR_NO_COMP"; }
    
    var playhead = comp.time;
    var targetLayer = null;

    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (l instanceof TextLayer && l.comment === TAG) {
            if (playhead > l.inPoint && playhead < l.outPoint) {
                targetLayer = l; break;
            }
        }
    }
    if (!targetLayer) { app.endUndoGroup(); return "ERROR_NO_LAYER_UNDER_PLAYHEAD"; }

    var targetBgLayer = null;
    if (targetLayer.index < comp.numLayers) {
        var possibleBg = comp.layer(targetLayer.index + 1);
        if (possibleBg.comment === TAG + "_BG") { targetBgLayer = possibleBg; }
    }

    var newLayer = targetLayer.duplicate();
    newLayer.comment = TAG;
    
    var newBgLayer = null;
    if (targetBgLayer) {
        newBgLayer = targetBgLayer.duplicate();
        newBgLayer.comment = TAG + "_BG";
    }

    // AE duplicate() puts the new layer ABOVE the target layer.
    // NATIVE BEHAVIOR: Top layer = Right part (after playhead). Bottom layer = Left part (before playhead).
    
    // Make the new upper layer the RIGHT part
    var origNewOut = newLayer.outPoint;
    newLayer.inPoint = playhead;
    newLayer.outPoint = origNewOut;
    
    // Make the original lower layer the LEFT part
    targetLayer.outPoint = playhead;

    if (newBgLayer) {
        var origNewBgOut = newBgLayer.outPoint;
        newBgLayer.inPoint = playhead;
        newBgLayer.outPoint = origNewBgOut;
        
        targetBgLayer.outPoint = playhead;
        
        // Stack Order should be: Right Text -> Right BG -> Left Text -> Left BG
        // newLayer is currently at top.
        // Move newBgLayer directly under newLayer.
        newBgLayer.moveAfter(newLayer);
        
        // Set correct parent for the new Background
        newBgLayer.parent = newLayer;
    }

    try { scaleKeyframes(newLayer); } catch(e){}
    try { scaleKeyframes(targetLayer); } catch(e){}
    if (newBgLayer) {
        try { scaleKeyframes(newBgLayer); } catch(e){}
        try { scaleKeyframes(targetBgLayer); } catch(e){}
    }

    for(var j=0; j<comp.selectedLayers.length; j++) comp.selectedLayers[j].selected = false;
    app.endUndoGroup();
    return "SUCCESS";
}

function getTimelineState() {
    var comp = app.project.activeItem;
    if (!comp) return "-1|0|0_0_none";
    
    var time = comp.time;
    var bestIndex = -1;
    var layerCount = 0;
    var stateHash = 0;
    var selectedStr = "";
    
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (l instanceof TextLayer && l.comment === TAG) {
            layerCount++;
            
            if (bestIndex === -1 && time >= l.inPoint && time < l.outPoint) {
                bestIndex = i;
            }
            
            stateHash += (l.inPoint * 100) + (l.outPoint * 100); 
            
            if (l.selected) {
                selectedStr += i + "_";
            }
        }
    }
    
    if (selectedStr === "") selectedStr = "none";
    
    return bestIndex.toString() + "|" + comp.id.toString() + "|" + layerCount + "_" + stateHash.toFixed(0) + "_" + selectedStr;
}