// ============================================================================
// FX TAB BACKEND
// Copies effect stacks from the selected layers and pastes stored stacks onto the
// selected layers. The panel (js/tab-fx.js) keeps the stacks; this file keeps no
// state, so loading it twice is harmless. Every function returns a JSON string:
//   { ok: true, ... }  or  { ok: false, error: "message for the user" }
// All globals are prefixed "fx". ES3 only; depends on no other jsx file.
// ============================================================================

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

function fxError(message) {
    return fxToJSON({ ok: false, error: message });
}

function fxActiveComp() {
    var comp = app.project ? app.project.activeItem : null;
    return (comp && comp instanceof CompItem) ? comp : null;
}

// ----------------------------------------------------------------------------
// COPY
// ----------------------------------------------------------------------------

/* Installed effects' display names by match name, used to tell renamed effects apart. */
function fxDisplayNames() {
    var map = {}, list = app.effects;
    for (var i = 0; i < list.length; i++) map[list[i].matchName] = list[i].displayName;
    return map;
}

/* True for the name AE gives an effect by default: "Glow", or "Glow 2" for a duplicate. */
function fxIsDefaultName(name, base) {
    if (name === base) return true;
    return name.indexOf(base + ' ') === 0 && /^\d+$/.test(name.substring(base.length + 1));
}

/* Walks an effect's parameters (including nested groups) and records every value and
   expression that can be set again: { path: [indices], matchName, value?, expression? }. */
function fxCaptureParams(group, path, out) {
    for (var i = 1; i <= group.numProperties; i++) {
        var p = group.property(i), here = path.concat([i]);
        if (p.propertyType !== PropertyType.PROPERTY) {
            fxCaptureParams(p, here, out);
            continue;
        }
        var t = p.propertyValueType;
        if (t === PropertyValueType.NO_VALUE || t === PropertyValueType.CUSTOM_VALUE) continue;
        var entry = { path: here, matchName: p.matchName }, v = null;
        try { v = p.value; } catch (e) { v = null; }
        if (typeof v === 'number' || v instanceof Array) entry.value = v;
        try {
            if (p.canSetExpression && p.expression !== '') {
                entry.expression = p.expression;
                entry.expressionEnabled = p.expressionEnabled;
            }
        } catch (e2) {}
        if (entry.value !== undefined || entry.expression !== undefined) out.push(entry);
    }
}

function fxCaptureEffect(effect, displayNames) {
    var params = [], base = displayNames[effect.matchName] || effect.name;
    fxCaptureParams(effect, [], params);
    return {
        matchName: effect.matchName,
        name: effect.name,
        displayName: base,
        renamed: !fxIsDefaultName(effect.name, base),
        enabled: effect.enabled,
        params: params
    };
}

/* One stack per selected layer that has effects. If effects are selected in the
   timeline or Effect Controls, only those are copied from that layer. */
function fxCopyFromSelection() {
    try {
        var comp = fxActiveComp();
        if (!comp) return fxError('Select a layer with effects in a composition first.');
        var layers = comp.selectedLayers;
        if (layers.length === 0) return fxError('Select a layer with effects first.');

        var displayNames = fxDisplayNames(), entries = [], empty = [];
        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i], parade = layer.property('ADBE Effect Parade'), picked = [], j;
            if (parade) {
                for (j = 1; j <= parade.numProperties; j++) if (parade.property(j).selected) picked.push(parade.property(j));
                if (picked.length === 0) for (j = 1; j <= parade.numProperties; j++) picked.push(parade.property(j));
            }
            if (picked.length === 0) { empty.push(layer.name); continue; }
            var effects = [];
            for (j = 0; j < picked.length; j++) effects.push(fxCaptureEffect(picked[j], displayNames));
            entries.push({ layer: layer.name, effects: effects });
        }
        if (entries.length === 0) {
            return fxError(layers.length === 1 ? 'No effects on "' + layers[0].name + '".' : 'No effects on the selected layers.');
        }
        return fxToJSON({ ok: true, entries: entries, empty: empty });
    } catch (e) {
        return fxError('Copy failed: ' + e.toString());
    }
}

