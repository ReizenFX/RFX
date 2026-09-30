// This tab's ExtendScript backend (jsx/graph.jsx), loaded on first use.
const graphJsx = window.createJsxLoader('graph.jsx');
(function() {
    window.setEaseType = function(type) {
        window._activeEaseType = type;
        document.getElementById('btn-ease-in').classList.remove('active'); document.getElementById('btn-ease-all').classList.remove('active'); document.getElementById('btn-ease-out').classList.remove('active');
        var activeBtn = document.getElementById('btn-ease-' + type); if(activeBtn) activeBtn.classList.add('active');
        if (window.isAutoGraph) window.applyGraphToKeyframesWithCheck(type);
    };

    var savedAuto = localStorage.getItem('ultAutoGraphState');
    window.isAutoGraph = savedAuto === null ? true : (savedAuto === 'true');

    window.toggleAutoGraph = function() {
        window.isAutoGraph = !window.isAutoGraph;
        localStorage.setItem('ultAutoGraphState', window.isAutoGraph);
        var btn = document.getElementById('html-auto-btn');
        if (btn) {
            if (window.isAutoGraph) btn.classList.add('active'); else btn.classList.remove('active');
        }
    };

    var graphRoot = document.getElementById('graph-editor-area'), valueDisplay = document.getElementById('graph-value-display'), presetsGrid = document.getElementById('graph-presets-grid'), resizer = document.getElementById('graph-resizer'), libSelect = document.getElementById('graph-lib-select');
    var graphLibraries = {}, activeLibName = "Default", cp1 = {x: 0.33, y: 0.0}, cp2 = {x: 0.66, y: 1.0};
    
    try {
        var savedGraph = localStorage.getItem('ultSavedGraphState');
        if (savedGraph) { var parsed = JSON.parse(savedGraph); if (!isNaN(parsed[0]) && !isNaN(parsed[1]) && !isNaN(parsed[2]) && !isNaN(parsed[3])) { cp1 = {x: parsed[0], y: parsed[1]}; cp2 = {x: parsed[2], y: parsed[3]}; } }
    } catch(e){}

    var prevCp1 = {x: cp1.x, y: cp1.y}, prevCp2 = {x: cp2.x, y: cp2.y}, olderCp1 = {x: cp1.x, y: cp1.y}, olderCp2 = {x: cp2.x, y: cp2.y};
    var undoStack = [], redoStack = [], lastEditTime = 0, sessionHandles = [];

    function pushGraphHistory(forceNewStep, currentHandle) {
        var now = Date.now(), isQuick = (now - lastEditTime < 5000);
        if (forceNewStep || !isQuick || sessionHandles.indexOf(currentHandle) !== -1) {
            if (undoStack.length > 0) {
                var last = undoStack[undoStack.length - 1];
                if (Math.abs(last[0] - cp1.x) < 0.001 && Math.abs(last[1] - cp1.y) < 0.001 && Math.abs(last[2] - cp2.x) < 0.001 && Math.abs(last[3] - cp2.y) < 0.001) { sessionHandles = currentHandle ? [currentHandle] : []; return; }
            }
            undoStack.push([cp1.x, cp1.y, cp2.x, cp2.y]); if (undoStack.length > 30) undoStack.shift(); redoStack = []; sessionHandles = currentHandle ? [currentHandle] : [];
        } else { if (currentHandle) sessionHandles.push(currentHandle); }
    }

    window._undoGraph = function() {
        if (undoStack.length === 0) return;
        redoStack.push([cp1.x, cp1.y, cp2.x, cp2.y]); var prevState = undoStack.pop(); lastEditTime = Date.now(); sessionHandles = [];
        animateGraphUpdate({x: prevState[0], y: prevState[1]}, {x: prevState[2], y: prevState[3]}, 350, true);
        if (window.isAutoGraph) setTimeout(() => window.applyGraphToKeyframesWithCheck(window._activeEaseType), 350);
    };

    window._redoGraph = function() {
        if (redoStack.length === 0) return;
        undoStack.push([cp1.x, cp1.y, cp2.x, cp2.y]); var nextState = redoStack.pop(); lastEditTime = Date.now(); sessionHandles = [];
        animateGraphUpdate({x: nextState[0], y: nextState[1]}, {x: nextState[2], y: nextState[3]}, 350, true);
        if (window.isAutoGraph) setTimeout(() => window.applyGraphToKeyframesWithCheck(window._activeEaseType), 350);
    };

    function saveGraphState() { localStorage.setItem('ultSavedGraphState', JSON.stringify([cp1.x, cp1.y, cp2.x, cp2.y])); }

    var isResizingGraph = false, startResizeY = 0, startResizeX = 0, startGraphH = 240, startRightW = 260, collapsedInDrag = false;

    /* Bottom controls (copy, value, save, ease, Apply, AUTO) can be collapsed with the thin
       handle above them; the choice is remembered. */
    var GRAPH_BAR_KEY = 'rfxGraphBarCollapsed';
    window.graphBarCollapsed = function() { var tg = document.getElementById('tab-graph'); return !!(tg && tg.classList.contains('graph-bar-collapsed')); };
    window.setGraphBarCollapsed = function(v) {
        var tg = document.getElementById('tab-graph'); if (!tg) return;
        tg.classList.toggle('graph-bar-collapsed', !!v);
        try { if (v) localStorage.setItem(GRAPH_BAR_KEY, '1'); else localStorage.removeItem(GRAPH_BAR_KEY); } catch (err) {}
    };
    try { if (localStorage.getItem(GRAPH_BAR_KEY) === '1') window.setGraphBarCollapsed(true); } catch (err) {}
    var barHandle = document.getElementById('graph-bottom-handle');
    if (barHandle) {
        var hStartY = 0, hMoved = false, hDown = false;
        barHandle.addEventListener('pointerdown', function(e) { hDown = true; hMoved = false; hStartY = e.clientY; try { barHandle.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); });
        barHandle.addEventListener('pointermove', function(e) {
            if (!hDown) return;
            var dy = e.clientY - hStartY;
            if (dy > 16 && !window.graphBarCollapsed()) { window.setGraphBarCollapsed(true); hMoved = true; hStartY = e.clientY; }
            else if (dy < -16 && window.graphBarCollapsed()) { window.setGraphBarCollapsed(false); hMoved = true; hStartY = e.clientY; }
            else if (Math.abs(dy) > 4) hMoved = true;
        });
        barHandle.addEventListener('pointerup', function(e) {
            if (!hDown) return; hDown = false;
            try { barHandle.releasePointerCapture(e.pointerId); } catch (err) {}
            if (!hMoved) window.setGraphBarCollapsed(!window.graphBarCollapsed());
        });
    }
    
    if (resizer) {
        resizer.addEventListener('pointerdown', function(e) {
            isResizingGraph = true; collapsedInDrag = false;
            startResizeY = e.clientY; 
            startResizeX = e.clientX; 
            
            var rootGrid = document.getElementById('tab-graph');
            
            // 🎯 THE FIX: Explicitly check for NaN (Not-a-Number) instead of using ||
            var currentW = getComputedStyle(rootGrid).getPropertyValue('--right-panel-width').trim();
            var parsedW = parseInt(currentW);
            startRightW = isNaN(parsedW) ? 260 : parsedW;
            
            // 🎯 THE FIX: Apply the same NaN check to the vertical height
            var currentH = getComputedStyle(rootGrid).getPropertyValue('--graph-panel-height').trim();
            var parsedH = parseInt(currentH);
            startGraphH = isNaN(parsedH) ? (document.getElementById('graph-top-wrapper').clientHeight || 240) : parsedH;

            var bottomCtrls = document.querySelector('#tab-graph .fixed-bottom'); 
            if (bottomCtrls) bottomCtrls.style.flexShrink = '0';
            try { resizer.setPointerCapture(e.pointerId); } catch(err){} 
            e.preventDefault();
        });
        
        resizer.addEventListener('pointermove', function(e) {
            if (!isResizingGraph) return; 
            
            var flexContainer = document.querySelector('#tab-graph .flex-column-container');
            var rootGrid = document.getElementById('tab-graph');
            
            // Check which layout CSS is currently active
            var isWide = getComputedStyle(flexContainer).display === 'grid';
            
            if (isWide) {
                // WIDE LAYOUT
                var diffX = startResizeX - e.clientX; 
                var containerW = rootGrid.clientWidth;
                
                // 🎯 THE FIX: Allow width to range from 0 (Graph Fullscreen) to containerW (Presets Fullscreen)
                var newW = Math.max(0, Math.min(startRightW + diffX, containerW)); 
                rootGrid.style.setProperty('--right-panel-width', newW + 'px');
            } else {
                // VERTICAL LAYOUT
                var diff = e.clientY - startResizeY;
                var resizerEl = document.getElementById('graph-resizer');
                var totalH = flexContainer ? flexContainer.clientHeight : 500;
                var resizerH = resizerEl ? resizerEl.offsetHeight : 0;
                var barEl = document.querySelector('#tab-graph .fixed-bottom');
                var ctrlEl = document.querySelector('#tab-graph .graph-bottom-controls');
                var raw = startGraphH + diff;
                // Dragging past the bottom bar collapses it in the same move; dragging back up
                // in the same drag brings it back.
                var maxWithBar = totalH - resizerH - (barEl ? barEl.offsetHeight : 0);
                if (!window.graphBarCollapsed() && raw > maxWithBar + 24) { window.setGraphBarCollapsed(true); collapsedInDrag = true; }
                else if (window.graphBarCollapsed() && collapsedInDrag && ctrlEl && raw < maxWithBar - ctrlEl.scrollHeight - 12) { window.setGraphBarCollapsed(false); collapsedInDrag = false; }
                
                // Allow height to range from 0 (Presets Fullscreen) to maxH (Graph Fullscreen)
                var maxH = totalH - resizerH - (barEl ? (window.graphBarCollapsed() ? (barEl.offsetHeight - (ctrlEl ? ctrlEl.offsetHeight : 0)) : barEl.offsetHeight) : 0); 
                var newH = Math.max(0, Math.min(raw, maxH)); 
                
                rootGrid.style.setProperty('--graph-panel-height', newH + 'px');
            }
            updateGraphUI();
        });
        
        resizer.addEventListener('pointerup', function(e) { 
            if (isResizingGraph) { 
                isResizingGraph = false; 
                try { resizer.releasePointerCapture(e.pointerId); } catch(err){} 
                updateGraphUI(); 
            } 
        });
    }

    // Instant, pure resize tracking. Safely checks for ResizeObserver support.
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => { 
            var graphRoot = document.getElementById('graph-editor-area');
            if (graphRoot && graphRoot.clientHeight >= 15) updateGraphUI(); 
        }).observe(document.getElementById('tab-graph'));
    }

    window._graphResetFn = function() { animateGraphUpdate({x: 0.0, y: 0.0}, {x: 1.0, y: 1.0}); };
    window._graphGetCp = function() { return { x1: cp1.x, y1: cp1.y, x2: cp2.x, y2: cp2.y }; };

    function getGraphMetrics() {
        var svg = document.getElementById('bezier-svg'), rawW = Math.max(0.1, svg.clientWidth), rawH = Math.max(0.1, svg.clientHeight), pad = 16;
        var minValY = Math.min(0, cp1.y, cp2.y), maxValY = Math.max(1, cp1.y, cp2.y);
        
        if (window._isGraphDragging) {
            if (minValY < window._graphDragMinY) window._graphDragMinY = minValY;
            if (maxValY > window._graphDragMaxY) window._graphDragMaxY = maxValY;
            minValY = window._graphDragMinY;
            maxValY = window._graphDragMaxY;
        } else if (window._isCameraAnimating) {
            // MATH: Reads the smoothly animated values when returning to bounds
            minValY = window._graphDragMinY;
            maxValY = window._graphDragMaxY;
        } else {
            window._graphDragMinY = minValY;
            window._graphDragMaxY = maxValY;
        }
        
        var rangeY = maxValY - minValY; if (rangeY < 1) rangeY = 1;
        var availableW = Math.max(0.1, rawW - pad * 2), availableH = Math.max(0.1, rawH - pad * 2);
        var pixelsPerUnit = Math.min(availableW, availableH / rangeY), drawW = pixelsPerUnit, drawH = pixelsPerUnit, totalDrawH = pixelsPerUnit * rangeY;
        var offsetX = pad + (availableW - drawW) / 2, offsetY = pad + (availableH - totalDrawH) / 2;
        return { rawW: rawW, rawH: rawH, pad: pad, drawW: drawW, drawH: drawH, offsetX: offsetX, offsetY: offsetY, minValY: minValY, rangeY: rangeY, svg: svg };
    }

    // NEW: Buttery smooth cinematic camera recovery engine
    var cameraAnimId = null;
    function animateCameraTo(targetMin, targetMax) {
        if (cameraAnimId) cancelAnimationFrame(cameraAnimId);
        var startMin = window._graphDragMinY, startMax = window._graphDragMaxY;
        if (startMin === undefined) startMin = targetMin; if (startMax === undefined) startMax = targetMax;
        
        window._isCameraAnimating = true; 
        var startTime = null, duration = 300; 
        
        function step(time) {
            if (window._isGraphDragging) { window._isCameraAnimating = false; return; } // Cancels if you click the handle again
            if (!startTime) startTime = time;
            
            var p = Math.min((time - startTime) / duration, 1);
            var e = 1 - Math.pow(1 - p, 3); // Cubic ease out curve
            
            window._graphDragMinY = startMin + (targetMin - startMin) * e;
            window._graphDragMaxY = startMax + (targetMax - startMax) * e;
            updateGraphUI();
            
            if (p < 1) {
                cameraAnimId = requestAnimationFrame(step);
            } else {
                window._isCameraAnimating = false;
                window._graphDragMinY = targetMin;
                window._graphDragMaxY = targetMax;
                updateGraphUI();
            }
        }
        cameraAnimId = requestAnimationFrame(step);
    }

    function valToPx(m, vx, vy) { return { x: m.offsetX + (vx * m.drawW), y: m.offsetY + (m.drawH * m.rangeY) - ((vy - m.minValY) * m.drawH) }; }

    function initGraph() {
        if (!graphRoot) return;
        graphRoot.innerHTML = `<svg id="bezier-svg" style="width:100%; height:100%; display:block; overflow:visible; user-select:none;"><defs><radialGradient id="grid-fade" gradientUnits="userSpaceOnUse"><stop offset="35%" class="gx-mask-stop" stop-opacity="1" /><stop offset="100%" class="gx-mask-stop" stop-opacity="0" /></radialGradient><mask id="grid-mask"><rect x="-500" y="-500" width="2000" height="2000" fill="url(#grid-fade)" /></mask></defs><g id="bezier-grid-lines" mask="url(#grid-mask)"></g><rect id="bezier-bounds-rect" class="gx-bounds" fill="none" stroke-width="1.5"></rect><path id="bezier-path-ref-old" class="gx-ref-old" fill="none" stroke-width="3" stroke-linecap="round" style="opacity: 0; transition: opacity 0.4s ease;"/><path id="bezier-path-ref" class="gx-ref" fill="none" stroke-width="3" stroke-linecap="round"/><line id="bezier-line1" class="gx-accent gx-arm" stroke-width="4" stroke-linecap="round"/><line id="bezier-line2" class="gx-accent gx-arm" stroke-width="4" stroke-linecap="round"/><path id="bezier-path" class="gx-curve" fill="none" stroke-width="3" stroke-linecap="round"/><circle id="bezier-handle1" class="gx-handle" r="6" stroke-width="2.5" style="cursor:pointer;"/><circle id="bezier-handle2" class="gx-handle" r="6" stroke-width="2.5" style="cursor:pointer;"/></svg>`;

        var svg = document.getElementById('bezier-svg'), h1 = document.getElementById('bezier-handle1'), h2 = document.getElementById('bezier-handle2');
        var draggingHandle = null, dragStartPos = {x: 0, y: 0}, dragStartVal = {x: 0, y: 0}, dragStartScale = 100, STICKY = 0.035;

        function getStickyNy(rawNy) { if (rawNy >= -STICKY && rawNy <= STICKY) return 0; if (rawNy >= 1 - STICKY && rawNy <= 1 + STICKY) return 1; if (rawNy > 1 + STICKY) return 1 + (rawNy - (1 + STICKY)) * 0.25; if (rawNy < -STICKY) return (rawNy + STICKY) * 0.25; return (rawNy - STICKY) / (1 - 2 * STICKY); }
        function getInverseNy(ny) { if (ny > 1) return 1 + STICKY + (ny - 1) * 4; if (ny < 0) return -STICKY + ny * 4; if (ny === 0) return 0; if (ny === 1) return 1; return STICKY + ny * (1 - 2 * STICKY); }
        function getMousePos(e) { var rect = svg.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }

        function onDown(e, handleNum) {
            if (e.button !== 0) return; 
            
            window._isGraphDragging = true; 
            window._graphDragMinY = Math.min(0, cp1.y, cp2.y); 
            window._graphDragMaxY = Math.max(1, cp1.y, cp2.y);

            pushGraphHistory(false, handleNum); animateHistoryTo(cp1, cp2); 
            olderCp1 = {x: prevCp1.x, y: prevCp1.y}; olderCp2 = {x: prevCp2.x, y: prevCp2.y};
            var oldPath = document.getElementById('bezier-path-ref-old'); if (oldPath) oldPath.style.opacity = '1';
            draggingHandle = handleNum; var m = getGraphMetrics(); dragStartScale = m.drawH; 
            
            var pos = getMousePos(e);
            dragStartPos = pos;
            var targetCp = handleNum === 1 ? cp1 : cp2; 
            dragStartVal = { x: targetCp.x, y: targetCp.y };
            
            // NEW: Set up frame-by-frame tracking and check if we started in overshoot
            window._lastMousePos = { x: pos.x, y: pos.y };
            window._logicalX = targetCp.x;
            window._logicalY = typeof getInverseNy === 'function' ? getInverseNy(targetCp.y) : targetCp.y;
            window._dragOvershootLocked = (window._logicalY > 1 || window._logicalY < 0);

            var el = handleNum === 1 ? h1 : h2; try { el.setPointerCapture(e.pointerId); } catch(err){} e.preventDefault();
        }

        h1.addEventListener('pointerdown', function(e) { onDown(e, 1); }); h2.addEventListener('pointerdown', function(e) { onDown(e, 2); });

        svg.addEventListener('pointerdown', function(e) {
            if (e.button !== 0 || draggingHandle || e.target === h1 || e.target === h2) return;
            var m = getGraphMetrics(), pos = getMousePos(e);
            var dist1 = Math.hypot(pos.x - valToPx(m, cp1.x, cp1.y).x, pos.y - valToPx(m, cp1.x, cp1.y).y), dist2 = Math.hypot(pos.x - valToPx(m, cp2.x, cp2.y).x, pos.y - valToPx(m, cp2.x, cp2.y).y);
            draggingHandle = (dist1 < dist2) ? 1 : 2;
            
            window._isGraphDragging = true; 
            window._graphDragMinY = Math.min(0, cp1.y, cp2.y); 
            window._graphDragMaxY = Math.max(1, cp1.y, cp2.y);

            pushGraphHistory(false, draggingHandle); animateHistoryTo(cp1, cp2); 
            olderCp1 = {x: prevCp1.x, y: prevCp1.y}; olderCp2 = {x: prevCp2.x, y: prevCp2.y};
            var oldPath = document.getElementById('bezier-path-ref-old'); if (oldPath) oldPath.style.opacity = '1';
            
            var rawNx = (pos.x - m.offsetX) / m.drawW;
            var rawNy = m.minValY + (m.offsetY + m.drawH * m.rangeY - pos.y) / m.drawH;
            
            dragStartScale = m.drawH; dragStartPos = { x: pos.x, y: pos.y }; 
            
            // NEW: Set up frame-by-frame tracking and check if we started in overshoot
            window._lastMousePos = { x: pos.x, y: pos.y };
            window._logicalX = rawNx;
            window._logicalY = rawNy;
            window._dragOvershootLocked = (rawNy > 1 || rawNy < 0);

            var nx = Math.max(0, Math.min(1, rawNx)), ny = getStickyNy(rawNy);
            if (window.graphAllowOvershoot === false) ny = Math.max(0, Math.min(1, ny));
            dragStartVal = { x: nx, y: ny };
            
            if (draggingHandle === 1) { cp1.x = nx; cp1.y = ny; } else { cp2.x = nx; cp2.y = ny; }
            if (window.isAutoGraph) setTimeout(() => window.applyGraphToKeyframesWithCheck(window._activeEaseType), 250);
            updateGraphUI();
        });

        svg.addEventListener('pointermove', function(e) {
            // Reset our custom tracker if we aren't dragging
            if (!draggingHandle) {
                window._customDragActive = false;
                return; 
            }
            var pos = getMousePos(e);
            
            // THE FIX: Initialize pristine tracking variables on the first frame of movement.
            // This completely ignores the broken 'window._logicalY' and prevents the 4x runaway jump!
            if (!window._customDragActive) {
                window._customDragActive = true;
                window._lastMousePos = { x: pos.x, y: pos.y };
                window._trueLogicalX = (draggingHandle === 1) ? cp1.x : cp2.x;
                window._trueLogicalY = (draggingHandle === 1) ? cp1.y : cp2.y;
                window._dragOvershootLocked = (window._trueLogicalY > 1 || window._trueLogicalY < 0);
                return; // Skip the very first frame to prevent teleporting
            }
            
            // 1. Calculate physical mouse delta
            var deltaX = pos.x - window._lastMousePos.x;
            var deltaY = pos.y - window._lastMousePos.y;
            window._lastMousePos = { x: pos.x, y: pos.y }; 
            
            // 2. Convert to linear graph units using dragStartScale (Zero lagging/sliding)
            var valDeltaX = deltaX / dragStartScale;
            var valDeltaY = -deltaY / dragStartScale; 
            
            // 3. Fetch speed settings securely
            var overSensitivity = (window.graphDragSensitivity !== undefined ? window.graphDragSensitivity : 100) / 100;
            var normSensitivity = (window.graphNormalSpeed !== undefined ? window.graphNormalSpeed : 100) / 100;
            var allowOvershoot = (window.graphAllowOvershoot !== undefined ? window.graphAllowOvershoot : true);
            
            // 4. Lock friction state if we enter overshoot
            if (window._trueLogicalY > 1 || window._trueLogicalY < 0) {
                window._dragOvershootLocked = true;
            }
            
            // 5. Apply friction mathematically
            if (window._dragOvershootLocked && allowOvershoot !== false) {
                valDeltaX *= overSensitivity;
                valDeltaY *= overSensitivity;
            } else {
                valDeltaX *= normSensitivity;
                valDeltaY *= normSensitivity;
            }
            
            // 6. Update our pristine tracking variables directly
            window._trueLogicalX += valDeltaX;
            window._trueLogicalY += valDeltaY;
            
            // 7. Calculate final visual coordinates without any sticky magnets!
            var nx = Math.max(0, Math.min(1, window._trueLogicalX)); 
            var ny = window._trueLogicalY;
            
            // 8. Clamp cleanly if overshoot is disabled
            if (allowOvershoot === false) {
                ny = Math.max(0, Math.min(1, ny));
            }
            
            if (draggingHandle === 1) { cp1.x = nx; cp1.y = ny; } else { cp2.x = nx; cp2.y = ny; }
            updateGraphUI();
        });

        svg.addEventListener('pointerup', function(e) {
            if (draggingHandle) {
                var el = draggingHandle === 1 ? h1 : h2; try { el.releasePointerCapture(e.pointerId); } catch(err){}
                draggingHandle = null; var oldPath = document.getElementById('bezier-path-ref-old'); if (oldPath) oldPath.style.opacity = '0';
                
                // NEW: Unlock the camera and dynamically animate it back to the exact bounds
                window._isGraphDragging = false; 
                var targetMin = Math.min(0, cp1.y, cp2.y), targetMax = Math.max(1, cp1.y, cp2.y);
                animateCameraTo(targetMin, targetMax);
                
                lastEditTime = Date.now(); saveGraphState(); 
                if (window.isAutoGraph) window.applyGraphToKeyframesWithCheck(window._activeEaseType);
            }
        });

        svg.addEventListener('contextmenu', function(e) {
            e.preventDefault();

            showCtxMenu(e.clientX, e.clientY, [
                { label: 'Apply', action: () => window.applyGraphToKeyframesWithCheck(window._activeEaseType) },
                { label: 'Reverse value', action: () => { animateGraphUpdate({x: 1 - cp2.x, y: 1 - cp2.y}, {x: 1 - cp1.x, y: 1 - cp1.y}); if (window.isAutoGraph) setTimeout(() => window.applyGraphToKeyframesWithCheck(window._activeEaseType), 350); }},
                { sep: true },
                { label: 'Undo', disabled: undoStack.length === 0, action: () => window._undoGraph() },
                { label: 'Redo', disabled: redoStack.length === 0, action: () => window._redoGraph() },
                { sep: true },
                { label: 'Reset Graph (Linear)', action: () => window._graphResetFn() },
                { sep: true },
                { label: 'Overshoot & Control', sub: [
                    { 
                        slider: true, 
                        label: 'Normal Speed %', 
                        min: 10, max: 200, 
                        value: (window.graphNormalSpeed !== undefined ? window.graphNormalSpeed : 100), 
                        onInput: function(ev) { window.graphNormalSpeed = parseInt(ev.target.value); } 
                    },
                    { 
                        toggle: true, 
                        label: 'Overshoot',
                        checked: (window.graphAllowOvershoot !== undefined ? window.graphAllowOvershoot : true), 
                        onChange: function(isChecked) { 
                            window.graphAllowOvershoot = isChecked; 
                            if(!window.graphAllowOvershoot) { 
                                var c = false; 
                                if(cp1.y<0||cp1.y>1) {cp1.y=Math.max(0,Math.min(1,cp1.y)); c=true;} 
                                if(cp2.y<0||cp2.y>1) {cp2.y=Math.max(0,Math.min(1,cp2.y)); c=true;} 
                                if(c) {updateGraphUI(); saveGraphState();} 
                            } 
                        } 
                    },
                    { 
                        slider: true, 
                        label: 'Overshoot Speed %', 
                        min: 10, max: 200, 
                        value: (window.graphDragSensitivity !== undefined ? window.graphDragSensitivity : 100), 
                        onInput: function(ev) { window.graphDragSensitivity = parseInt(ev.target.value); } 
                    }
                ]},
                { sep: true },
                { label: 'Apply to keys', sub: [ { label: 'Ease', action: () => window.applyGraphToKeyframesWithCheck('all') }, { label: 'Ease In', action: () => window.applyGraphToKeyframesWithCheck('in') }, { label: 'Ease Out', action: () => window.applyGraphToKeyframesWithCheck('out') } ]},
                { label: 'Apply to expression', action: () => graphJsx(`applyBezierEaseToExpression(${cp1.x}, ${cp1.y}, ${cp2.x}, ${cp2.y})`) },
                { sep: true },
                { label: 'Copy value as', sub: [ { label: 'Bezier', action: () => copyTextToClip(`[${formatCoord(cp1.x)}, ${formatCoord(cp1.y)}, ${formatCoord(cp2.x)}, ${formatCoord(cp2.y)}]`) }, { label: 'CSS', action: () => copyTextToClip(`cubic-bezier(${formatCoord(cp1.x)}, ${formatCoord(cp1.y)}, ${formatCoord(cp2.x)}, ${formatCoord(cp2.y)})`) } ]}
            ]);
        });

        document.getElementById('graph-presets-area').addEventListener('contextmenu', function(e) {
            e.preventDefault(); 
            e.stopPropagation();

            // 1. Identify what was clicked
            const card = e.target.closest('.graph-preset-card');
            const isPresetClick = !!card;
            
            const arr = graphLibraries[activeLibName] || [];
            const libs = Object.keys(graphLibraries);
            const otherLibs = libs.filter(l => l !== activeLibName);
            
            let item = null;
            let idx = -1;

            if (isPresetClick) {
                const allCards = Array.from(document.querySelectorAll('#graph-presets-grid .graph-preset-card'));
                idx = allCards.indexOf(card);
                item = arr[idx];
            }

            // Safe action wrapper: completely prevents execution if clicking empty space
            const check = (fn) => () => { if (isPresetClick) fn(); };

            // 2. Calculate current icon size for slider
            var grid = document.getElementById('graph-presets-grid');
            var currentSize = grid.style.getPropertyValue('--preset-size') || '60px';
            var zoomVal = parseInt(currentSize) || 60;

            // 3. Build the Unified Menu
            showCtxMenu(e.clientX, e.clientY, [
                { slider: true, label: 'Icon Size', min: 45, max: 100, value: zoomVal, onInput: function(ev) { grid.style.setProperty('--preset-size', ev.target.value + 'px'); } },
                { sep: true },
                
                // --- PRESET SPECIFIC OPTIONS (Greyed out if empty space) ---
                { label: 'Rename Preset', disabled: !isPresetClick, action: check(() => window.openGraphRenamePresetModal(idx, item.name)) }, 
                { label: 'Edit Preset Value', disabled: !isPresetClick, action: check(() => window.openGraphEditPresetModal(idx, item.vals)) }, 
                
                { label: 'Copy Preset Value As', disabled: !isPresetClick, sub: [
                    { label: 'Bezier', action: check(() => copyTextToClip(`[${formatCoord(item.vals[0])}, ${formatCoord(item.vals[1])}, ${formatCoord(item.vals[2])}, ${formatCoord(item.vals[3])}]`)) }, 
                    { label: 'CSS', action: check(() => copyTextToClip(`cubic-bezier(${formatCoord(item.vals[0])}, ${formatCoord(item.vals[1])}, ${formatCoord(item.vals[2])}, ${formatCoord(item.vals[3])})`)) }
                ]}, 

                { label: 'Move Preset To', disabled: (!isPresetClick || otherLibs.length === 0), sub: otherLibs.map(l => ({ 
                    label: l, 
                    action: check(() => { graphLibraries[l].push(item); arr.splice(idx, 1); saveGraphLibraries(); renderGraphLibrary(); }) 
                }))},
                
                { label: 'Delete Preset', danger: true, disabled: !isPresetClick, action: check(() => { arr.splice(idx, 1); saveGraphLibraries(); renderGraphLibrary(); })}, 
                
                { sep: true },

                // --- LIBRARY MANAGEMENT (Always active) ---
                { label: 'Manage Library', sub: [ 
                    { label: 'New Library...', action: () => window.openGraphNewLibModal() }, 
                    { label: 'Import Library...', action: () => window.graphImport() }, 
                    { label: 'Export Library...', action: () => window.graphExport() }, 
                    { label: 'Rename Library...', action: () => window.openGraphRenameLibModal() }, 
                    { label: 'Clear Library', danger: true, action: () => window.openClearLibraryModal() }, 
                    { label: 'Delete Library', danger: true, action: () => window.graphDeleteLib() } 
                ]},
                // THE FIX: -4px perfectly balances the left space to match the 6px space on the right
                { label: 'Select Library', sub: libs.map(l => ({ 
                    label: `<span style="display: flex; align-items: center; margin-left: -4px;">` + 
                        (l === activeLibName 
                            ? `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>` 
                            : `<span style="display:inline-block; width:20px;"></span>`) 
                        + l + `</span>`, 
                    action: () => switchGraphLibrary(l) 
                })) }
            ]);
        });

        

        loadGraphLibraries(); buildLibDropdown(); renderGraphLibrary(); updateGraphUI();
    }

    function formatCoord(c) { return c.toFixed(2); }

    function updateGraphUI() {
        if (!graphRoot || graphRoot.clientHeight < 15) return;
        var m = getGraphMetrics(); if (!m.svg || m.drawW <= 0 || m.drawH <= 0) return;
        var maskFade = document.getElementById('grid-fade');
        if (maskFade) { maskFade.setAttribute('cx', m.rawW / 2); maskFade.setAttribute('cy', m.rawH / 2); maskFade.setAttribute('r', Math.max(m.rawW, m.rawH) * 0.55); }
        var gridLines = document.getElementById('bezier-grid-lines');
        if (gridLines) {
            var step = m.drawW / 4; if (step < 5) step = 5; 
            var gridHtml = '', minK_X = Math.floor(-m.offsetX / step), maxK_X = Math.ceil((m.rawW - m.offsetX) / step);
            if (maxK_X - minK_X > 150) { minK_X = 0; maxK_X = 150; }
            for (var k = minK_X; k <= maxK_X; k++) { var lx = m.offsetX + k * step; gridHtml += `<line class="gx-grid" x1="${lx}" y1="0" x2="${lx}" y2="${m.rawH}" stroke-width="1" />`; }
            var zeroY = valToPx(m, 0, 0).y, minK_Y = Math.floor((zeroY - m.rawH) / step), maxK_Y = Math.ceil(zeroY / step); 
            if (maxK_Y - minK_Y > 150) { minK_Y = 0; maxK_Y = 150; }
            for (var j = minK_Y; j <= maxK_Y; j++) { var ly = zeroY - j * step; gridHtml += `<line class="gx-grid" x1="0" y1="${ly}" x2="${m.rawW}" y2="${ly}" stroke-width="1" />`; }
            gridLines.innerHTML = gridHtml;
        }

        var b0 = valToPx(m, 0, 0), b1 = valToPx(m, 1, 1), boundsRect = document.getElementById('bezier-bounds-rect');
        if (boundsRect) { boundsRect.setAttribute('x', b0.x); boundsRect.setAttribute('y', b1.y); boundsRect.setAttribute('width', b1.x - b0.x); boundsRect.setAttribute('height', b0.y - b1.y); }

        var p1 = valToPx(m, cp1.x, cp1.y), p2 = valToPx(m, cp2.x, cp2.y), rp1 = valToPx(m, prevCp1.x, prevCp1.y), rp2 = valToPx(m, prevCp2.x, prevCp2.y), op1 = valToPx(m, olderCp1.x, olderCp1.y), op2 = valToPx(m, olderCp2.x, olderCp2.y);
        document.getElementById('bezier-path').setAttribute('d', `M ${b0.x},${b0.y} C ${p1.x},${p1.y} ${p2.x},${p2.y} ${b1.x},${b1.y}`);
        document.getElementById('bezier-path-ref').setAttribute('d', `M ${b0.x},${b0.y} C ${rp1.x},${rp1.y} ${rp2.x},${rp2.y} ${b1.x},${b1.y}`);
        var oldRefPath = document.getElementById('bezier-path-ref-old'); if (oldRefPath) oldRefPath.setAttribute('d', `M ${b0.x},${b0.y} C ${op1.x},${op1.y} ${op2.x},${op2.y} ${b1.x},${b1.y}`);
        
        var l1 = document.getElementById('bezier-line1'), l2 = document.getElementById('bezier-line2'), h1 = document.getElementById('bezier-handle1'), h2 = document.getElementById('bezier-handle2');
        l1.setAttribute('x1', b0.x); l1.setAttribute('y1', b0.y); l1.setAttribute('x2', p1.x); l1.setAttribute('y2', p1.y);
        l2.setAttribute('x1', b1.x); l2.setAttribute('y1', b1.y); l2.setAttribute('x2', p2.x); l2.setAttribute('y2', p2.y);
        h1.setAttribute('cx', p1.x); h1.setAttribute('cy', p1.y); h2.setAttribute('cx', p2.x); h2.setAttribute('cy', p2.y);
        if (valueDisplay) valueDisplay.textContent = formatCoord(cp1.x) + ", " + formatCoord(cp1.y) + ", " + formatCoord(cp2.x) + ", " + formatCoord(cp2.y);
    }

    var historyAnimId = null;
    function animateHistoryTo(targetCp1, targetCp2) {
        if (historyAnimId) cancelAnimationFrame(historyAnimId);
        var startP1 = { x: prevCp1.x, y: prevCp1.y }, startP2 = { x: prevCp2.x, y: prevCp2.y }, endP1 = { x: targetCp1.x, y: targetCp1.y }, endP2 = { x: targetCp2.x, y: targetCp2.y };
        if (Math.abs(startP1.x - endP1.x) < 0.001 && Math.abs(startP1.y - endP1.y) < 0.001 && Math.abs(startP2.x - endP2.x) < 0.001 && Math.abs(startP2.y - endP2.y) < 0.001) return;
        var startT = null, duration = 300;
        function step(time) {
            if (!startT) startT = time; var p = Math.min((time - startT) / duration, 1), e = 1 - Math.pow(1 - p, 3);
            prevCp1.x = startP1.x + (endP1.x - startP1.x) * e; prevCp1.y = startP1.y + (endP1.y - startP1.y) * e; prevCp2.x = startP2.x + (endP2.x - startP2.x) * e; prevCp2.y = startP2.y + (endP2.y - startP2.y) * e;
            updateGraphUI(); if (p < 1) historyAnimId = requestAnimationFrame(step);
        }
        historyAnimId = requestAnimationFrame(step);
    }

    function animateGraphUpdate(tCp1, tCp2, duration = 350, skipHistory = false) {
        if (!skipHistory) pushGraphHistory(true, null); animateHistoryTo(cp1, cp2);
        var startCp1 = { x: cp1.x, y: cp1.y }, startCp2 = { x: cp2.x, y: cp2.y }, startTime = null;
        function step(time) {
            if (!startTime) startTime = time; var elapsed = time - startTime, p = Math.min(elapsed / duration, 1), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
            cp1.x = startCp1.x + (tCp1.x - startCp1.x) * e; cp1.y = startCp1.y + (tCp1.y - startCp1.y) * e; cp2.x = startCp2.x + (tCp2.x - startCp2.x) * e; cp2.y = startCp2.y + (tCp2.y - startCp2.y) * e;
            updateGraphUI(); if (p < 1) requestAnimationFrame(step); else { saveGraphState(); updateGraphUI(); }
        }
        requestAnimationFrame(step);
    }

    window.applyGraphToKeyframesWithCheck = function(type = 'all') {
        var hasOvershoot = (cp1.y < 0 || cp1.y > 1 || cp2.y < 0 || cp2.y > 1);
        if (hasOvershoot) {
            graphJsx('checkPositionLinkState()', function(res) {
                if (res === 'linked') { window._pendingApplyType = type; var modal = document.getElementById('linked-pos-modal'); if (modal) modal.style.display = 'flex'; }
                else graphJsx(`applyBezierEaseToSelection(${cp1.x}, ${cp1.y}, ${cp2.x}, ${cp2.y}, "${type}")`);
            });
        } else { graphJsx(`applyBezierEaseToSelection(${cp1.x}, ${cp1.y}, ${cp2.x}, ${cp2.y}, "${type}")`); }
    };

    window.linkedPosSkip = function() { document.getElementById('linked-pos-modal').style.display = 'none'; };
    window.linkedPosApplyWithoutOvershoot = function() { window.linkedPosSkip(); var cp = window._graphGetCp(); graphJsx(`linkedPosApplyWithoutOvershoot(${cp.x1}, ${cp.y1}, ${cp.x2}, ${cp.y2}, "${window._pendingApplyType || 'all'}")`); };
    window.linkedPosSeparateAndApply = function() { window.linkedPosSkip(); var cp = window._graphGetCp(); graphJsx(`linkedPosSeparateAndApply(${cp.x1}, ${cp.y1}, ${cp.x2}, ${cp.y2}, "${window._pendingApplyType || 'all'}")`); };

    window.readGraphValues = function() {
        // 🎯 Bypass the .jsx file completely to avoid AE caching bugs!
        var aeScript = "(function(){ try { var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return 'ERROR: No active comp'; var props = comp.selectedProperties; if (!props || props.length === 0) return 'ERROR: No properties selected'; var prop = props[0]; if (!prop.selectedKeys || prop.selectedKeys.length === 0) return 'ERROR: No keyframes selected'; var k = prop.selectedKeys[0]; if ((prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) && prop.dimensionsSeparated) { return 'ERROR: Dimensions are separated'; } var easeOut = prop.keyOutTemporalEase(k)[0]; var easeIn = (k < prop.numKeys) ? prop.keyInTemporalEase(k + 1)[0] : prop.keyInTemporalEase(k)[0]; var x1 = easeOut.influence / 100; var x2 = 1 - (easeIn.influence / 100); var y1 = 0.00; var y2 = 1.00; if (k < prop.numKeys) { var t1 = prop.keyTime(k); var t2 = prop.keyTime(k+1); var v1 = prop.keyValue(k); var v2 = prop.keyValue(k+1); var dx = t2 - t1; var dy = 0; if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) { var sum = 0; for(var i=0; i<v1.length; i++) sum += (v2[i]-v1[i])*(v2[i]-v1[i]); dy = Math.sqrt(sum); } else { var val1 = (typeof v1 === 'number') ? v1 : v1[0]; var val2 = (typeof v2 === 'number') ? v2 : v2[0]; dy = val2 - val1; } var avgSpeed = (dx === 0) ? 0 : Math.abs(dy / dx); if (avgSpeed !== 0) { y1 = (easeOut.speed / avgSpeed) * x1; y2 = 1 - ((easeIn.speed / avgSpeed) * (1 - x2)); } } if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return 'ERROR: Invalid math (NaN)'; return x1.toFixed(2) + ',' + y1.toFixed(2) + ',' + x2.toFixed(2) + ',' + y2.toFixed(2); } catch(e) { return 'ERROR: ' + e.toString(); } })()";

        window.safeEval(aeScript, function(res) {
            if (res === 'EvalScript error.') {
                if(typeof showToast === 'function') showToast("AE Engine Error. Restart After Effects.");
            } else if (res && res.indexOf('ERROR') === 0) {
                if(typeof showToast === 'function') showToast(res.replace('ERROR: ', ''));
            } else if (res && res.indexOf(',') !== -1 && res.split(',').length === 4) { 
                var parts = res.split(','); 
                animateGraphUpdate({ x: parseFloat(parts[0]), y: parseFloat(parts[1]) }, { x: parseFloat(parts[2]), y: parseFloat(parts[3]) }); 
                if(typeof showToast === 'function') showToast("Values read from AE"); 
            } else {
                if(typeof showToast === 'function') showToast("Could not read ease");
            }
        });
    };

    window.openGraphInputModal = function() { var input = document.getElementById('graph-val-input'), modal = document.getElementById('graph-input-modal'); if (input && modal) { input.value = formatCoord(cp1.x) + ", " + formatCoord(cp1.y) + ", " + formatCoord(cp2.x) + ", " + formatCoord(cp2.y); modal.style.display = 'flex'; setTimeout(() => input.select(), 50); } };
    window.closeGraphInputModal = function() { var m = document.getElementById('graph-input-modal'); if(m) m.style.display = 'none'; };
    window.confirmGraphInput = function() { var input = document.getElementById('graph-val-input'); if(!input) return; var v = input.value.split(','); if (v.length === 4) { animateGraphUpdate({ x: Math.max(0, Math.min(1, parseFloat(v[0]))), y: parseFloat(v[1]) }, { x: Math.max(0, Math.min(1, parseFloat(v[2]))), y: parseFloat(v[3]) }); if (window.isAutoGraph) setTimeout(() => window.applyGraphToKeyframesWithCheck(window._activeEaseType), 250); } window.closeGraphInputModal(); };
    window.openGraphSaveModal = function() { var preview = document.getElementById('graph-save-val-preview'), input = document.getElementById('graph-save-input'), modal = document.getElementById('graph-save-modal'); if (preview && input && modal) { preview.textContent = formatCoord(cp1.x) + ", " + formatCoord(cp1.y) + ", " + formatCoord(cp2.x) + ", " + formatCoord(cp2.y); input.value = ''; modal.style.display = 'flex'; setTimeout(() => input.focus(), 50); } };
    window.closeGraphSaveModal = function() { var m = document.getElementById('graph-save-modal'); if(m) m.style.display = 'none'; };
    window.confirmGraphSave = function() { var input = document.getElementById('graph-save-input'); if(!input) return; var name = input.value.trim() || 'Custom'; if (!graphLibraries[activeLibName]) graphLibraries[activeLibName] = []; graphLibraries[activeLibName].push({ name: name, vals: [cp1.x, cp1.y, cp2.x, cp2.y] }); saveGraphLibraries(); renderGraphLibrary(); window.closeGraphSaveModal(); };
    window.openGraphNewLibModal = function() { var input = document.getElementById('graph-newlib-input'), modal = document.getElementById('graph-newlib-modal'); if(input && modal) { input.value = ''; modal.style.display = 'flex'; setTimeout(() => input.focus(), 50); } };
    window.closeGraphNewLibModal = function() { var m = document.getElementById('graph-newlib-modal'); if(m) { m.style.display = 'none'; window._isImportingToNew = false; } };
    window.confirmGraphNewLib = function() { var input = document.getElementById('graph-newlib-input'); if(!input) return; var name = input.value.trim(); if (name && !graphLibraries[name]) { graphLibraries[name] = []; activeLibName = name; saveGraphLibraries(); buildLibDropdown(); switchGraphLibrary(name); window.closeGraphNewLibModal(); if (window._isImportingToNew) { processGraphImportData(name); window._isImportingToNew = false; } } };

    window.openGraphRenamePresetModal = function(idx, name) { window._activePresetIdx = idx; document.getElementById('graph-rename-preset-input').value = name; document.getElementById('graph-rename-preset-modal').style.display = 'flex'; setTimeout(() => document.getElementById('graph-rename-preset-input').select(), 50); };
    window.confirmGraphRenamePreset = function() { var n = document.getElementById('graph-rename-preset-input').value.trim(); if (n && window._activePresetIdx !== undefined) { graphLibraries[activeLibName][window._activePresetIdx].name = n; saveGraphLibraries(); renderGraphLibrary(); } document.getElementById('graph-rename-preset-modal').style.display = 'none'; };
    window.openGraphEditPresetModal = function(idx, vals) { window._activePresetIdx = idx; document.getElementById('graph-edit-preset-input').value = vals.map(formatCoord).join(', '); document.getElementById('graph-edit-preset-modal').style.display = 'flex'; setTimeout(() => document.getElementById('graph-edit-preset-input').select(), 50); };
    window.confirmGraphEditPreset = function() { var valStr = document.getElementById('graph-edit-preset-input').value.split(','); if (valStr.length === 4 && window._activePresetIdx !== undefined) { var newVals = [Math.max(0,Math.min(1,parseFloat(valStr[0]))), parseFloat(valStr[1]), Math.max(0,Math.min(1,parseFloat(valStr[2]))), parseFloat(valStr[3])]; if (!isNaN(newVals[0]) && !isNaN(newVals[1]) && !isNaN(newVals[2]) && !isNaN(newVals[3])) { graphLibraries[activeLibName][window._activePresetIdx].vals = newVals; saveGraphLibraries(); renderGraphLibrary(); } } document.getElementById('graph-edit-preset-modal').style.display = 'none'; };
    window.openGraphRenameLibModal = function() { document.getElementById('graph-renamelib-input').value = activeLibName; document.getElementById('graph-renamelib-modal').style.display = 'flex'; setTimeout(() => document.getElementById('graph-renamelib-input').select(), 50); };
    window.confirmGraphRenameLib = function() { var n = document.getElementById('graph-renamelib-input').value.trim(); if (n && n !== activeLibName && !graphLibraries[n]) { graphLibraries[n] = graphLibraries[activeLibName]; delete graphLibraries[activeLibName]; activeLibName = n; saveGraphLibraries(); buildLibDropdown(); switchGraphLibrary(activeLibName); } document.getElementById('graph-renamelib-modal').style.display = 'none'; };

    function loadGraphLibraries() {
        var defaultBasicLibrary = [ { name: "Easy Ease", vals: [0.33, 0.00, 0.67, 1.00] }, { name: "Ease In", vals: [0.33, 0.00, 1.00, 1.00] }, { name: "Ease Out", vals: [0.00, 0.00, 0.67, 1.00] } ];
        var defaultFlowLibrary = [ { name: "linear", vals: [0.00, 0.00, 1.00, 1.00] }, { name: "easeIn", vals: [0.42, 0.00, 1.00, 1.00] }, { name: "easeOut", vals: [0.00, 0.00, 0.58, 1.00] }, { name: "ease", vals: [0.33, 0.00, 0.67, 1.00] }, { name: "sineIn", vals: [0.36, 0.00, 0.64, 0.48] }, { name: "sineOut", vals: [0.33, 0.52, 0.64, 1.00] }, { name: "sine", vals: [0.36, 0.00, 0.63, 1.00] }, { name: "quadIn", vals: [0.26, 0.00, 0.60, 0.20] }, { name: "quadOut", vals: [0.40, 0.80, 0.74, 1.00] }, { name: "quad", vals: [0.48, 0.04, 0.52, 0.96] }, { name: "cubicIn", vals: [0.40, 0.00, 0.68, 0.06] }, { name: "cubicOut", vals: [0.32, 0.94, 0.60, 1.00] }, { name: "cubic", vals: [0.66, 0.00, 0.34, 1.00] }, { name: "quartIn", vals: [0.52, 0.00, 0.74, 0.00] }, { name: "quartOut", vals: [0.26, 1.00, 0.48, 1.00] }, { name: "quart", vals: [0.76, 0.00, 0.24, 1.00] }, { name: "quintIn", vals: [0.64, 0.00, 0.78, 0.00] }, { name: "quintOut", vals: [0.22, 1.00, 0.36, 1.00] }, { name: "quint", vals: [0.86, 0.00, 0.14, 1.00] }, { name: "expoIn", vals: [0.66, 0.00, 0.86, 0.00] }, { name: "expoOut", vals: [0.14, 1.00, 0.34, 1.00] }, { name: "expo", vals: [0.90, 0.00, 0.10, 1.00] }, { name: "circIn", vals: [0.54, 0.00, 1.00, 0.44] }, { name: "circOut", vals: [0.00, 0.56, 0.46, 1.00] }, { name: "circ", vals: [0.88, 0.14, 0.12, 0.86] }, { name: "backIn", vals: [0.60, -0.28, 0.73, 0.04] }, { name: "backOut", vals: [0.17, 0.89, 0.32, 1.27] }, { name: "back", vals: [0.68, -0.55, 0.27, 1.55] } ];
        var saved = localStorage.getItem('ultGraphLibsV2');
        if (saved) { try { graphLibraries = JSON.parse(saved); if (!graphLibraries["Flow"]) graphLibraries["Flow"] = defaultFlowLibrary; if (!graphLibraries["Default"]) graphLibraries["Default"] = defaultBasicLibrary; saveGraphLibraries(); } catch(e) {} } else { graphLibraries = { "Default": defaultBasicLibrary, "Flow": defaultFlowLibrary }; var old = localStorage.getItem('ultGraphLibrary'); if (old) { try { var parsedOld = JSON.parse(old); if (parsedOld && parsedOld.length > 0) graphLibraries["Default"] = parsedOld; } catch(e){} } saveGraphLibraries(); }
        if (!activeLibName || !graphLibraries[activeLibName]) activeLibName = "Default";
    }

    function saveGraphLibraries() { localStorage.setItem('ultGraphLibsV2', JSON.stringify(graphLibraries)); }
    function switchGraphLibrary(name) { if (!graphLibraries[name]) return; activeLibName = name; libSelect.value = name; libSelect.dispatchEvent(new Event('change')); renderGraphLibrary(); }
    function buildLibDropdown() { 
        libSelect.innerHTML = ''; 
        Object.keys(graphLibraries).forEach((name, index) => { 
            var opt = document.createElement('option'); 
            opt.value = name; 
            opt.textContent = name; // Removed the numbering here
            if (name === activeLibName) opt.selected = true; 
            libSelect.appendChild(opt); 
        }); 
        if (window.buildCustomDropdown) window.buildCustomDropdown('graph-lib-select'); 
    }
    
    libSelect.addEventListener('change', function(e) { 
        activeLibName = e.target.value; 
        renderGraphLibrary(); 
        // Deleted the checkDropdownSquish trigger here
    });

    function drawMiniSVG(v) {
        var p = 5, w = 35, h = 35, p0x = p, p0y = h+p, p3x = w+p, p3y = p, p1x = p + v[0]*w, p1y = (h+p) - v[1]*h, p2x = p + v[2]*w, p2y = (h+p) - v[3]*h;
        var minY = Math.min(0, v[1], v[3]), maxY = Math.max(1, v[1], v[3]), boxTop = 40 - maxY * 35 - 5, boxBottom = 40 - minY * 35 + 5, boxHeight = boxBottom - boxTop;
        
        // Added specific classes to paths and circles so our JS engine can grab them instantly
        return `<svg viewBox="0 ${boxTop} 45 ${boxHeight}" width="100%" height="100%" style="overflow:visible; display:block;">
            <line class="mg-l1 gx-thumb-arm" x1="${p0x}" y1="${p0y}" x2="${p1x}" y2="${p1y}" stroke-width="2" stroke-linecap="round"/>
            <line class="mg-l2 gx-thumb-arm" x1="${p3x}" y1="${p3y}" x2="${p2x}" y2="${p2y}" stroke-width="2" stroke-linecap="round"/>
            <path class="mg-p gx-curve" d="M ${p0x},${p0y} C ${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}" fill="none" stroke-width="2" stroke-linecap="round"/>
            <circle class="mg-c1 gx-thumb-dot" cx="${p1x}" cy="${p1y}" r="2.5" stroke-width="1.5" />
            <circle class="mg-c2 gx-thumb-dot" cx="${p2x}" cy="${p2y}" r="2.5" stroke-width="1.5" />
        </svg>`;
    }

    // THE FIX: Hover Animation Engine (Updates SVG coordinates directly without CSS lag)
    function updateMiniSVG(card, v) {
        var p = 5, w = 35, h = 35, p0x = p, p0y = h+p, p3x = w+p, p3y = p;
        var p1x = p + v[0]*w, p1y = (h+p) - v[1]*h;
        var p2x = p + v[2]*w, p2y = (h+p) - v[3]*h;

        var path = card.querySelector('.mg-p');
        var c1 = card.querySelector('.mg-c1');
        var c2 = card.querySelector('.mg-c2');
        var l1 = card.querySelector('.mg-l1');
        var l2 = card.querySelector('.mg-l2');

        if (path) path.setAttribute('d', `M ${p0x},${p0y} C ${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`);
        if (c1) { c1.setAttribute('cx', p1x); c1.setAttribute('cy', p1y); }
        if (c2) { c2.setAttribute('cx', p2x); c2.setAttribute('cy', p2y); }
        if (l1) { l1.setAttribute('x2', p1x); l1.setAttribute('y2', p1y); }
        if (l2) { l2.setAttribute('x2', p2x); l2.setAttribute('y2', p2y); }
    }

    // THE FIX: Continuous smooth sine-wave loop WITH pause delay and Easy Ease
    function startCardAnim(card, origVals) {
        card._animating = true;
        if (card._theta === undefined) card._theta = 0;
        card._isPaused = false; 
        
        // ⚙️ EDIT THESE TO CHANGE ANIMATION FEEL
        var speed = 0.020;           // Speed of the morph
        var loopDelaySeconds = 0.2;  // Time to pause between loops
        
        var linearVals = [0.0, 0.0, 1.0, 1.0];

        function step() {
            if (card._isPaused) {
                if (!card._isHovered) {
                    card._animating = false;
                    card._isPaused = false;
                    clearTimeout(card._pauseTimeout);
                    return; 
                }
                requestAnimationFrame(step);
                return;
            }

            if (card._isHovered) {
                card._theta += speed;
                
                if (card._theta >= Math.PI * 2) {
                    card._theta = 0; 
                    card._isPaused = true; 
                    
                    card._pauseTimeout = setTimeout(() => {
                        card._isPaused = false;
                    }, loopDelaySeconds * 1000);
                }
            } else {
                if (card._theta > 0) {
                    card._theta += speed;
                    if (card._theta >= Math.PI * 2) {
                        card._theta = 0;
                        card._animating = false; 
                    }
                } else {
                    card._animating = false;
                }
            }

            // 1. Base Sine Wave (Standard Ease In/Out)
            var baseBlend = (1 - Math.cos(card._theta)) / 2;

            // 2. THE FIX: Apply "Easy Ease" (Smoothstep) to exaggerate the slow start/end
            var easyEaseBlend = baseBlend * baseBlend * (3 - 2 * baseBlend);

            var currVals = [
                origVals[0] + (linearVals[0] - origVals[0]) * easyEaseBlend,
                origVals[1] + (linearVals[1] - origVals[1]) * easyEaseBlend,
                origVals[2] + (linearVals[2] - origVals[2]) * easyEaseBlend,
                origVals[3] + (linearVals[3] - origVals[3]) * easyEaseBlend
            ];

            updateMiniSVG(card, currVals);

            if (card._animating) {
                requestAnimationFrame(step);
            }
        }
        requestAnimationFrame(step);
    }

    function renderGraphLibrary() {
        if (!presetsGrid) return; presetsGrid.innerHTML = ''; var arr = graphLibraries[activeLibName] || [];
        
        // ⚙️ EDIT THIS TO CHANGE HOVER DELAY
        var hoverDelaySeconds = 0.2; 

        arr.forEach(function(item, idx) {
            var card = document.createElement('div'); card.className = 'graph-preset-card'; card.innerHTML = `<div class="graph-preset-svg-wrap">${drawMiniSVG(item.vals)}</div><div class="graph-preset-label">${item.name}</div>`;
            
            // Hover Events with Delay Tracker
            card.addEventListener('mouseenter', function() {
                card._isHovered = true;
                if (card._hoverTimeout) clearTimeout(card._hoverTimeout);
                card._hoverTimeout = setTimeout(function() {
                    if (card._isHovered && !card._animating) {
                        startCardAnim(card, item.vals);
                    }
                }, hoverDelaySeconds * 1000); 
            });
            
            card.addEventListener('mouseleave', function() {
                card._isHovered = false;
                if (card._hoverTimeout) {
                    clearTimeout(card._hoverTimeout);
                    card._hoverTimeout = null;
                }
            });

            card.addEventListener('click', function() { animateGraphUpdate({x: item.vals[0], y: item.vals[1]}, {x: item.vals[2], y: item.vals[3]}); if (window.isAutoGraph) setTimeout(() => window.applyGraphToKeyframesWithCheck(window._activeEaseType), 350); });
            
            // NOTE: The contextmenu listener has been completely removed from here!
            
            presetsGrid.appendChild(card);
        });
    }

    window.openClearLibraryModal = function() { var m = document.getElementById('clear-lib-modal'); if(m) m.style.display = 'flex'; };
    window.executeGraphClear = function() { var m = document.getElementById('clear-lib-modal'); if(m) m.style.display = 'none'; graphLibraries[activeLibName] = []; saveGraphLibraries(); renderGraphLibrary(); };
    window.graphDeleteLib = function() { var libs = Object.keys(graphLibraries); if (libs.length <= 1) { if(typeof showToast === 'function') showToast("Cannot delete the last library."); return; } var nameEl = document.getElementById('delete-lib-name'), modal = document.getElementById('delete-lib-modal'); if(nameEl && modal) { nameEl.textContent = activeLibName; modal.style.display = 'flex'; } };
    window.executeGraphDeleteLib = function() { var m = document.getElementById('delete-lib-modal'); if(m) m.style.display = 'none'; delete graphLibraries[activeLibName]; activeLibName = Object.keys(graphLibraries)[0]; saveGraphLibraries(); buildLibDropdown(); switchGraphLibrary(activeLibName); if(typeof showToast === 'function') showToast("Library deleted"); };
    
    window.graphExport = function() { if (typeof window !== 'undefined' && window.cep && window.cep.fs) { var result = window.cep.fs.showSaveDialogEx("Export Curve Libraries", "", ["json"], activeLibName + ".json", ""); if (result.data) { window.cep.fs.writeFile(result.data, JSON.stringify(graphLibraries, null, 2)); showToast("Curves exported!"); } } };
    
    window._pendingImportData = null; window._pendingImportFileName = ""; window._isImportingToNew = false;
    window.graphImport = function() {
        if (typeof window !== 'undefined' && window.cep && window.cep.fs) {
            var result = window.cep.fs.showOpenDialogEx(false, false, "Import Curve Libraries", "", ["json", "flow"], "");
            if (result.data && result.data.length > 0) {
                var filePath = result.data[0], content = window.cep.fs.readFile(filePath).data;
                try {
                    var parsed = JSON.parse(content), isFlow = Array.isArray(parsed) && parsed.length > 0 && parsed[0].value, isJson = typeof parsed === 'object' && !Array.isArray(parsed);
                    if (isFlow || isJson) { window._pendingImportData = { parsed: parsed, isFlow: isFlow, isJson: isJson }; window._pendingImportFileName = filePath.substring(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1).replace(/\.[^/.]+$/, ""); document.getElementById('import-lib-target-name').textContent = activeLibName; document.getElementById('import-choice-modal').style.display = 'flex'; }
                } catch(e) { showToast("Invalid curve file"); }
            }
        }
    };

    window.executeGraphImportToCurrent = function() { document.getElementById('import-choice-modal').style.display = 'none'; processGraphImportData(activeLibName); };
    window.executeGraphImportToNew = function() { document.getElementById('import-choice-modal').style.display = 'none'; window._isImportingToNew = true; document.getElementById('graph-newlib-input').value = window._pendingImportFileName; document.getElementById('graph-newlib-modal').style.display = 'flex'; setTimeout(() => document.getElementById('graph-newlib-input').select(), 50); };

    function processGraphImportData(targetLib) {
        if (!window._pendingImportData) return;
        var parsed = window._pendingImportData.parsed, isFlow = window._pendingImportData.isFlow, isJson = window._pendingImportData.isJson;
        if (!graphLibraries[targetLib]) graphLibraries[targetLib] = [];
        if (isFlow) { parsed.forEach(function(item) { if (item.name && item.value && item.value.length === 4) { var v = item.value; graphLibraries[targetLib].push({ name: item.name, vals: [Math.max(0, Math.min(1, parseFloat(v[0]))), parseFloat(v[1]), Math.max(0, Math.min(1, parseFloat(v[2]))), parseFloat(v[3])] }); } }); } 
        else if (isJson) { Object.keys(parsed).forEach(k => { graphLibraries[targetLib] = graphLibraries[targetLib].concat(parsed[k]); }); }
        activeLibName = targetLib; saveGraphLibraries(); buildLibDropdown(); switchGraphLibrary(targetLib); showToast("Curves imported successfully!"); window._pendingImportData = null;
    }

    function showCtxMenu(x, y, items) {
        var old = document.getElementById('dynamic-ctx-menu'); if (old) old.remove();
        var menu = document.createElement('div'); menu.className = 'ctx-menu'; menu.id = 'dynamic-ctx-menu';
        buildMenuDom(items, menu); window.repositionMenu(menu, x, y); setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 50);
    }

    function buildMenuDom(items, parent) {
        items.forEach(it => {
            if (it.sep) { 
                var s = document.createElement('div'); s.className = 'ctx-sep'; parent.appendChild(s); 
            } else if (it.slider) {
                var d = document.createElement('div'); 
                d.style.padding = '6px 18px 6px 12px'; d.style.margin = '1px 0'; d.style.borderRadius = '6px';
                d.style.display = 'flex'; d.style.flexDirection = 'column'; d.style.alignItems = 'flex-start';
                d.style.color = 'var(--rfx-text-1)'; d.style.cursor = 'default';
                d.style.minWidth = '160px'; // NEW: Forces the menu to stay wide enough to look good
                
                var label = document.createElement('span'); label.textContent = it.label; label.style.marginBottom = '6px'; label.style.fontSize = '11px'; label.style.color = 'var(--text-secondary)';
                var input = document.createElement('input'); input.type = 'range'; input.className = 'main-slider'; input.min = it.min; input.max = it.max; input.value = it.value; input.style.width = '100%'; input.style.margin = '0';
                input.addEventListener('input', it.onInput);
                
                d.appendChild(label); d.appendChild(input);
                d.addEventListener('click', e => e.stopPropagation()); 
                parent.appendChild(d);
            } else if (it.toggle) {
                var d = document.createElement('div'); 
                d.style.padding = '6px 18px 6px 12px'; d.style.margin = '1px 0'; d.style.borderRadius = '6px';
                d.style.display = 'flex'; d.style.justifyContent = 'space-between'; d.style.alignItems = 'center';
                d.style.color = 'var(--rfx-text-1)'; d.style.cursor = 'default';
                d.style.minWidth = '160px'; // NEW: Forces the menu to stay wide enough to look good
                
                var label = document.createElement('span'); label.textContent = it.label;
                
                var toggleWrapper = document.createElement('label'); toggleWrapper.className = 'switch'; toggleWrapper.style.margin = '0'; toggleWrapper.style.pointerEvents = 'none'; 
                var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = it.checked;
                var sliderSpan = document.createElement('span'); sliderSpan.className = 'slider';
                
                toggleWrapper.appendChild(checkbox); toggleWrapper.appendChild(sliderSpan);
                d.appendChild(label); d.appendChild(toggleWrapper);
                
                d.addEventListener('click', e => { 
                    e.stopPropagation(); 
                    checkbox.checked = !checkbox.checked; 
                    it.onChange(checkbox.checked); 
                });
                parent.appendChild(d);
            } else {
                var d = document.createElement('div'); 
                d.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.sub && it.sub.length ? ' ctx-has-sub' : '');
                
                // THE FIX: Set up Flexbox to cleanly push the > icon to the far right
                d.style.display = 'flex';
                d.style.justifyContent = 'space-between';
                d.style.alignItems = 'center';
                
                // Wrap text in a span
                var textSpan = document.createElement('span');
                textSpan.innerHTML = it.label;
                d.appendChild(textSpan);
                
                // THE FIX: Add the SVG Chevron. By using "currentColor", it perfectly inherits the grey disabled state!
                if (it.sub && it.sub.length) {
                    var arrowSpan = document.createElement('span');
                    
                    // Added display:flex to kill the invisible text baseline gap
                    arrowSpan.style.display = 'flex';
                    arrowSpan.style.alignItems = 'center';
                    
                    arrowSpan.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-left: 12px;"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
                    d.appendChild(arrowSpan);
                }

                if (it.disabled) { d.style.opacity = '0.4'; d.style.pointerEvents = 'none'; d.style.cursor = 'default'; }
                
                if (it.sub && it.sub.length) {
                    var subMenu = document.createElement('div'); subMenu.className = 'ctx-sub'; buildMenuDom(it.sub, subMenu); d.appendChild(subMenu);
                    
                    var hideTimeout;
                    
                    d.addEventListener('mouseenter', function() { 
                        clearTimeout(hideTimeout);
                        
                        // Prevents multiple submenus from overlapping if you move fast
                        Array.from(parent.children).forEach(child => {
                            if (child !== d && child.classList.contains('ctx-has-sub')) {
                                var siblingSub = child.querySelector('.ctx-sub');
                                if (siblingSub) siblingSub.style.display = 'none';
                            }
                        });

                        subMenu.style.display = 'block'; 
                        subMenu.style.left = '100%'; 
                        subMenu.style.right = 'auto'; 
                        subMenu.style.top = '-7px'; 
                        subMenu.style.bottom = 'auto'; 
                        
                        var rect = d.getBoundingClientRect(), subRect = subMenu.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight; 
                        
                        if (rect.right + subRect.width > vw) { 
                            if (rect.left - subRect.width > 0) { subMenu.style.left = 'auto'; subMenu.style.right = '100%'; } 
                            else { subMenu.style.left = 'auto'; subMenu.style.right = '-' + (vw - rect.right - 4) + 'px'; } 
                        } 
                        
                        var visualBottom = rect.top - 7 + subRect.height;
                        if (visualBottom > vh) { 
                            var overflow = visualBottom - vh + 8; 
                            subMenu.style.top = (-7 - overflow) + 'px'; 
                        } 
                    });
                    
                    // THE FIX: Add a 300ms grace period so you can move the mouse diagonally without it vanishing!
                    d.addEventListener('mouseleave', function() { 
                        hideTimeout = setTimeout(() => {
                            subMenu.style.display = 'none'; 
                        }, 300); 
                    }); 
                    
                    d.addEventListener('click', e => e.stopPropagation());
                } else if (it.action && !it.disabled) { d.addEventListener('click', () => { closeCtxMenu(); it.action(); }); }
                parent.appendChild(d);
            }
        });
    }

    function closeCtxMenu() { var old = document.getElementById('dynamic-ctx-menu'); if (old) old.remove(); }
    function copyTextToClip(text) { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast("Copied to clipboard!"); }

    window.addEventListener('tabSwitched', (e) => { if (e.detail === 'tab-graph') setTimeout(initGraph, 10); });
    
    // Auto Fix scrollbar & Restructure DOM for Wide Layout
    function fixGraphScrollbar() {
        var presetsArea = document.getElementById('graph-presets-area');
        if (presetsArea && presetsArea.classList.contains('scrollable-content')) {
            var panelBox = presetsArea.querySelector('.panel-box'), grid = document.getElementById('graph-presets-grid');
            if (panelBox && grid) {
                presetsArea.classList.remove('scrollable-content'); presetsArea.style.display = 'flex'; presetsArea.style.flexDirection = 'column'; presetsArea.style.overflow = 'hidden';
                panelBox.style.display = 'flex'; panelBox.style.flexDirection = 'column'; panelBox.style.flex = '1'; panelBox.style.minHeight = '0';
                var gridWrapper = document.createElement('div'); gridWrapper.className = 'scrollable-content'; gridWrapper.style.flex = '1'; gridWrapper.style.paddingRight = '4px'; gridWrapper.style.marginRight = '-4px';
                grid.parentNode.insertBefore(gridWrapper, grid); gridWrapper.appendChild(grid);
            }
        }
        
        // THE FIX: Move the Apply bar inside the main container safely so CSS Grid can perfectly control it
        var tabGraph = document.getElementById('tab-graph');
        var flexCont = tabGraph ? tabGraph.querySelector('.flex-column-container') : null;
        var bottomBar = tabGraph ? tabGraph.querySelector('.fixed-bottom') : null;
        if (flexCont && bottomBar && bottomBar.parentNode === tabGraph) {
            flexCont.appendChild(bottomBar);
        }
    }
    
    document.addEventListener('DOMContentLoaded', () => { 
        var btn = document.getElementById('html-auto-btn');
        if (btn && window.isAutoGraph) btn.classList.add('active');
        if (document.getElementById('tab-graph') && document.getElementById('tab-graph').classList.contains('active')) setTimeout(initGraph, 10); 
        fixGraphScrollbar(); 
    });

    // THE FIX: Observer for Graph Canvas resizing
    var _resizeTimer;
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => { 
            if (_resizeTimer) cancelAnimationFrame(_resizeTimer);
            _resizeTimer = requestAnimationFrame(() => {
                var graphRoot = document.getElementById('graph-editor-area');
                if (graphRoot && graphRoot.clientHeight >= 15) updateGraphUI(); 
            });
        }).observe(document.getElementById('tab-graph'));
    }

    // 🎯 NEW: Observe the button's specific parent row to accurately detect squishing
    var applyBtn = document.getElementById('graphApplyBtn');
    if (applyBtn && applyBtn.parentElement && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver((entries) => {
            var parentW = entries[0].contentRect.width;
            
            // If the row gets smaller than 240px, there isn't enough room for the word "Apply"
            if (parentW < 220) { 
                if (applyBtn.innerHTML.indexOf('svg') === -1) {
                    applyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"><path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/></svg>';
                }
            } else {
                if (applyBtn.innerHTML.indexOf('svg') !== -1) {
                    applyBtn.textContent = 'Apply';
                }
            }
        }).observe(applyBtn.parentElement);
    }

    window.checkDropdownSquish = function() {
        var presetHeader = document.querySelector('#graph-presets-area .panel-box > div:first-child');
        var select = document.getElementById('graph-lib-select');
        if (!presetHeader || !select || typeof graphLibraries === 'undefined') return;
        
        var libs = Object.keys(graphLibraries);
        var selectedIdx = select.selectedIndex > -1 ? select.selectedIndex : 0;
        
        var currentLibName = libs[selectedIdx] || "";
        var fullText = currentLibName; // Removed numbering here
        
        // 1. Get exact pixel width of the text
        var ruler = document.getElementById('exact-text-ruler');
        if (!ruler) {
            ruler = document.createElement('div');
            ruler.id = 'exact-text-ruler';
            ruler.style.position = 'fixed'; 
            ruler.style.top = '-9999px';
            ruler.style.left = '-9999px';
            ruler.style.visibility = 'hidden';
            ruler.style.whiteSpace = 'nowrap';
            ruler.style.pointerEvents = 'none';
            document.body.appendChild(ruler);
        }
        
        var displayEl = presetHeader.querySelector('.custom-select-display') || select;
        var st = window.getComputedStyle(displayEl);
        ruler.style.fontFamily = st.fontFamily;
        ruler.style.fontSize = st.fontSize;
        ruler.style.fontWeight = st.fontWeight;
        ruler.style.letterSpacing = st.letterSpacing;
        ruler.textContent = fullText;
        
        var textWidth = ruler.getBoundingClientRect().width;
        
        // 2. Measure the physical width of the DROPDOWN BOX itself
        var dropdownWidth = displayEl.getBoundingClientRect().width;
        
        // 3. The space taken up inside the dropdown by padding and the arrow icon (~32px)
        var reservedInternalSpace = 32;
        var DESIRED_GAP = 0;
        
        var isSquished = dropdownWidth < (textWidth + reservedInternalSpace + DESIRED_GAP);
        
        Array.from(select.options).forEach((opt, idx) => {
            var libName = libs[idx];
            // Removed numbering here as well
            opt.textContent = isSquished ? libName.substring(0, 3) + "..." : libName; 
        });
        
        if (presetHeader.querySelector('.custom-select-display')) {
            presetHeader.querySelector('.custom-select-display').textContent = isSquished ? fullText.substring(0, 3) + "..." : fullText;
        }
    };

    var presetHeaderNode = document.querySelector('#graph-presets-area .panel-box > div:first-child');
    if (presetHeaderNode && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            if (window.checkDropdownSquish) window.checkDropdownSquish();
        }).observe(presetHeaderNode);
    }
})();

