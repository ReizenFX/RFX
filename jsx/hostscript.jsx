// ============================================================================
// ULTIMATE FX SUITE - MONOLITHIC BACKEND ENGINE
// Contains: Transform, FX, Color, Graph, and Assets logic.
// ============================================================================

// ----------------------------------------------------------------------------
// TRANSFORM MODULE
// ----------------------------------------------------------------------------
function getP(l, t) { var pos = l.transform.position; if (pos.dimensionsSeparated) { return [ l.transform.xPosition.valueAtTime(t, false), l.transform.yPosition.valueAtTime(t, false), pos.value.length === 3 ? l.transform.zPosition.valueAtTime(t, false) : 0 ]; } return pos.valueAtTime(t, false); }
function setK(prop, val, t) { if (prop.numKeys > 0) prop.setValueAtTime(t, val); else prop.setValue(val); }
function setP(l, nx, ny, nz, t) { var pos = l.transform.position; if (pos.dimensionsSeparated) { setK(l.transform.xPosition, nx, t); setK(l.transform.yPosition, ny, t); if (pos.value.length === 3 && nz !== undefined) setK(l.transform.zPosition, nz, t); } else { var p = pos.valueAtTime(t, false); var val = (p.length === 3) ? [nx, ny, nz !== undefined ? nz : p[2]] : [nx, ny]; setK(pos, val, t); } }

function selectSameProperties() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return alert("Please select a composition.");
    var selProps = comp.selectedProperties; if (selProps.length === 0) return alert("Please select at least one property first.");
    var namesToMatch = {}; for (var i = 0; i < selProps.length; i++) { namesToMatch[selProps[i].matchName] = true; namesToMatch[selProps[i].name] = true; }
    app.beginUndoGroup("Select Same Properties");
    var targetLayers = comp.selectedLayers; if (targetLayers.length <= 1) { targetLayers = []; for (var j = 1; j <= comp.numLayers; j++) targetLayers.push(comp.layer(j)); }
    function traverseAndSelect(propParent) {
        if (!propParent || typeof propParent.numProperties === 'undefined') return;
        for (var p = 1; p <= propParent.numProperties; p++) { var prop = propParent.property(p); if (namesToMatch[prop.matchName] || namesToMatch[prop.name]) { try { prop.selected = true; } catch(e){} } if (prop.propertyType === PropertyType.INDEXED_GROUP || prop.propertyType === PropertyType.NAMED_GROUP) traverseAndSelect(prop); }
    }
    for (var k = 0; k < targetLayers.length; k++) traverseAndSelect(targetLayers[k]);
    app.endUndoGroup();
}

function selectLayerType(type) {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return alert("Please select a composition.");
    app.beginUndoGroup("Select Layer Type");
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i), match = false;
        if (type === "text" && l instanceof TextLayer) match = true; if (type === "shape" && l instanceof ShapeLayer) match = true; if (type === "camera" && l instanceof CameraLayer) match = true; if (type === "null" && l.nullLayer) match = true; if (type === "solid" && l.source && l.source.mainSource && l.source.mainSource instanceof SolidSource) match = true;
        l.selected = match;
    }
    app.endUndoGroup();
}

function createNullAndParent() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return alert("Please select a composition.");
    var selLayers = comp.selectedLayers; if (selLayers.length === 0) return alert("Select layers to parent.");
    app.beginUndoGroup("Auto Hierarchy");
    var layersToParent = [], topmostIndex = comp.numLayers + 1;
    for (var i = 0; i < selLayers.length; i++) { layersToParent.push(selLayers[i]); if (selLayers[i].index < topmostIndex) topmostIndex = selLayers[i].index; }
    var nullLayer = comp.layers.addNull(comp.duration); nullLayer.name = "Master Null";
    var targetLayer = comp.layer(topmostIndex + 1); if (targetLayer) nullLayer.moveBefore(targetLayer);
    for (var j = 0; j < layersToParent.length; j++) layersToParent[j].parent = nullLayer;
    app.endUndoGroup();
}

function moveAnchorPoint(pos) {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length === 0) return;
    app.beginUndoGroup("Move Anchor Point"); var t = comp.time;
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i]; if (!l.transform.anchorPoint) continue;
        var rect = l.sourceRectAtTime(t, false), x = rect.left, y = rect.top, w = rect.width, h = rect.height, targetX = 0, targetY = 0;
        if (pos.indexOf("l") !== -1) targetX = x; else if (pos.indexOf("c") !== -1 && pos !== "tc" && pos !== "bc") targetX = x + (w / 2); else if (pos.indexOf("r") !== -1) targetX = x + w;
        if (pos === "tc" || pos === "bc") targetX = x + (w/2);
        if (pos.indexOf("t") !== -1) targetY = y; else if (pos.indexOf("m") !== -1) targetY = y + (h / 2); else if (pos.indexOf("b") !== -1) targetY = y + h;
        var curAnchor = l.transform.anchorPoint.valueAtTime(t, false), diffX = targetX - curAnchor[0], diffY = targetY - curAnchor[1];
        setK(l.transform.anchorPoint, [targetX, targetY], t);
        var curPos = getP(l, t), scale = l.transform.scale.valueAtTime(t, false), adjX = diffX * (scale[0] / 100), adjY = diffY * (scale[1] / 100);
        setP(l, curPos[0] + adjX, curPos[1] + adjY, curPos[2], t);
    }
    app.endUndoGroup();
}

function flipSelectedLayers() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length < 2) return alert("Select at least 2 layers to flip.");
    app.beginUndoGroup("Flip Layers"); var layerData = [], t = comp.time;
    for (var i = 0; i < layers.length; i++) layerData.push({ layer: layers[i], oldIndex: layers[i].index, pos: getP(layers[i], t) });
    layerData.sort(function(a, b) { return a.oldIndex - b.oldIndex; });
    var targetIndexes = []; for (var j = 0; j < layerData.length; j++) targetIndexes.push(layerData[j].oldIndex); targetIndexes.reverse();
    for (var k = 0; k < layerData.length; k++) layerData[k].layer.moveBefore(comp.layer(targetIndexes[k]));
    app.endUndoGroup();
}

function sequenceLayers(direction, frames) {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length < 2) return;
    var offsetSec = frames / comp.frameRate; app.beginUndoGroup("Sequence Layers");
    if (direction === "forward") { for (var i = 1; i < layers.length; i++) { var targetIn = layers[i-1].inPoint + offsetSec; layers[i].startTime = layers[i].startTime + (targetIn - layers[i].inPoint); } } 
    else if (direction === "backward") { for (var j = 1; j < layers.length; j++) { var targetInB = layers[j-1].inPoint - offsetSec; layers[j].startTime = layers[j].startTime + (targetInB - layers[j].inPoint); } } 
    else if (direction === "random") {
        var minIn = layers[0].inPoint, maxIn = layers[0].inPoint;
        for (var m = 1; m < layers.length; m++) { if (layers[m].inPoint < minIn) minIn = layers[m].inPoint; if (layers[m].inPoint > maxIn) maxIn = layers[m].inPoint; }
        var centerIn = (minIn + maxIn) / 2, maxOffset = offsetSec * (layers.length > 1 ? layers.length - 1 : 1);
        for (var n = 0; n < layers.length; n++) { var targetInR = centerIn - (maxOffset / 2) + (Math.random() * maxOffset); layers[n].startTime = layers[n].startTime + (targetInR - layers[n].inPoint); }
    }
    app.endUndoGroup();
}

