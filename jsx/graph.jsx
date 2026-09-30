// -----------------------------------------------------------
//  GRAPH EASE ENGINE
// -----------------------------------------------------------

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
        graphCurveRemoveAdded(prop);   // keys an Elastic / Bounce / ... apply added go again
        if (prop.numKeys === 0) continue;
        
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

function readBezierEaseV2() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return "ERROR: No active comp";
        
        var props = comp.selectedProperties;
        if (!props || props.length === 0) return "ERROR: No properties selected";
        
        var prop = props[0];
        if (!prop.selectedKeys || prop.selectedKeys.length === 0) return "ERROR: No keyframes selected";
        
        var k = prop.selectedKeys[0];
        
        // Prevent crashes from separated dimensions
        if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) {
            if (prop.dimensionsSeparated) return "ERROR: Dimensions are separated";
        }
        
        var easeOut = prop.keyOutTemporalEase(k)[0];
        var easeIn = (k < prop.numKeys) ? prop.keyInTemporalEase(k + 1)[0] : prop.keyInTemporalEase(k)[0];
        
        var x1 = easeOut.influence / 100;
        var x2 = 1 - (easeIn.influence / 100);
        var y1 = 0.00;
        var y2 = 1.00;

        if (k < prop.numKeys) {
            var t1 = prop.keyTime(k); var t2 = prop.keyTime(k+1);
            var v1 = prop.keyValue(k); var v2 = prop.keyValue(k+1);
            
            var dx = t2 - t1;
            var dy = 0;
            
            var isSpatial = (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL);
            if (isSpatial) {
                var sum = 0;
                for(var i=0; i<v1.length; i++) sum += (v2[i]-v1[i])*(v2[i]-v1[i]);
                dy = Math.sqrt(sum);
            } else {
                var val1 = (typeof v1 === 'number') ? v1 : v1[0];
                var val2 = (typeof v2 === 'number') ? v2 : v2[0];
                dy = val2 - val1;
            }

            // AE speed is absolute, using Math.abs prevents inverted math bugs
            var avgSpeed = (dx === 0) ? 0 : Math.abs(dy / dx); 
            if (avgSpeed !== 0) {
                var slopeOut = easeOut.speed / avgSpeed;
                y1 = slopeOut * x1;
                var slopeIn = easeIn.speed / avgSpeed;
                y2 = 1 - (slopeIn * (1 - x2));
            }
        }

        if(isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return "ERROR: Invalid math (NaN)";
        return x1.toFixed(2) + "," + y1.toFixed(2) + "," + x2.toFixed(2) + "," + y2.toFixed(2);
        
    } catch(e) {
        return "ERROR: " + e.toString();
    }
}

// -----------------------------------------------------------
//  CURVE TYPES (Elastic / Bounce / Steps) -> real keyframes
//  spec: "u,v,si,so,ii,io,hold;..." from js/tab-graph-curves.js, in 0..1 space
//  (u = time, v = value, si/so = slope in/out, ii/io = influence %, hold = hold after).
//  Baked between each pair of keyframes: inner keys that were there are replaced, the
//  pair's own keys keep their other side, every key stays editable in the graph editor.
//  Pairs: consecutive selected keys; one selected key + the next; none = every pair.
// -----------------------------------------------------------
// Keys added by a curve type, per property: { "<comp>|<layer>|<property path>": [times] }.
// Kept for the After Effects session (all panels share one ExtendScript scope) so going
// back to Bezier, or applying another type, removes them. A key is only removed while it
// is still there at exactly that time and not selected.
var graphCurveAdded = (typeof graphCurveAdded !== 'undefined' && graphCurveAdded) ? graphCurveAdded : {};

function graphCurvePropKey(prop) {
    try {
        var parts = [], p = prop;
        while (p && p.propertyDepth > 0) { parts.unshift(p.matchName + '#' + p.propertyIndex); p = p.parentProperty; }
        var layer = prop.propertyGroup(prop.propertyDepth);
        var lid = (layer.id !== undefined) ? ('id' + layer.id) : ('ix' + layer.index);
        return layer.containingComp.id + '|' + lid + '|' + parts.join('/');
    } catch (e) { return null; }
}