// DYNAMIC DROPDOWN DIRECTION FOR GRAPH TAB
document.addEventListener('click', function(e) {
    const presetsArea = document.getElementById('graph-presets-area');
    const display = e.target.closest('#tab-graph .custom-select-display');
    
    // If we click anywhere else, make sure the z-index resets
    if (!display) {
        if (presetsArea) presetsArea.classList.remove('dropdown-active');
        return;
    }
    
    const wrapper = display.closest('.custom-select-wrapper');
    if (!wrapper || !presetsArea) return;
    
    // Wait 15ms to let the global script add the 'open' class
    setTimeout(() => {
        if (wrapper.classList.contains('open') || wrapper.classList.contains('active')) {
            // 1. Elevate the container so it floats over the graph area
            presetsArea.classList.add('dropdown-active');
            
            // 2. Measure exact space above and below the button
            const rect = wrapper.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            
            // 3. Open in whichever direction has more pixels
            if (spaceAbove > spaceBelow) {
                wrapper.classList.add('open-up');
            } else {
                wrapper.classList.remove('open-up');
            }
        } else {
            // Reset when closed
            presetsArea.classList.remove('dropdown-active');
            wrapper.classList.remove('open-up');
        }
    }, 15);
    
}, true); // <--- THE MAGIC FIX: 'true' forces this to run before any other script can block it!