function reverseSequence() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length < 2) return;
    app.beginUndoGroup("Reverse Sequence");
    var sorted = layers.slice().sort(function(a, b) { return a.inPoint - b.inPoint; }), times = [];
    for (var i = 0; i < sorted.length; i++) times.push(sorted[i].inPoint);
    for (var j = 0; j < sorted.length; j++) { var targetIn = times[times.length - 1 - j]; sorted[j].startTime = sorted[j].startTime + (targetIn - sorted[j].inPoint); }
    app.endUndoGroup();
}

function moveGroupStartToPlayhead() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length === 0) return;
    app.beginUndoGroup("Move Group Start to Playhead");
    var earliestIn = layers[0].inPoint; for (var i = 1; i < layers.length; i++) if (layers[i].inPoint < earliestIn) earliestIn = layers[i].inPoint;
    var delta = comp.time - earliestIn; for (var j = 0; j < layers.length; j++) layers[j].startTime = layers[j].startTime + delta;
    app.endUndoGroup();
}

function moveGroupEndToPlayhead() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length === 0) return;
    app.beginUndoGroup("Move Group End to Playhead");
    var latestOut = layers[0].outPoint; for (var i = 1; i < layers.length; i++) if (layers[i].outPoint > latestOut) latestOut = layers[i].outPoint;
    var delta = comp.time - latestOut; for (var j = 0; j < layers.length; j++) layers[j].startTime = layers[j].startTime + delta;
    app.endUndoGroup();
}

function alignLayers(type, relativeTo) {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length === 0) return;
    app.beginUndoGroup("Align Layers"); var t = comp.time, cw = comp.width, ch = comp.height, refLeft = 0, refTop = 0, refRight = cw, refBottom = ch, refCX = cw/2, refCY = ch/2;
    if (relativeTo === "selection" && layers.length > 1) {
        var minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        for (var i = 0; i < layers.length; i++) {
            try { var r = layers[i].sourceRectAtTime(t, false), pos = getP(layers[i], t), anc = layers[i].transform.anchorPoint.valueAtTime(t, false), lx = pos[0] - anc[0] + r.left, ty = pos[1] - anc[1] + r.top; if (lx < minL) minL = lx; if (ty < minT) minT = ty; if (lx + r.width  > maxR) maxR = lx + r.width; if (ty + r.height > maxB) maxB = ty + r.height; } catch(e) {}
        }
        refLeft = minL; refTop = minT; refRight = maxR; refBottom = maxB; refCX = (minL + maxR) / 2; refCY = (minT + maxB) / 2;
    }
    for (var j = 0; j < layers.length; j++) {
        try {
            var l = layers[j], rect = l.sourceRectAtTime(t, false), p = getP(l, t), a = l.transform.anchorPoint.valueAtTime(t, false), layerL = p[0] - a[0] + rect.left, layerT = p[1] - a[1] + rect.top, layerR = layerL + rect.width, layerB = layerT + rect.height, layerCX = (layerL + layerR) / 2, layerCY = (layerT + layerB) / 2, nx = p[0], ny = p[1];
            if (type === "left") nx = p[0] + (refLeft - layerL); if (type === "hcenter") nx = p[0] + (refCX - layerCX); if (type === "right") nx = p[0] + (refRight - layerR); if (type === "top") ny = p[1] + (refTop - layerT); if (type === "vcenter") ny = p[1] + (refCY - layerCY); if (type === "bottom") ny = p[1] + (refBottom - layerB); if (type === "center") { nx = p[0] + (refCX - layerCX); ny = p[1] + (refCY - layerCY); } if (type === "tl") { nx = p[0] + (refLeft - layerL); ny = p[1] + (refTop - layerT); } if (type === "tr") { nx = p[0] + (refRight - layerR); ny = p[1] + (refTop - layerT); } if (type === "bl") { nx = p[0] + (refLeft - layerL); ny = p[1] + (refBottom - layerB); } if (type === "br") { nx = p[0] + (refRight - layerR); ny = p[1] + (refBottom - layerB); }
            setP(l, nx, ny, p[2], t);
        } catch(e) {}
    }
    if (type === "distrib-h" && layers.length > 2) {
        var sorted = layers.slice().sort(function(a,b) { try { return getP(a, t)[0] - getP(b, t)[0]; } catch(e) { return 0; }});
        var startX = getP(sorted[0], t)[0], endX = getP(sorted[sorted.length-1], t)[0], stepX = (endX - startX) / (sorted.length - 1);
        for (var dx = 1; dx < sorted.length - 1; dx++) { try { var dp = getP(sorted[dx], t); setP(sorted[dx], startX + stepX * dx, dp[1], dp[2], t); } catch(e) {} }
    }
    if (type === "distrib-v" && layers.length > 2) {
        var vsorted = layers.slice().sort(function(a,b) { try { return getP(a, t)[1] - getP(b, t)[1]; } catch(e) { return 0; }});
        var startY = getP(vsorted[0], t)[1], endY = getP(vsorted[vsorted.length-1], t)[1], stepY = (endY - startY) / (vsorted.length - 1);
        for (var dy = 1; dy < vsorted.length - 1; dy++) { try { var vp = getP(vsorted[dy], t); setP(vsorted[dy], vp[0], startY + stepY * dy, vp[2], t); } catch(e) {} }
    }
    app.endUndoGroup();
}

function centerAnchorAndLayer() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length === 0) return;
    app.beginUndoGroup("Center Anchor and Layer"); var t = comp.time;
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i]; if (!l.transform.anchorPoint) continue;
        var rect = l.sourceRectAtTime(t, false), targetX = rect.left + (rect.width / 2), targetY = rect.top + (rect.height / 2), curAnchor = l.transform.anchorPoint.valueAtTime(t, false), diffX = targetX - curAnchor[0], diffY = targetY - curAnchor[1];
        setK(l.transform.anchorPoint, [targetX, targetY], t);
        var scale = l.transform.scale.valueAtTime(t, false), curPos = getP(l, t);
        setP(l, comp.width / 2, comp.height / 2, curPos[2], t);
    }
    app.endUndoGroup();
}

