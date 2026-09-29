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