function graphCurveRemoveAdded(prop) {
    var key = graphCurvePropKey(prop);
    if (!key || !graphCurveAdded[key]) return 0;
    var times = graphCurveAdded[key], removed = 0;
    for (var i = times.length - 1; i >= 0; i--) {
        if (prop.numKeys < 1) break;
        var k = prop.nearestKeyIndex(times[i]);
        var sel = false;
        try { sel = prop.keySelected(k); } catch (e) {}
        if (Math.abs(prop.keyTime(k) - times[i]) < 0.0001 && !sel) { prop.removeKey(k); removed++; }
    }
    delete graphCurveAdded[key];
    return removed;
}

function graphCurveParse(spec) {
    var out = [], rows = String(spec).split(';');
    for (var i = 0; i < rows.length; i++) {
        var c = rows[i].split(',');
        if (c.length < 7) continue;
        out.push({ u: parseFloat(c[0]), v: parseFloat(c[1]), si: parseFloat(c[2]), so: parseFloat(c[3]),
                   ii: Math.max(0.1, Math.min(100, parseFloat(c[4]))), io: Math.max(0.1, Math.min(100, parseFloat(c[5]))),
                   hold: c[6] === '1', lin: c[6] === '2', frame: parseInt(c[7], 10) || 0 });
    }
    return out;
}

function graphCurveApplyPair(prop, ta, tb, knots, minGap) {
    var ka = prop.nearestKeyIndex(ta), kb = prop.nearestKeyIndex(tb);
    if (kb <= ka) return 0;
    var va = prop.keyValue(ka), vb = prop.keyValue(kb), T = tb - ta;
    if (T <= 0) return 0;
    var vt = prop.propertyValueType;
    var spatial = (vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL);
    var isArr = (typeof va !== 'number');
    var n = isArr ? va.length : 1;
    var dims = spatial ? 1 : n;
    var dist = 0, d, i;
    if (spatial) { for (d = 0; d < n; d++) dist += (vb[d] - va[d]) * (vb[d] - va[d]); dist = Math.sqrt(dist); }

    // 1. remove the keys between the pair (added by an earlier apply, or in the way)
    for (i = kb - 1; i > ka; i--) prop.removeKey(i);

    // 2. knot times; keep the knots that are at least minGap apart
    var frameDur = minGap * 2;
    for (i = 0; i < knots.length; i++) {
        var fr = (T > frameDur * 3) ? knots[i].frame : 0;
        knots[i].t = fr === 1 ? ta + frameDur : (fr === 2 ? tb - frameDur : ta + knots[i].u * T);
    }
    // a key pinned one frame after the first / before the second key wins over knots crowding it
    var tFirst = -1e9, tLast = 1e9;
    for (i = 0; i < knots.length; i++) {
        if (knots[i].t !== undefined && knots[i].frame && T > frameDur * 3) { if (knots[i].frame === 1) tFirst = knots[i].t; else tLast = knots[i].t; }
    }
    var use = [knots[0]];
    for (i = 1; i < knots.length - 1; i++) {
        var pinned = knots[i].frame && T > frameDur * 3;
        if (!pinned && (knots[i].t < tFirst + minGap || knots[i].t > tLast - minGap)) continue;
        if (knots[i].t - use[use.length - 1].t < minGap && !pinned) continue;
        if (tb - knots[i].t < minGap) continue;
        use.push(knots[i]);
    }
    use.push(knots[knots.length - 1]);

    // 3. add the inner keys
    var added = [];
    for (i = 1; i < use.length - 1; i++) {
        var val;
        if (isArr) { val = []; for (d = 0; d < n; d++) val.push(va[d] + (vb[d] - va[d]) * use[i].v); }
        else val = va + (vb - va) * use[i].v;
        var idx = prop.addKey(use[i].t);
        prop.setValueAtKey(idx, val);
        added.push(prop.keyTime(idx));
    }

    // 4. interpolation, speeds and influences (endpoints: only the side facing the segment)
    function eases(slope, infl) {
        var arr = [];
        for (var e = 0; e < dims; e++) {
            var sp;
            if (spatial) sp = Math.abs(dist * slope / T);
            else sp = ((isArr ? (vb[e] - va[e]) : (vb - va)) * slope) / T;
            arr.push(new KeyframeEase(sp, infl));
        }
        return arr;
    }
    var BEZ = KeyframeInterpolationType.BEZIER, HOLD = KeyframeInterpolationType.HOLD, LIN = KeyframeInterpolationType.LINEAR;
    for (i = 0; i < use.length; i++) {
        var k = ka + i, q = use[i], prev = (i > 0) ? use[i - 1] : null;
        var inType = (i === 0) ? prop.keyInInterpolationType(k) : (prev.hold ? HOLD : (prev.lin ? LIN : BEZ));
        var outType = (i === use.length - 1) ? prop.keyOutInterpolationType(k) : (q.hold ? HOLD : (q.lin ? LIN : BEZ));
        var inE, outE;
        try { inE = (i === 0) ? prop.keyInTemporalEase(k) : eases(q.si, q.ii); } catch (e1) { inE = eases(0, 33.33); }
        try { outE = (i === use.length - 1) ? prop.keyOutTemporalEase(k) : eases(q.so, q.io); } catch (e2) { outE = eases(0, 33.33); }
        try {
            if (i > 0 && i < use.length - 1) { prop.setTemporalContinuousAtKey(k, q.si === q.so); prop.setTemporalAutoBezierAtKey(k, false); }
            else { prop.setTemporalAutoBezierAtKey(k, false); prop.setTemporalContinuousAtKey(k, false); }   // the pair's own keys: its other side keeps its speed
        } catch (e3) {}
        prop.setInterpolationTypeAtKey(k, BEZ, BEZ);
        try { prop.setTemporalEaseAtKey(k, inE, outE); } catch (e4) {}
        prop.setInterpolationTypeAtKey(k, inType, outType);   // last: an ease change turns hold / linear into bezier
        if (spatial) {
            try {
                var zero = []; for (d = 0; d < n; d++) zero.push(0);
                var inT = (i === 0) ? prop.keyInSpatialTangent(k) : zero;
                var outT = (i === use.length - 1) ? prop.keyOutSpatialTangent(k) : zero;
                if (i > 0 && i < use.length - 1) { prop.setSpatialAutoBezierAtKey(k, false); prop.setSpatialContinuousAtKey(k, false); prop.setRovingAtKey(k, false); }
                prop.setSpatialTangentsAtKey(k, inT, outT);
            } catch (e5) {}
        }
        try { prop.setSelectedAtKey(k, i === 0 || i === use.length - 1); } catch (e6) {}
    }
    var rk = graphCurvePropKey(prop);
    if (rk) graphCurveAdded[rk] = (graphCurveAdded[rk] || []).concat(added);
    return use.length - 2;
}