function groupCenter(doAnchor) {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length === 0) return;
    app.beginUndoGroup("Group Center"); var t = comp.time;
    if (doAnchor) {
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i]; if (!l.transform.anchorPoint) continue;
            var rect = l.sourceRectAtTime(t, false), tX = rect.left + (rect.width / 2), tY = rect.top + (rect.height / 2), curA = l.transform.anchorPoint.valueAtTime(t, false), diffX = tX - curA[0], diffY = tY - curA[1];
            setK(l.transform.anchorPoint, [tX, tY], t);
            var curP = getP(l, t), scale = l.transform.scale.valueAtTime(t, false);
            setP(l, curP[0] + (diffX * (scale[0] / 100)), curP[1] + (diffY * (scale[1] / 100)), curP[2], t);
        }
    }
    var minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (var j = 0; j < layers.length; j++) {
        try { var lr = layers[j].sourceRectAtTime(t, false), p = getP(layers[j], t), a = layers[j].transform.anchorPoint.valueAtTime(t, false), lx = p[0] - a[0] + lr.left, ty = p[1] - a[1] + lr.top; if (lx < minL) minL = lx; if (ty < minT) minT = ty; if (lx + lr.width > maxR) maxR = lx + lr.width; if (ty + lr.height > maxB) maxB = ty + lr.height; } catch(e) {}
    }
    var shiftX = (comp.width / 2) - ((minL + maxR) / 2), shiftY = (comp.height / 2) - ((minT + maxB) / 2);
    for (var k = 0; k < layers.length; k++) { var p2 = getP(layers[k], t); setP(layers[k], p2[0] + shiftX, p2[1] + shiftY, p2[2], t); }
    app.endUndoGroup();
}

function reverseSpatial(axis) {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length < 2) return;
    app.beginUndoGroup("Reverse Spatial " + axis); var t = comp.time, layerData = [];
    for (var i = 0; i < layers.length; i++) { var pos = getP(layers[i], t); layerData.push({ layer: layers[i], pos: pos, x: pos[0], y: pos[1] }); }
    if (axis === "x" || axis === "horizontal") layerData.sort(function(a, b) { return a.x - b.x; }); else if (axis === "y" || axis === "vertical") layerData.sort(function(a, b) { return a.y - b.y; }); else if (axis === "both") layerData.sort(function(a, b) { return a.layer.index - b.layer.index; });
    var positions = []; for (var j = 0; j < layerData.length; j++) positions.push(layerData[j].pos); positions.reverse();
    for (var k = 0; k < layerData.length; k++) { var l = layerData[k].layer; setP(l, positions[k][0], positions[k][1], positions[k][2], t); }
    app.endUndoGroup();
}

function matchLayerStartTime() {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length < 2) return;
    var earliest = layers[0].startTime; for (var i = 1; i < layers.length; i++) if (layers[i].startTime < earliest) earliest = layers[i].startTime;
    app.beginUndoGroup("Match Start Time"); for (var j = 0; j < layers.length; j++) layers[j].startTime = earliest; app.endUndoGroup();
}

function sequenceLayersChain(direction) {
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers; if (layers.length < 2) return;
    app.beginUndoGroup("Sequence Layers Chain");
    var ordered = layers.slice().sort(function(a, b) { return a.index - b.index; });
    if (direction === 'bottom-to-top') ordered.reverse(); else if (direction === 'random') { for (var s = ordered.length - 1; s > 0; s--) { var r = Math.floor(Math.random() * (s + 1)); var tmp = ordered[s]; ordered[s] = ordered[r]; ordered[r] = tmp; } }
    var earliestIn = ordered[0].inPoint; for (var ei = 1; ei < ordered.length; ei++) if (ordered[ei].inPoint < earliestIn) earliestIn = ordered[ei].inPoint;
    var cursor = earliestIn; for (var i = 0; i < ordered.length; i++) { var dur = ordered[i].outPoint - ordered[i].inPoint; ordered[i].startTime = ordered[i].startTime + (cursor - ordered[i].inPoint); cursor += dur; }
    app.endUndoGroup();
}

function setLayerInPoint() {
    app.beginUndoGroup("Set In Point at Playhead");
    var comp = app.project.activeItem;
    if (comp && comp instanceof CompItem) {
        var selectedLayers = comp.selectedLayers;
        for (var i = 0; i < selectedLayers.length; i++) {
            selectedLayers[i].inPoint = comp.time;
        }
    }
    app.endUndoGroup();
}

function setLayerOutPoint() {
    app.beginUndoGroup("Set Out Point at Playhead");
    var comp = app.project.activeItem;
    if (comp && comp instanceof CompItem) {
        var selectedLayers = comp.selectedLayers;
        for (var i = 0; i < selectedLayers.length; i++) {
            selectedLayers[i].outPoint = comp.time;
        }
    }
    app.endUndoGroup();
}

// ----------------------------------------------------------------------------
// FX MODULE
// ----------------------------------------------------------------------------
var globalFXStacks = [];

function copySelectedLayerFX() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "none";
    var layers = comp.selectedLayers;
    if (layers.length !== 1) return "none";
    
    var l = layers[0];
    var currentStack = [];
    var names = [];
    
    var fxGroup = l.property("ADBE Effect Parade");
    if (fxGroup) {
        for (var i = 1; i <= fxGroup.numProperties; i++) {
            var fx = fxGroup.property(i);
            var fxData = { type: "effect", matchName: fx.matchName, values: [] };
            names.push(fx.name);
            for (var j = 1; j <= fx.numProperties; j++) {
                try { fxData.values.push(fx.property(j).value); } catch (e) { fxData.values.push(null); }
            }
            currentStack.push(fxData);
        }
    }
    
    if (l instanceof TextLayer) {
        var textProps = l.property("ADBE Text Properties");
        var animators = textProps.property("ADBE Text Animators");
        if (animators) {
            for (var k = 1; k <= animators.numProperties; k++) {
                var anim = animators.property(k);
                names.push(anim.name + " (Animator)");
                currentStack.push({ type: "animator", name: anim.name });
            }
        }
    }
    
    if (names.length === 0) return "none";
    
    globalFXStacks.push({ names: names, effects: currentStack });
    
    var uiData = [];
    for (var m = 0; m < globalFXStacks.length; m++) {
        uiData.push(globalFXStacks[m].names.join(', '));
    }
    return JSON.stringify(uiData);
}

function removeFXBundleFromMemory(index) {
    globalFXStacks.splice(index, 1);
}

function removeAllFX() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;

    app.beginUndoGroup("Remove FX");
    for (var i = 0; i < layers.length; i++) {
        var fx = layers[i].property("ADBE Effect Parade");
        if (fx) {
            for (var j = fx.numProperties; j >= 1; j--) { fx.property(j).remove(); }
        }
        if (layers[i] instanceof TextLayer) {
            var animators = layers[i].property("ADBE Text Properties").property("ADBE Text Animators");
            if (animators) {
                for (var k = animators.numProperties; k >= 1; k--) { animators.property(k).remove(); }
            }
        }
    }
    app.endUndoGroup();
}

