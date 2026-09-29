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
    var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return;