function graphApplyCurveKnots(spec, label) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return 'ERROR: No active comp';
        var knots = graphCurveParse(spec);
        if (knots.length < 2) return 'ERROR: Invalid curve';
        var layers = comp.selectedLayers;
        var targetProps = [], p, L;
        var selProps = comp.selectedProperties;
        if (selProps.length === 0) { for (L = 0; L < layers.length; L++) getAllKeyframedProps(layers[L], targetProps); }
        else { for (p = 0; p < selProps.length; p++) targetProps.push(selProps[p]); }
        var okTypes = [PropertyValueType.OneD, PropertyValueType.TwoD, PropertyValueType.ThreeD, PropertyValueType.TwoD_SPATIAL, PropertyValueType.ThreeD_SPATIAL, PropertyValueType.COLOR];
        var minGap = comp.frameDuration * 0.5;
        var pairs = 0, added = 0;

        app.beginUndoGroup('Apply ' + (label || 'Curve'));
        for (p = 0; p < targetProps.length; p++) {
            var prop = targetProps[p];
            if (!prop || !prop.canVaryOverTime || prop.numKeys < 2) continue;
            var ok = false;
            for (var t = 0; t < okTypes.length; t++) if (prop.propertyValueType === okTypes[t]) ok = true;
            if (!ok) continue;
            // pairs as times (indices move while keys are added / removed)
            graphCurveRemoveAdded(prop);
            if (prop.numKeys < 2) continue;
            var times = [], sel = prop.selectedKeys, s;
            if (sel.length >= 2) { for (s = 0; s < sel.length - 1; s++) times.push([prop.keyTime(sel[s]), prop.keyTime(sel[s + 1])]); }
            else if (sel.length === 1) { if (sel[0] < prop.numKeys) times.push([prop.keyTime(sel[0]), prop.keyTime(sel[0] + 1)]); }
            else { for (s = 1; s < prop.numKeys; s++) times.push([prop.keyTime(s), prop.keyTime(s + 1)]); }
            for (s = 0; s < times.length; s++) { added += graphCurveApplyPair(prop, times[s][0], times[s][1], knots, minGap); pairs++; }
        }
        app.endUndoGroup();
        return 'OK ' + pairs + ' ' + added;
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}