function pasteSpecificFX(indexesStr) {
    if (!indexesStr || globalFXStacks.length === 0) return;
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;

    var selectedIndexes = indexesStr.split(',');
    
    app.beginUndoGroup("Paste Specific FX Bundles");
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        var fxGroup = l.property("ADBE Effect Parade");
        
        for (var idx = 0; idx < selectedIndexes.length; idx++) {
            var pIdx = parseInt(selectedIndexes[idx]);
            var stack = globalFXStacks[pIdx];
            if (!stack) continue;
            
            for (var e = 0; e < stack.effects.length; e++) {
                var data = stack.effects[e];
                if (data.type === "effect" && fxGroup) {
                    var newFX = fxGroup.addProperty(data.matchName);
                    for (var k = 0; k < data.values.length; k++) {
                        try { if (data.values[k] !== null) newFX.property(k + 1).setValue(data.values[k]); } catch (err) {}
                    }
                }
            }
        }
    }
    app.endUndoGroup();
}

// ----------------------------------------------------------------------------
// COLOR MODULE
// ----------------------------------------------------------------------------
function applyHexToFill(hexStr) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;

    var hex = hexStr.replace('#', '');
    var r = parseInt(hex.substring(0,2), 16) / 255;
    var g = parseInt(hex.substring(2,4), 16) / 255;
    var b = parseInt(hex.substring(4,6), 16) / 255;

    app.beginUndoGroup("Color Fill");
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (l instanceof ShapeLayer) {
            var contents = l.property("ADBE Root Vectors Group");
            for(var j = 1; j <= contents.numProperties; j++){
                var fill = contents.property(j).property("ADBE Vectors Group").property("ADBE Vector Graphic - Fill");
                if (fill) fill.property("ADBE Vector Fill Color").setValue([r,g,b,1]);
            }
        } else if (l instanceof TextLayer) {
            var textProp = l.property("Source Text");
            var textDoc = textProp.value;
            textDoc.fillColor = [r,g,b];
            textDoc.applyFill = true;
            textProp.setValue(textDoc);
        } else if (l.source && l.source.mainSource instanceof SolidSource) {
            l.source.mainSource.color = [r,g,b];
        }
    }
    app.endUndoGroup();
}

function applyHexToStroke(hexStr) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;

    var hex = hexStr.replace('#', '');
    var r = parseInt(hex.substring(0,2), 16) / 255;
    var g = parseInt(hex.substring(2,4), 16) / 255;
    var b = parseInt(hex.substring(4,6), 16) / 255;

    app.beginUndoGroup("Color Stroke");
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (l instanceof ShapeLayer) {
            var contents = l.property("ADBE Root Vectors Group");
            for(var j = 1; j <= contents.numProperties; j++){
                var stroke = contents.property(j).property("ADBE Vectors Group").property("ADBE Vector Graphic - Stroke");
                if (stroke) stroke.property("ADBE Vector Stroke Color").setValue([r,g,b,1]);
            }
        } else if (l instanceof TextLayer) {
            var textProp = l.property("Source Text");
            var textDoc = textProp.value;
            textDoc.strokeColor = [r,g,b];
            textDoc.applyStroke = true;
            textProp.setValue(textDoc);
        }
    }
    app.endUndoGroup();
}

// ----------------------------------------------------------------------------
// GRAPH MODULE
// ----------------------------------------------------------------------------
function checkPositionLinkState() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return 'none';
    var props = comp.selectedProperties;
    var hasLinked = false;
    var layers = comp.selectedLayers;
    
    if (props.length > 0) {
        for (var i = 0; i < props.length; i++) {
            if (props[i].matchName === "ADBE Position") {
                if (!props[i].dimensionsSeparated) hasLinked = true;
            }
        }
    } else {
        for (var j = 0; j < layers.length; j++) {
            var pos = layers[j].property("ADBE Transform Group").property("ADBE Position");
            if (pos && pos.numKeys > 0 && !pos.dimensionsSeparated) hasLinked = true;
        }
    }
    return hasLinked ? 'linked' : 'unlinked';
}

function linkedPosApplyWithoutOvershoot(x1, y1, x2, y2, type) {
    var c_y1 = Math.max(0, Math.min(1, y1));
    var c_y2 = Math.max(0, Math.min(1, y2));
    applyBezierEaseToSelection(x1, c_y1, x2, c_y2, type);
}

function linkedPosSeparateAndApply(x1, y1, x2, y2, type) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    
    app.beginUndoGroup("Separate Dimensions and Apply Ease");
    
    var props = comp.selectedProperties;
    var layers = comp.selectedLayers;
    
    if (props.length > 0) {
        for (var i = 0; i < props.length; i++) {
            if (props[i].matchName === "ADBE Position" && !props[i].dimensionsSeparated) {
                props[i].dimensionsSeparated = true;
            }
        }
    } else {
        for (var j = 0; j < layers.length; j++) {
            var pos = layers[j].property("ADBE Transform Group").property("ADBE Position");
            if (pos && pos.numKeys > 0 && !pos.dimensionsSeparated) {
                pos.dimensionsSeparated = true;
            }
        }
    }
    
    applyBezierEaseToSelection(x1, y1, x2, y2, type);
    app.endUndoGroup();
}

function getAllKeyframedProps(propParent, outArr) {
    if (!propParent) return;
    if (propParent.numProperties) {
        for (var i = 1; i <= propParent.numProperties; i++) {
            getAllKeyframedProps(propParent.property(i), outArr);
        }
    }
    if (propParent.canVaryOverTime && propParent.numKeys > 0) {
        outArr.push(propParent);
    }
}

