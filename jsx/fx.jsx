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