// Local JSON writer: ExtendScript may have no native JSON, and this file must not
// depend on a polyfill from another tab.
function fxJsonQuote(s) {
    s = String(s);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i), code = s.charCodeAt(i);
        if (c === '"' || c === '\\') out += '\\' + c;
        else if (code < 0x20 || code === 0x2028 || code === 0x2029) out += '\\u' + ('000' + code.toString(16)).slice(-4);
        else out += c;
    }
    return out + '"';
}

function fxToJSON(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return String(v);
    if (t === 'string') return fxJsonQuote(v);
    var parts = [], i, k;
    if (v instanceof Array) {
        for (i = 0; i < v.length; i++) parts.push(fxToJSON(v[i]));
        return '[' + parts.join(',') + ']';
    }
    for (k in v) if (v.hasOwnProperty(k)) parts.push(fxJsonQuote(k) + ':' + fxToJSON(v[k]));
    return '{' + parts.join(',') + '}';
}

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
    return fxToJSON(uiData);
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