function applyBezierEaseToSelection(x1, y1, x2, y2, type) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;

    app.beginUndoGroup("Apply Graph Ease");

    var infOut = Math.max(0.1, Math.min(100, x1 * 100));
    var infIn  = Math.max(0.1, Math.min(100, (1 - x2) * 100));

    var selProps = comp.selectedProperties;
    var targetProps = [];

    if (selProps.length === 0) {
        for (var L = 0; L < layers.length; L++) {
            getAllKeyframedProps(layers[L], targetProps);
        }
    } else {
        targetProps = selProps;
    }

    for (var p = 0; p < targetProps.length; p++) {
        var prop = targetProps[p];
        if (!prop.canVaryOverTime || prop.numKeys === 0) continue;
        
        var targetKeys = [];
        if (prop.selectedKeys.length > 0) {
            targetKeys = prop.selectedKeys;
        } else {
            for (var kIdx = 1; kIdx <= prop.numKeys; kIdx++) targetKeys.push(kIdx);
        }

        for (var k = 0; k < targetKeys.length; k++) {
            var keyIndex = targetKeys[k];
            try {
                var inInterp = prop.keyInInterpolationType(keyIndex);
                var outInterp = prop.keyOutInterpolationType(keyIndex);

                var dim = 1;
                var isSpatial = false;
                if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) {
                    dim = 1; 
                    isSpatial = true;
                } else if (prop.propertyValueType === PropertyValueType.TwoD || prop.propertyValueType === PropertyValueType.ThreeD || prop.propertyValueType === PropertyValueType.COLOR) {
                    dim = prop.value.length;
                }
                
                var curIn = [], curOut = [];
                if (inInterp === KeyframeInterpolationType.BEZIER) { try { curIn = prop.keyInTemporalEase(keyIndex); } catch(e){} }
                if (outInterp === KeyframeInterpolationType.BEZIER) { try { curOut = prop.keyOutTemporalEase(keyIndex); } catch(e){} }
                
                if (curIn.length === 0) { for(var d=0; d<dim; d++) curIn.push(new KeyframeEase(0, 0.1)); }
                if (curOut.length === 0) { for(var d=0; d<dim; d++) curOut.push(new KeyframeEase(0, 0.1)); }

                var easeInArr = [], easeOutArr = [];
                var t1, t2, v1, v2, t0, tC, v0, vC;
                if (keyIndex < prop.numKeys) {
                    t1 = prop.keyTime(keyIndex); t2 = prop.keyTime(keyIndex + 1);
                    v1 = prop.keyValue(keyIndex); v2 = prop.keyValue(keyIndex + 1);
                }
                if (keyIndex > 1) {
                    t0 = prop.keyTime(keyIndex - 1); tC = prop.keyTime(keyIndex);
                    v0 = prop.keyValue(keyIndex - 1); vC = prop.keyValue(keyIndex);
                }

                var slopeOut = (x1 === 0) ? (y1 > 0 ? 99999 : (y1 < 0 ? -99999 : 0)) : (y1 / x1);
                var slopeIn  = (x2 === 1) ? ((1-y2) > 0 ? 99999 : ((1-y2) < 0 ? -99999 : 0)) : ((1 - y2) / (1 - x2));

                for (var d = 0; d < dim; d++) {
                    var sOut = 0, sIn = 0;

                    if (keyIndex < prop.numKeys) {
                        var dx = t2 - t1;
                        var dy = 0;
                        if (isSpatial) {
                            var sum = 0;
                            for(var i=0; i<v1.length; i++) sum += (v2[i]-v1[i])*(v2[i]-v1[i]);
                            dy = Math.sqrt(sum);
                            sOut = (dx === 0) ? 0 : Math.abs(slopeOut * (dy / dx));
                        } else {
                            var val1 = (typeof v1 === 'number') ? v1 : v1[d];
                            var val2 = (typeof v2 === 'number') ? v2 : v2[d];
                            dy = val2 - val1;
                            sOut = (dx === 0) ? 0 : slopeOut * (dy / dx);
                        }
                    }

                    if (keyIndex > 1) {
                        var dxIn = tC - t0;
                        var dyIn = 0;
                        if (isSpatial) {
                            var sumIn = 0;
                            for(var j=0; j<v0.length; j++) sumIn += (vC[j]-v0[j])*(vC[j]-v0[j]);
                            dyIn = Math.sqrt(sumIn);
                            sIn = (dxIn === 0) ? 0 : Math.abs(slopeIn * (dyIn / dxIn));
                        } else {
                            var val0 = (typeof v0 === 'number') ? v0 : v0[d];
                            var valC = (typeof vC === 'number') ? vC : vC[d];
                            dyIn = valC - val0;
                            sIn = (dxIn === 0) ? 0 : slopeIn * (dyIn / dxIn);
                        }
                    }

                    easeInArr.push(new KeyframeEase(sIn, infIn));
                    easeOutArr.push(new KeyframeEase(sOut, infOut));
                }

                var flatEaseArr = [];
                for (var f = 0; f < dim; f++) {
                    flatEaseArr.push(new KeyframeEase(0, 0.1)); 
                }

                if (type === 'all') { 
                    prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                    prop.setTemporalEaseAtKey(keyIndex, easeInArr, easeOutArr); 
                } 
                else if (type === 'in') { 
                    prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.LINEAR);
                    prop.setTemporalEaseAtKey(keyIndex, easeInArr, flatEaseArr); 
                } 
                else if (type === 'out') { 
                    prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.BEZIER);
                    prop.setTemporalEaseAtKey(keyIndex, flatEaseArr, easeOutArr); 
                }
            } catch(e) {}
        }
    }
    app.endUndoGroup();
}

function readBezierEase() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "0.33,0.00,0.66,1.00";
    
    var props = comp.selectedProperties;
    if (props.length > 0 && props[0].selectedKeys.length > 0) {
        try {
            var prop = props[0];
            var k = prop.selectedKeys[0];
            var easeOut = prop.keyOutTemporalEase(k)[0];
            
            var easeIn;
            if (k < prop.numKeys) { easeIn = prop.keyInTemporalEase(k + 1)[0]; } 
            else { easeIn = prop.keyInTemporalEase(k)[0]; }
            
            var x1 = easeOut.influence / 100;
            var x2 = 1 - (easeIn.influence / 100);
            
            var y1 = 0.00;
            var y2 = 1.00;

            if (k < prop.numKeys) {
                var t1 = prop.keyTime(k); var t2 = prop.keyTime(k+1);
                var v1 = prop.keyValue(k); var v2 = prop.keyValue(k+1);
                
                var dx = t2 - t1;
                var isSpatial = (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL);
                
                var dy = 0;
                if (isSpatial) {
                    var sum = 0;
                    for(var i=0; i<v1.length; i++) sum += (v2[i]-v1[i])*(v2[i]-v1[i]);
                    dy = Math.sqrt(sum);
                } else {
                    var val1 = (typeof v1 === 'number') ? v1 : v1[0];
                    var val2 = (typeof v2 === 'number') ? v2 : v2[0];
                    dy = val2 - val1;
                }

                var avgSpeed = (dx === 0) ? 0 : dy / dx;
                if (avgSpeed !== 0) {
                    var slopeOut = easeOut.speed / avgSpeed;
                    y1 = slopeOut * x1;

                    var slopeIn = easeIn.speed / avgSpeed;
                    y2 = 1 - (slopeIn * (1 - x2));
                }
            }

            return x1.toFixed(2) + "," + y1.toFixed(2) + "," + x2.toFixed(2) + "," + y2.toFixed(2);
        } catch(e) {}
    }
    return "0.33,0.00,0.66,1.00";
}

// ----------------------------------------------------------------------------
// PASTE MODULE
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



// ----------------------------------------------------------------------------
// TRACKER MODULE BACKEND
// ----------------------------------------------------------------------------
// ExtendScript Host Connectivity for Live Tracking
function getTrackerState() {
    try {
        var pName = "No Project Open";
        var isRend = "false";
        
        if (app && app.project) {
            if (app.project.file) {
                var rawName = app.project.file.name;
                // Safely decode URI, fallback to raw name if it fails
                try { pName = decodeURI(rawName); } 
                catch(e) { pName = rawName; }
                
                // Strip the .aep extension
                var dotIndex = pName.lastIndexOf('.');
                if (dotIndex > -1) { pName = pName.substring(0, dotIndex); }
            } else {
                pName = "Untitled Project";
            }
            
            // Check Render Status
            if (app.project.renderQueue) {
                for (var i = 1; i <= app.project.renderQueue.numItems; i++) {
                    if (app.project.renderQueue.item(i).status === RQItemStatus.RENDERING) {
                        isRend = "true";
                        break;
                    }
                }
            }
        }
        
        pName = pName.replace(/\|/g, '').replace(/\n/g, '').replace(/\r/g, ''); 
        return pName + "|||" + isRend;
    } catch (err) {
        return "AE_BUSY|||false";
    }
}