// UNIFIED GRAPH DROPDOWN ENGINE (Direction + Elevation)
document.addEventListener('pointerdown', function(e) {
    const presetsArea = document.getElementById('graph-presets-area');
    const wrapper = e.target.closest('#tab-graph .custom-select-wrapper');
    
    // 1. If clicking outside the dropdown (like on the resizer), reset and tuck it away
    if (!wrapper) {
        if (presetsArea) presetsArea.classList.remove('dropdown-active');
        return;
    }

    // 2. Elevate the container so the dropdown can bleed over the bottom bar
    if (presetsArea) presetsArea.classList.add('dropdown-active');

    // 3. Measure physical window space
    const wrapperRect = wrapper.getBoundingClientRect();
    const spaceBelow = window.innerHeight - wrapperRect.bottom;
    const spaceAbove = wrapperRect.top;

    // 4. BIAS LOGIC: Only flip up if space below is critically tight (< 160px)
    if (spaceBelow < 160 && spaceAbove > spaceBelow) {
        wrapper.classList.add('drop-up');
        wrapper.classList.remove('open-up'); // Nuke the old ghost class just in case
    } else {
        wrapper.classList.remove('drop-up');
        wrapper.classList.remove('open-up'); // Nuke the old ghost class just in case
    }
}, true);