// ----------------------------------------------------------------------------
// PASTE
// ----------------------------------------------------------------------------

function fxApplyEffectData(effect, data) {
    for (var i = 0; i < data.params.length; i++) {
        var p = data.params[i], prop = effect;
        try {
            for (var d = 0; d < p.path.length && prop; d++) prop = prop.property(p.path[d]);
            if (!prop || prop.matchName !== p.matchName) continue;   // effect version differs
            if (p.value !== undefined && p.value !== null) prop.setValue(p.value);
            if (p.expression !== undefined && prop.canSetExpression) {
                prop.expression = p.expression;
                prop.expressionEnabled = p.expressionEnabled !== false;
            }
        } catch (e) {}   // hidden or locked parameters keep their default
    }
    try { if (data.renamed) effect.name = data.name; } catch (e1) {}
    try { if (data.enabled === false) effect.enabled = false; } catch (e2) {}
}

/* stacks: [{ effects: [...] }] in paste order. replace: remove each layer's existing
   effects first. Effects that cannot be added (plugin missing, not allowed on that
   layer) are skipped and reported by name. */
function fxPasteToSelection(stacks, replace) {
    var comp = fxActiveComp();
    if (!comp) return fxError('Select the layers to paste onto in a composition first.');
    var layers = comp.selectedLayers;
    if (layers.length === 0) return fxError('Select the layers to paste onto first.');
    if (!stacks || stacks.length === 0) return fxError('No effect stacks to paste.');

    var added = 0, layersChanged = 0, missing = {}, noEffects = [], skipped = [], k;
    app.beginUndoGroup('Paste FX');
    try {
        for (var i = 0; i < layers.length; i++) {
            var parade = layers[i].property('ADBE Effect Parade');
            if (!parade) { noEffects.push(layers[i].name); continue; }
            var before = added;
            if (replace) for (var r = parade.numProperties; r >= 1; r--) parade.property(r).remove();
            for (var s = 0; s < stacks.length; s++) {
                for (var e = 0; e < stacks[s].effects.length; e++) {
                    var data = stacks[s].effects[e];
                    if (!parade.canAddProperty(data.matchName)) { missing[data.displayName || data.name] = true; continue; }
                    fxApplyEffectData(parade.addProperty(data.matchName), data);
                    added++;
                }
            }
            if (added > before) layersChanged++;
        }
    } catch (err) {
        app.endUndoGroup();
        return fxError('Paste failed: ' + err.toString());
    }
    app.endUndoGroup();
    for (k in missing) if (missing.hasOwnProperty(k)) skipped.push(k);
    return fxToJSON({ ok: true, added: added, layers: layersChanged, skipped: skipped, noEffects: noEffects });
}

// ----------------------------------------------------------------------------
// REMOVE
// ----------------------------------------------------------------------------

/* Removes every effect and text animator from the selected layers. */
function fxRemoveAllFromSelection() {
    var comp = fxActiveComp();
    if (!comp) return fxError('Select the layers to clear in a composition first.');
    var layers = comp.selectedLayers;
    if (layers.length === 0) return fxError('Select the layers to clear first.');

    var effects = 0, animators = 0;
    app.beginUndoGroup('Remove FX');
    try {
        for (var i = 0; i < layers.length; i++) {
            var parade = layers[i].property('ADBE Effect Parade'), j;
            if (parade) for (j = parade.numProperties; j >= 1; j--) { parade.property(j).remove(); effects++; }
            if (layers[i] instanceof TextLayer) {
                var anims = layers[i].property('ADBE Text Properties').property('ADBE Text Animators');
                if (anims) for (j = anims.numProperties; j >= 1; j--) { anims.property(j).remove(); animators++; }
            }
        }
    } catch (err) {
        app.endUndoGroup();
        return fxError('Remove failed: ' + err.toString());
    }
    app.endUndoGroup();
    return fxToJSON({ ok: true, effects: effects, animators: animators, layers: layers.length });
}