// ============================================================================
// DISCORD RPC MODULE - EXACT ORIGINAL LOGIC
// ============================================================================
function getDiscordAppId() {
    try {
        var n = app.name.toLowerCase();
        if (n.indexOf("after effects") !== -1) return "AEFT";
        if (n.indexOf("premiere") !== -1) return "PPRO";
        if (n.indexOf("photoshop") !== -1) return "PHXS";
    } catch(e) {}
    return "AEFT";
}

function getDetails() {
    var host = getDiscordAppId();
    try {
        if (host === "AEFT") return decodeURIComponent(app.project.file.name);
        if (host === "PPRO") {
            if (app.project && app.project.file && app.project.file.name) return decodeURIComponent(app.project.file.name);
            else if (app.project && app.project.name) return app.project.name;
        }
        if (host === "PHXS") return app.activeDocument.name;
    } catch (e) {}
    if (host === "AEFT") return 'Untitled Project.aep';
    if (host === "PPRO") return 'Untitled.prproj';
    if (host === "PHXS") return 'Untitled.psd';
    return 'Idling.';
}

function getState() {
    var host = getDiscordAppId();
    try {
        if (host === "AEFT") {
            var activeItem = app.project.activeItem;
            // The hardcoded 5x Streak has been removed.
            // It just returns the composition name now.
            if (activeItem && activeItem instanceof CompItem) return activeItem.name;
            return 'Idling.';
        }
        if (host === "PPRO") {
            if (app.project && app.project.activeSequence) {
                var sequenceName = app.project.activeSequence.name;
                var itemCount = 0;
                if (app.project.rootItem && app.project.rootItem.children) itemCount = app.project.rootItem.children.numItems;
                return sequenceName + " (" + itemCount + " items)";
            }
        }
        if (host === "PHXS") return app.activeDocument.activeLayer.name;
    } catch (e) {}
    if (host === "AEFT") return 'No Composition';
    return 'Idling.';
}

function getSmallImageKey() {
    var host = getDiscordAppId();
    try {
        if (host === "AEFT") {
            var tool = app.project.toolType;
            var postImagesMap = {};
            if (typeof ToolType !== 'undefined') {
                if (ToolType.Tool_Arrow) postImagesMap[ToolType.Tool_Arrow] = "https://res.cloudinary.com/dfzaret8p/image/upload/Selection_Tool.png";
                if (ToolType.Tool_Hand) postImagesMap[ToolType.Tool_Hand] = "https://res.cloudinary.com/dfzaret8p/image/upload/Hand_Tool.png";
                if (ToolType.Tool_Magnify) postImagesMap[ToolType.Tool_Magnify] = "https://res.cloudinary.com/dfzaret8p/image/upload/Zoom_Tool.png";
                postImagesMap[9044] = "https://res.cloudinary.com/dfzaret8p/image/upload/Orbit_Around_Cursor_Tool.png";
                postImagesMap[9045] = "https://res.cloudinary.com/dfzaret8p/image/upload/Orbit_Around_Scene_Tool.png";
                postImagesMap[9015] = "https://res.cloudinary.com/dfzaret8p/image/upload/Orbit_Around_Camera_POI2.png";
                postImagesMap[9046] = "https://res.cloudinary.com/dfzaret8p/image/upload/Pan_Under_Cursor_Tool.png";
                postImagesMap[9016] = "https://res.cloudinary.com/dfzaret8p/image/upload/Pan_Camera_POI_Tool2.png";
                postImagesMap[9047] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Dolly_Towards_Cursor_Tool.png";
                postImagesMap[9048] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Dolly_To_Cursor_Tool.png";
                postImagesMap[9017] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Dolly_to_Camera_POI_Tool.png";
                if (ToolType.Tool_Rotate) postImagesMap[ToolType.Tool_Rotate] = "https://res.cloudinary.com/dfzaret8p/image/upload/Rotation_Tool.png";
                if (ToolType.Tool_PanBehind) postImagesMap[ToolType.Tool_PanBehind] = "https://res.cloudinary.com/dfzaret8p/image/upload/Pan_Behind_Anchor_Point_Tool.png";
                if (ToolType.Tool_Rect) postImagesMap[ToolType.Tool_Rect] = "https://res.cloudinary.com/dfzaret8p/image/upload/v5/Rectangle_Tool.png";
                if (ToolType.Tool_RoundedRect) postImagesMap[ToolType.Tool_RoundedRect] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Rounded_Rectangle_Tool.png";
                if (ToolType.Tool_Oval) postImagesMap[ToolType.Tool_Oval] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Ellipse_Tool.png";
                if (ToolType.Tool_Polygon) postImagesMap[ToolType.Tool_Polygon] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Polygon_Tool.png";
                if (ToolType.Tool_Star) postImagesMap[ToolType.Tool_Star] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Star_Tool.png";
                if (ToolType.Tool_Pen) postImagesMap[ToolType.Tool_Pen] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Pen_Tool.png";
                if (ToolType.Tool_PenPlus) postImagesMap[ToolType.Tool_PenPlus] = "https://res.cloudinary.com/dfzaret8p/image/upload/v3/Add_Vertex_Tool.png";
                if (ToolType.Tool_PenMinus) postImagesMap[ToolType.Tool_PenMinus] = "https://res.cloudinary.com/dfzaret8p/image/upload/v3/Delete_Vertex_Tool.png";
                if (ToolType.Tool_PenConvert) postImagesMap[ToolType.Tool_PenConvert] = "https://res.cloudinary.com/dfzaret8p/image/upload/Convert_Vertex_Tool.png";
                if (ToolType.Tool_Feather) postImagesMap[ToolType.Tool_Feather] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Mask_Feather_Tool.png";
                if (ToolType.Tool_TextH) postImagesMap[ToolType.Tool_TextH] = "https://res.cloudinary.com/dfzaret8p/image/upload/Horizontal_Type_Tool.png";
                if (ToolType.Tool_TextV) postImagesMap[ToolType.Tool_TextV] = "https://res.cloudinary.com/dfzaret8p/image/upload/Vertical_Type_Tool.png";
                if (ToolType.Tool_Paintbrush) postImagesMap[ToolType.Tool_Paintbrush] = "https://res.cloudinary.com/dfzaret8p/image/upload/Brush_Tool.png";
                if (ToolType.Tool_CloneStamp) postImagesMap[ToolType.Tool_CloneStamp] = "https://res.cloudinary.com/dfzaret8p/image/upload/Clone_Stamp_Tool.png";
                if (ToolType.Tool_Eraser) postImagesMap[ToolType.Tool_Eraser] = "https://res.cloudinary.com/dfzaret8p/image/upload/Eraser_Tool.png";
                if (ToolType.Tool_Quickselect) postImagesMap[ToolType.Tool_Quickselect] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Roto_Brush.png";
                if (ToolType.Tool_Hairbrush) postImagesMap[ToolType.Tool_Hairbrush] = "https://res.cloudinary.com/dfzaret8p/image/upload/Refine_Edge_Tool.png";
                if (ToolType.Tool_Pin) postImagesMap[ToolType.Tool_Pin] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Position_Pin_Tool.png";
                if (ToolType.Tool_PinStarch) postImagesMap[ToolType.Tool_PinStarch] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Starch_Pin_Tool.png";
                postImagesMap[9038] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Bend_Pin_Tool.png";
                postImagesMap[9043] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Advanced_Pin_Tool.png";
                if (ToolType.Tool_PinDepth) postImagesMap[ToolType.Tool_PinDepth] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Puppet_Overlap_Pin_Tool.png";
            }
            if (postImagesMap[tool]) return postImagesMap[tool];
            return "https://res.cloudinary.com/dfzaret8p/image/upload/Unrecognized_Tool.png";
        }
        if (host === "PHXS") {
            var toolName = app.currentTool.toString().toLowerCase();
            var pm = {
                "movetool": "https://i.postimg.cc/YOUR_LINK/move.png",
                "artboardtool": "https://i.postimg.cc/YOUR_LINK/artboard.png",
                "marqueerecttool": "https://i.postimg.cc/YOUR_LINK/marquee-rect.png",
                "marqueeelliptool": "https://i.postimg.cc/YOUR_LINK/marquee-ellip.png",
                "marqueesinglerowtool": "https://i.postimg.cc/YOUR_LINK/marquee-single-row.png",
                "marqueesinglecolumntool": "https://i.postimg.cc/YOUR_LINK/marquee-single-column.png",
                "lassotool": "https://i.postimg.cc/YOUR_LINK/lasso.png",
                "polyseltool": "https://i.postimg.cc/YOUR_LINK/polygonal-lasso.png",
                "magneticlassotool": "https://i.postimg.cc/YOUR_LINK/magnetic-lasso.png",
                "quickselecttool": "https://i.postimg.cc/YOUR_LINK/quick-select.png",
                "objectselecttool": "https://i.postimg.cc/YOUR_LINK/object-select.png", 
                "magicwandtool": "https://i.postimg.cc/YOUR_LINK/magic-wand.png",
                "croptool": "https://i.postimg.cc/YOUR_LINK/crop.png",
                "perspectivecroptool": "https://i.postimg.cc/YOUR_LINK/perspective-crop.png",
                "slicetool": "https://i.postimg.cc/YOUR_LINK/slice.png",
                "sliceselecttool": "https://i.postimg.cc/YOUR_LINK/slice-select.png",
                "frametool": "https://i.postimg.cc/YOUR_LINK/frame.png", 
                "eyedroppertool": "https://i.postimg.cc/YOUR_LINK/eyedropper.png",
                "3dmaterialselecttool": "https://i.postimg.cc/YOUR_LINK/3d-material-select.png",
                "colorsamplertool": "https://i.postimg.cc/YOUR_LINK/color-sampler.png",
                "rulertool": "https://i.postimg.cc/YOUR_LINK/ruler.png",
                "textannottool": "https://i.postimg.cc/YOUR_LINK/note.png",
                "counttool": "https://i.postimg.cc/YOUR_LINK/count.png",
                "spothealingbrushtool": "https://i.postimg.cc/YOUR_LINK/spot-healing.png",
                "magicstamptool": "https://i.postimg.cc/YOUR_LINK/healing-brush.png",
                "patchselection": "https://i.postimg.cc/YOUR_LINK/patch.png",
                "recomposeselection": "https://i.postimg.cc/YOUR_LINK/content-aware-move.png",
                "redeyetool": "https://i.postimg.cc/YOUR_LINK/red-eye.png",
                "removetool": "https://i.postimg.cc/YOUR_LINK/remove.png", 
                "clonestamptool": "https://i.postimg.cc/YOUR_LINK/clone-stamp.png",
                "patternstamptool": "https://i.postimg.cc/YOUR_LINK/pattern-stamp.png",
                "paintbrushtool": "https://i.postimg.cc/YOUR_LINK/brush.png",
                "penciltool": "https://i.postimg.cc/YOUR_LINK/pencil.png",
                "colorreplacementbrushtool": "https://i.postimg.cc/YOUR_LINK/color-replacement.png",
                "wetbrushtool": "https://i.postimg.cc/YOUR_LINK/mixer-brush.png",
                "historybrushtool": "https://i.postimg.cc/YOUR_LINK/history-brush.png",
                "artbrushtool": "https://i.postimg.cc/YOUR_LINK/art-history-brush.png",
                "erasertool": "https://i.postimg.cc/YOUR_LINK/eraser.png",
                "backgrounderasertool": "https://i.postimg.cc/YOUR_LINK/background-eraser.png",
                "magicerasertool": "https://i.postimg.cc/YOUR_LINK/magic-eraser.png",
                "gradienttool": "https://i.postimg.cc/YOUR_LINK/gradient.png",
                "buckettool": "https://i.postimg.cc/YOUR_LINK/paint-bucket.png",
                "3dmaterialdroptool": "https://i.postimg.cc/YOUR_LINK/3d-material-drop.png",
                "blurtool": "https://i.postimg.cc/YOUR_LINK/blur.png",
                "sharpentool": "https://i.postimg.cc/YOUR_LINK/sharpen.png",
                "smudgetool": "https://i.postimg.cc/YOUR_LINK/smudge.png",
                "dodgetool": "https://i.postimg.cc/YOUR_LINK/dodge.png",
                "burnintool": "https://i.postimg.cc/YOUR_LINK/burn.png",
                "saturationtool": "https://i.postimg.cc/YOUR_LINK/sponge.png",
                "pentool": "https://i.postimg.cc/YOUR_LINK/pen.png",
                "freeformpentool": "https://i.postimg.cc/YOUR_LINK/freeform-pen.png",
                "curvaturepentool": "https://i.postimg.cc/YOUR_LINK/curvature-pen.png", 
                "addknottool": "https://i.postimg.cc/YOUR_LINK/add-anchor-point.png",
                "deleteknottool": "https://i.postimg.cc/YOUR_LINK/delete-anchor-point.png",
                "convertknottool": "https://i.postimg.cc/YOUR_LINK/convert-point.png",
                "pathcomponentselecttool": "https://i.postimg.cc/YOUR_LINK/path-selection.png",
                "directselecttool": "https://i.postimg.cc/YOUR_LINK/direct-selection.png",
                "typecreateoredittool": "https://i.postimg.cc/YOUR_LINK/horizontal-type.png",
                "typeverticalcreateoredittool": "https://i.postimg.cc/YOUR_LINK/vertical-type.png",
                "typecreatemasktool": "https://i.postimg.cc/YOUR_LINK/horizontal-type-mask.png",
                "typeverticalcreatemasktool": "https://i.postimg.cc/YOUR_LINK/vertical-type-mask.png",
                "rectangletool": "https://i.postimg.cc/YOUR_LINK/rectangle.png",
                "roundedrectangletool": "https://i.postimg.cc/YOUR_LINK/rounded-rectangle.png",
                "ellipsetool": "https://i.postimg.cc/YOUR_LINK/ellipse.png",
                "triangletool": "https://i.postimg.cc/YOUR_LINK/triangle.png", 
                "polygontool": "https://i.postimg.cc/YOUR_LINK/polygon.png",
                "linetool": "https://i.postimg.cc/YOUR_LINK/line.png",
                "customshapetool": "https://i.postimg.cc/YOUR_LINK/custom-shape.png",
                "handtool": "https://i.postimg.cc/YOUR_LINK/hand.png",
                "rotatetool": "https://i.postimg.cc/YOUR_LINK/rotate-view.png",
                "zoomtool": "https://i.postimg.cc/YOUR_LINK/zoom.png",
                "3dorbitcameratool": "https://i.postimg.cc/YOUR_LINK/3d-orbit.png", 
                "3dpancameratool": "https://i.postimg.cc/YOUR_LINK/3d-pan.png", 
                "3dobjectpantool": "https://i.postimg.cc/YOUR_LINK/3d-object-pan.png" 
            };
            if (pm[toolName]) return pm[toolName];
            return "https://i.postimg.cc/YOUR_LINK/default-photoshop-tool.png"; 
        }
    } catch(e) {}
    return "";
}

function getPartySize() {
    try {
        if (app.project && app.project.activeItem && app.project.activeItem instanceof CompItem) {
            return app.project.activeItem.selectedLayers.length.toString();
        }
    } catch(e) {}
    return "0";
}

function getPartyMax() {
    try {
        if (app.project && app.project.activeItem && app.project.activeItem instanceof CompItem) {
            return app.project.activeItem.numLayers.toString();
        }
    } catch(e) {}
    return "0";
}

// ==========================================
// NEW LAYERS ENGINE
// ==========================================
function addCustomLayerAE(type, linkOpt, singleOpt, colorIdx) {
    app.beginUndoGroup("Add " + type + " Layer(s)");
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            app.endUndoGroup();
            return;
        }

        var selLayers = comp.selectedLayers;
        var newLayers = []; 

        function createLayer() {
            var l = null;
            switch(type) {
                case 'NUL': l = comp.layers.addNull(comp.duration); break;
                case 'ADJ': 
                    l = comp.layers.addSolid([1,1,1], "Adjustment Layer", comp.width, comp.height, comp.pixelAspect, comp.duration);
                    l.adjustmentLayer = true; 
                    break;
                case 'SLD': l = comp.layers.addSolid([1,1,1], "White Solid", comp.width, comp.height, comp.pixelAspect, comp.duration); break;
                case 'SHP': l = comp.layers.addShape(); break;
                case 'TXT': l = comp.layers.addText(""); break;
                case 'CAM': l = comp.layers.addCamera("Camera", [comp.width/2, comp.height/2]); break;
                case 'LIG': l = comp.layers.addLight("Light", [comp.width/2, comp.height/2]); break;
                default:    l = comp.layers.addNull(comp.duration);
            }
            
            // Apply the saved AE color label index (1-16)
            if (colorIdx !== undefined && parseInt(colorIdx) >= 0 && l !== null) {
                l.label = parseInt(colorIdx);
            }
            return l;
        }

        if (selLayers.length === 0) {
            var singleL = createLayer();
            singleL.moveToBeginning();
            newLayers.push(singleL);
        } else {
            if (type === 'NUL' && singleOpt === true) {
                var minIn = comp.duration; var maxOut = 0; var topIndex = comp.numLayers + 1; var topLayer = null;

                for (var i = 0; i < selLayers.length; i++) {
                    if (selLayers[i].inPoint < minIn) minIn = selLayers[i].inPoint;
                    if (selLayers[i].outPoint > maxOut) maxOut = selLayers[i].outPoint;
                    if (selLayers[i].index < topIndex) { topIndex = selLayers[i].index; topLayer = selLayers[i]; }
                }

                var singleNull = createLayer();
                singleNull.moveBefore(topLayer); 
                singleNull.inPoint = minIn; singleNull.outPoint = maxOut;

                if (linkOpt === true) {
                    for (var j = 0; j < selLayers.length; j++) { selLayers[j].parent = singleNull; }
                }
                newLayers.push(singleNull);
                
            } else {
                var targets = [];
                for (var k = 0; k < selLayers.length; k++) { targets.push(selLayers[k]); }

                for (var m = 0; m < targets.length; m++) {
                    var targetLayer = targets[m];
                    var newL = createLayer();
                    
                    newL.moveBefore(targetLayer); 
                    newL.inPoint = targetLayer.inPoint; newL.outPoint = targetLayer.outPoint;

                    if (type === 'NUL' && linkOpt === true) { targetLayer.parent = newL; }
                    newLayers.push(newL);
                }
            }
        }

        for (var n = 1; n <= comp.numLayers; n++) { comp.layer(n).selected = false; }
        for (var p = 0; p < newLayers.length; p++) { newLayers[p].selected = true; }

    } catch (e) {}
    app.endUndoGroup();
}

// ==========================================
// TIMELINE SORTER ENGINE
// ==========================================
function sortLayersAE(earlyAtBottom) {
    app.beginUndoGroup("Sort Layers by Time");
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            app.endUndoGroup();
            return;
        }

        var layers = comp.layers;
        if (layers.length === 0) {
            app.endUndoGroup();
            return;
        }

        var layerData = [];
        
        // Gather all layers and unlock them safely so they can be moved
        for (var i = 1; i <= layers.length; i++) {
            layerData.push({
                layer: layers[i],
                inPoint: layers[i].inPoint,
                originalIndex: layers[i].index,
                wasLocked: layers[i].locked
            });
            
            if (layers[i].locked) {
                layers[i].locked = false;
            }
        }

        // Sort based on in-points
        layerData.sort(function(a, b) {
            if (a.inPoint === b.inPoint) {
                return b.originalIndex - a.originalIndex; // Maintain relative stack order if times match
            }
            if (earlyAtBottom) {
                return a.inPoint - b.inPoint;
            } else {
                return b.inPoint - a.inPoint;
            }
        });

        // Reorder layers in the timeline
        for (var j = 0; j < layerData.length; j++) {
            layerData[j].layer.moveToBeginning();
        }
        
        // Restore locked states
        for (var k = 0; k < layerData.length; k++) {
            if (layerData[k].wasLocked) {
                layerData[k].layer.locked = true;
            }
        }
    } catch(e) {
        // Fail silently
    }
    app.endUndoGroup();
}

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