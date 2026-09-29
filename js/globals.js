// Exposed on window so all tab scripts can access it directly
let csInterface = null;
try { 
    csInterface = new CSInterface();
    window.csInterface = csInterface;
} catch (e) { 
    console.warn("CSInterface not loaded."); 
}

window._activeEaseType = 'all';
window.isAutoGraph = false;
window.isDraggingTab = false;

window.safeEval = function(scriptStr, callback) {
    if (!csInterface) {
        console.warn("Cannot talk to After Effects.");
        return;
    }
    csInterface.evalScript(scriptStr, function(result) {
        if (result === "EvalScript error.") {
            console.error("Backend Error on command: " + scriptStr);
        }
        if (callback) callback(result);
    });
};

/* Per-tab ExtendScript loader. Each tab creates one for its own jsx file:
       const fooJsx = window.createJsxLoader('foo.jsx');
       fooJsx('fooDoSomething()', callback);
   The file is read from <extension root>/jsx/ and evaluated once per session in the
   global ExtendScript scope (same eval(decodeURIComponent(...)) technique the caption
   tab uses). Every call waits for that load; callbacks receive exactly what
   evalScript returns. If loading fails, the next call tries again. */
window.createJsxLoader = function(fileName) {
    let loaded = null;   // Promise<boolean> once a load has started

    function readSource() {
        let root = csInterface.getSystemPath(SystemPath.EXTENSION) || '';
        if (root.indexOf('file:') === 0) {
            root = root.replace(/^file:\/*/, '');
            try { root = decodeURIComponent(root); } catch (e) {}
            if (!/^[A-Za-z]:/.test(root)) root = '/' + root;
        }
        const file = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/jsx/' + fileName;
        if (window.cep && window.cep.fs) {
            const r = window.cep.fs.readFile(file, window.cep.encoding.UTF8);
            if (r && r.err === window.cep.fs.NO_ERROR && r.data) return r.data;
        }
        if (typeof require === 'function') return require('fs').readFileSync(file, 'utf8');
        throw new Error('cannot read ' + file);
    }

    function ensureLoaded() {
        if (loaded) return loaded;
        loaded = new Promise(function(resolve) {
            let src;
            try { src = readSource(); }
            catch (e) { console.error('[' + fileName + '] ' + e.message); resolve(false); return; }
            const wrapper = 'eval(decodeURIComponent("' + encodeURIComponent(src) + '"));"JSX_LOADED"';
            csInterface.evalScript(wrapper, function(r) {
                if (r !== 'JSX_LOADED') console.error('[' + fileName + '] failed to load: ' + r);
                resolve(r === 'JSX_LOADED');
            });
        }).then(function(ok) { if (!ok) loaded = null; return ok; });
        return loaded;
    }

    return function(script, callback) {
        if (!csInterface) { console.warn("Cannot talk to After Effects."); return; }
        ensureLoaded().then(function() { window.safeEval(script, callback); });
    };
};

window.repositionMenu = function(menuEl, x, y) {
    menuEl.style.visibility = 'hidden'; 
    menuEl.style.display = 'block';
    if (!menuEl.parentNode) document.body.appendChild(menuEl);
    var vw = window.innerWidth, vh = window.innerHeight;
    var mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    if (x + mw > vw) x = vw - mw - 4;
    if (y + mh > vh) y = vh - mh - 4;
    menuEl.style.left = Math.max(4, x) + 'px'; 
    menuEl.style.top  = Math.max(4, y) + 'px';
    menuEl.style.visibility = 'visible';
};

document.addEventListener('contextmenu', e => e.preventDefault());

window.switchTab = function(tabId) {
    if (window.isDraggingTab) return; 
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const targetTab = document.getElementById(tabId);
    const targetBtn = document.getElementById('btn-' + tabId);
    if (targetTab && targetBtn) {
        targetTab.classList.add('active'); 
        targetBtn.classList.add('active');
        targetBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        // Dispatch custom event for tabs that need refresh logic
        window.dispatchEvent(new CustomEvent('tabSwitched', { detail: tabId }));
    }
};

window.switchTabOffset = function(offset) {
    const tabs = Array.from(document.querySelectorAll('.tab-btn'));
    let activeIdx = tabs.findIndex(t => t.classList.contains('active'));
    if (activeIdx === -1) activeIdx = 0;
    let newIdx = (activeIdx + offset + tabs.length) % tabs.length;
    window.switchTab(tabs[newIdx].id.replace('btn-', ''));
};

function initDraggableTabs() {
    const container = document.querySelector('.tabs-header');
    let draggedItem = null, startX = 0, currentX = 0, siblings = [], startIndex = 0, currentIndex = 0, shiftAmount = 0;
    let startScrollLeft = 0, lastPointerX = 0, dragHomeLeft = 0;
    let edgeScrollRAF = null, edgeScrollDir = 0, edgeScrollSpeed = 0;

    const EDGE_ZONE = 45;      // px from each edge where auto-scroll kicks in
    const EDGE_MAX_SPEED = 6;  // px/frame ceiling; deeper into the zone = closer to this
    const EDGE_MIN_SPEED = 0.6;// px/frame at the very inner edge of the zone

    // Clamp the dragged tab so it can't be pulled past the container's visible bounds.
    // Returns the clamped X for the VISUAL transform (walled to the padded content box).
    function clampX(rawX) {
        const cRect = container.getBoundingClientRect();
        const cs = getComputedStyle(container);
        const padL = parseFloat(cs.paddingLeft) || 0;
        // Right padding is faked via an ::after spacer, so computed paddingRight reads 0.
        // Mirror the left gap for a symmetric wall matching the resting position.
        const padR = padL;
        const homeNow = dragHomeLeft - (container.scrollLeft - startScrollLeft);
        const minX = (cRect.left + padL) - homeNow;
        const maxX = (cRect.right - padR) - draggedItem.offsetWidth - homeNow;
        return Math.max(minX, Math.min(maxX, rawX));
    }

    function applyDragTransform() {
        // rawX = true pointer-anchored position (may exceed the wall).
        const rawX = (lastPointerX - startX) + (container.scrollLeft - startScrollLeft);
        currentX = clampX(rawX);
        draggedItem.style.transform = `translate3d(${currentX}px, 0, 0)`;
        // Reflow decides on the UNCLAMPED center, so a wall-pinned tab can still push
        // past the edge sibling and swap with it.
        reflowSiblings(rawX);
    }

    function reflowSiblings(rawX) {
        const homeNow = dragHomeLeft - (container.scrollLeft - startScrollLeft);
        const draggedCenter = homeNow + rawX + (draggedItem.offsetWidth / 2);
        let newIndex = startIndex;
        siblings.forEach(sib => {
            if (sib.index === startIndex) return;
            const sibCenter = (sib.rect.left + sib.rect.width / 2) - (container.scrollLeft - startScrollLeft);
            let shift = 0;
            if (startIndex < sib.index && draggedCenter > sibCenter) { shift = -shiftAmount; newIndex = Math.max(newIndex, sib.index); }
            else if (startIndex > sib.index && draggedCenter < sibCenter) { shift = shiftAmount; newIndex = Math.min(newIndex, sib.index); }
            if (sib.shift !== shift) { sib.shift = shift; sib.el.style.transform = `translate3d(${shift}px, 0, 0)`; sib.el.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)'; }
        });
        currentIndex = newIndex;
    }

    function edgeScrollStep() {
        if (!draggedItem || edgeScrollDir === 0) { edgeScrollRAF = null; return; }
        const before = container.scrollLeft;
        container.scrollLeft += edgeScrollDir * edgeScrollSpeed;
        if (container.scrollLeft !== before) applyDragTransform();
        else { edgeScrollRAF = null; return; }  // hit a scroll wall - stop the loop
        edgeScrollRAF = requestAnimationFrame(edgeScrollStep);
    }

    function updateEdgeScroll(clientX) {
        const rect = container.getBoundingClientRect();
        const canLeft = container.scrollLeft > 0;
        const canRight = container.scrollLeft < (container.scrollWidth - container.clientWidth);

        let depth = 0; // 0..1, how far into the edge zone the pointer is
        if (clientX < rect.left + EDGE_ZONE && canLeft) {
            edgeScrollDir = -1;
            depth = (rect.left + EDGE_ZONE - clientX) / EDGE_ZONE;
        } else if (clientX > rect.right - EDGE_ZONE && canRight) {
            edgeScrollDir = 1;
            depth = (clientX - (rect.right - EDGE_ZONE)) / EDGE_ZONE;
        } else {
            edgeScrollDir = 0;
        }

        if (edgeScrollDir !== 0) {
            depth = Math.max(0, Math.min(1, depth));
            // Ease-in so it stays gentle most of the zone and only ramps near the very edge.
            edgeScrollSpeed = EDGE_MIN_SPEED + (EDGE_MAX_SPEED - EDGE_MIN_SPEED) * (depth * depth);
            if (edgeScrollRAF === null) edgeScrollRAF = requestAnimationFrame(edgeScrollStep);
        }
    }

    function stopEdgeScroll() {
        edgeScrollDir = 0;
        if (edgeScrollRAF !== null) { cancelAnimationFrame(edgeScrollRAF); edgeScrollRAF = null; }
    }

    container.addEventListener('pointerdown', (e) => {
        const tab = e.target.closest('.tab-btn');
        if (!tab) return;
        draggedItem = tab; startX = e.clientX; lastPointerX = e.clientX; currentX = 0;
        startScrollLeft = container.scrollLeft;
        // The tab's resting on-screen left, with no transform - captured once, stays stable.
        dragHomeLeft = draggedItem.getBoundingClientRect().left;
        draggedItem.setPointerCapture(e.pointerId);
        const allTabs = Array.from(container.querySelectorAll('.tab-btn'));
        startIndex = allTabs.indexOf(draggedItem); currentIndex = startIndex;
        // The gap the dragged tab leaves behind = its own width + the real inter-tab gap.
        // Measure the gap from two adjacent tabs' rects (right edge of one to left of next).
        let realGap = 8;
        if (allTabs.length > 1) {
            const a = allTabs[0].getBoundingClientRect(), b = allTabs[1].getBoundingClientRect();
            realGap = Math.max(0, b.left - a.right);
        }
        shiftAmount = draggedItem.getBoundingClientRect().width + realGap;
        siblings = allTabs.map((t, index) => ({ el: t, index: index, rect: t.getBoundingClientRect(), shift: 0 }));
    });

    container.addEventListener('pointermove', (e) => {
        if (!draggedItem) return;
        const deltaX = e.clientX - startX;
        if (Math.abs(deltaX) > 4 || window.isDraggingTab) {
            window.isDraggingTab = true;
            if (!draggedItem.classList.contains('dragging')) draggedItem.classList.add('dragging');
            draggedItem.style.transition = 'none';
            lastPointerX = e.clientX;
            updateEdgeScroll(e.clientX);
            applyDragTransform();
        }
    });

    container.addEventListener('pointerup', (e) => {
        if (!draggedItem) return;
        stopEdgeScroll();
        draggedItem.releasePointerCapture(e.pointerId);
        if (window.isDraggingTab) {
            const item = draggedItem;
            const allEls = [item].concat(siblings.map(s => s.el));

            // 1. Kill ALL transitions first so nothing can animate during the reset/reorder.
            allEls.forEach(el => { el.style.transition = 'none'; });
            // 2. Reorder the DOM to the final positions BEFORE clearing transforms,
            //    so the elements never occupy an in-between visual state.
            if (currentIndex !== startIndex) {
                const targetSibling = siblings[currentIndex].el;
                if (currentIndex > startIndex) container.insertBefore(item, targetSibling.nextSibling);
                else container.insertBefore(item, targetSibling);
            }
            // 3. Now clear transforms - elements are already in their final DOM slots,
            //    so transform '' lands them exactly where they visually were. No move.
            item.classList.remove('dragging');
            allEls.forEach(el => { el.style.transform = ''; });
            // 4. Force a synchronous reflow so the no-transition reset is committed,
            //    THEN restore transitions on the next frame for future interactions.
            void container.offsetWidth;
            requestAnimationFrame(() => {
                allEls.forEach(el => { el.style.transition = ''; });
            });

            saveTabOrder();
            setTimeout(() => { window.isDraggingTab = false; }, 50);
        }
        draggedItem = null;
    });
}

function initTabScroll() {
    const container = document.querySelector('.tabs-header');
    if (container) container.addEventListener('wheel', (e) => { if (container.scrollWidth > container.clientWidth) { e.preventDefault(); container.scrollLeft += (e.deltaY * 0.8); }});
}

function saveTabOrder() { 
    localStorage.setItem('ultimateFXTabOrder', JSON.stringify(Array.from(document.querySelectorAll('.tab-btn')).map(t => t.id))); 
}

function loadTabOrder() {
    const orderStr = localStorage.getItem('ultimateFXTabOrder');
    if (!orderStr) return;
    try { 
        const order = JSON.parse(orderStr); 
        const container = document.querySelector('.tabs-header'); 
        order.forEach(id => { const tab = document.getElementById(id); if (tab) container.appendChild(tab); }); 
    } catch(e){}
}

window.buildCustomDropdown = function(selectId) {
    const selectEl = document.getElementById(selectId); if (!selectEl) return;
    let existingWrapper = selectEl.nextElementSibling;
    if (existingWrapper && existingWrapper.classList.contains('custom-select-wrapper')) existingWrapper.remove();
    selectEl.style.display = 'none';
    const wrapper = document.createElement('div'); wrapper.className = 'custom-select-wrapper';
    const display = document.createElement('div'); display.className = 'custom-select-display';
    const list = document.createElement('div'); list.className = 'custom-select-list';
    Array.from(selectEl.options).forEach(opt => {
        const item = document.createElement('div'); item.className = 'custom-select-option'; item.innerText = opt.text;
        if (opt.selected) { item.classList.add('selected'); display.innerText = opt.text; }
        item.addEventListener('click', (e) => {
            e.stopPropagation(); selectEl.value = opt.value; selectEl.dispatchEvent(new Event('change')); display.innerText = opt.text;
            Array.from(list.children).forEach(child => child.classList.remove('selected'));
            item.classList.add('selected'); wrapper.classList.remove('active');
        });
        list.appendChild(item);
    });
    if (selectEl.selectedIndex >= 0 && (!display.innerText || display.innerText.trim() === "")) display.innerText = selectEl.options[selectEl.selectedIndex].text || "\u00A0";
    display.addEventListener('click', (e) => {
        e.stopPropagation(); let wasActive = wrapper.classList.contains('active');
        document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('active'));
        if (!wasActive) {
            wrapper.classList.add('active');
            const rect = wrapper.getBoundingClientRect();
            const GAP = 2;      // gap between the field and the menu
            const MARGIN = 8;   // keep the menu this far from the viewport edge

            // Reset any direction/height state from a previous open before measuring.
            list.classList.remove('drop-up');
            list.style.position = 'fixed';
            list.style.left = rect.left + 'px';
            list.style.width = rect.width + 'px';
            list.style.top = '';
            list.style.bottom = '';
            list.style.maxHeight = '';

            const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN;
            const spaceAbove = rect.top - GAP - MARGIN;
            const naturalH = list.scrollHeight; // full content height, ignores max-height

            // Open upward only when the list won't fit below AND there is more room above.
            const openUp = spaceBelow < naturalH && spaceAbove > spaceBelow;
            const avail = openUp ? spaceAbove : spaceBelow;

            // Cap to the space available (never past the 220px design max) so the
            // menu stays on-screen and scrolls when the list is long.
            list.style.maxHeight = Math.max(80, Math.min(220, avail)) + 'px';

            if (openUp) {
                list.classList.add('drop-up');
                list.style.bottom = (window.innerHeight - rect.top + GAP) + 'px';
            } else {
                list.style.top = (rect.bottom + GAP) + 'px';
            }
        }
    });
    wrapper.appendChild(display); wrapper.appendChild(list); selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
};

// NUMPAD LOGIC
window.activeNumpadInput = null; 
window.activeNumpadSlider = null; 
window.activeWrapper = null; 
window.isSyncingFromInput = false;

window.syncSliderToInput = function(sliderId, inputId) {
    if (window.isSyncingFromInput) return;
    const sliderEl = document.getElementById(sliderId), inputEl = document.getElementById(inputId);
    if (!sliderEl || !inputEl || document.activeElement === inputEl) return;
    inputEl.value = sliderEl.value; window.isSyncingFromInput = true; sliderEl.dispatchEvent(new Event('input')); window.isSyncingFromInput = false;
};

window.syncInputToSlider = function(inputId, sliderId) {
    const inputEl = document.getElementById(inputId), sliderEl = document.getElementById(sliderId);
    if (!sliderEl || !inputEl) return;
    let val = parseFloat(inputEl.value); if (isNaN(val) || inputEl.value === "") return; 
    window.isSyncingFromInput = true; sliderEl.value = val; sliderEl.dispatchEvent(new Event('input')); window.isSyncingFromInput = false;
};

window.openNumpad = function(inputId, sliderId, wrapperId) {
    window.activeNumpadInput = document.getElementById(inputId); window.activeNumpadSlider = document.getElementById(sliderId);
    if (window.activeWrapper) window.activeWrapper.classList.remove('active');
    window.activeWrapper = document.getElementById(wrapperId); if (window.activeWrapper) window.activeWrapper.classList.add('active');
    document.getElementById('global-numpad').classList.add('active'); window.activeNumpadInput.select(); 
    setTimeout(() => { document.addEventListener('click', window.closeNumpadOutside); }, 10);
};

window.closeNumpadOutside = function(e) { 
    const numpad = document.getElementById('global-numpad'); 
    if (!numpad.contains(e.target) && (!window.activeWrapper || !window.activeWrapper.contains(e.target))) window.closeNumpad(); 
};

window.closeNumpad = function() {
    document.getElementById('global-numpad').classList.remove('active'); document.removeEventListener('click', window.closeNumpadOutside);
    if (window.activeWrapper) window.activeWrapper.classList.remove('active');
    if (window.activeNumpadInput && window.activeNumpadSlider) {
        let val = parseFloat(window.activeNumpadInput.value);
        if (isNaN(val) || window.activeNumpadInput.value === "") window.activeNumpadInput.value = window.activeNumpadSlider.min;
        syncInputToSlider(window.activeNumpadInput.id, window.activeNumpadSlider.id); window.activeNumpadInput.blur();
    }
    window.activeNumpadInput = null; window.activeNumpadSlider = null; window.activeWrapper = null;
};

window.numpadPress = function(val) {
    if (!window.activeNumpadInput) return;
    if (window.activeNumpadInput.selectionStart === 0 && window.activeNumpadInput.selectionEnd === window.activeNumpadInput.value.length) window.activeNumpadInput.value = "";
    let currentVal = window.activeNumpadInput.value;
    if (val === 'AC') currentVal = ''; else if (val === 'OK') { window.closeNumpad(); return; } else currentVal += val;
    window.activeNumpadInput.value = currentVal;
    if (window.activeNumpadSlider && window.activeNumpadSlider.id !== 'dummy-slider') syncInputToSlider(window.activeNumpadInput.id, window.activeNumpadSlider.id);
    else window.activeNumpadInput.dispatchEvent(new Event('input'));
    window.activeNumpadInput.focus();
};

function initSliders() {
    document.querySelectorAll('input[type=range].main-slider').forEach(slider => {
        const updateFill = () => {
            const min = parseFloat(slider.min) || 0, max = parseFloat(slider.max) || 100, val = parseFloat(slider.value) || 0;
            const percent = ((val - min) / (max - min)) * 100;
            slider.style.backgroundImage = 'linear-gradient(var(--accent-blue), var(--accent-blue))'; slider.style.backgroundRepeat = 'no-repeat'; slider.style.backgroundSize = Math.max(0, Math.min(100, percent)) + '% 100%';
        };
        updateFill(); slider.addEventListener('input', updateFill);
    });
}

function showNotification(msg, type) {
    type = type || 'error';
    const overlay = document.getElementById('notificationOverlay');
    const content = document.getElementById('notificationContent');
    const text = document.getElementById('notificationText');
    if (!overlay || !content || !text) return;
    text.innerText = msg;
    content.classList.remove('error', 'success', 'warning');
    content.classList.add(type);
    ['error', 'success', 'warning'].forEach(t => {
        const ic = document.getElementById('notif-icon-' + t);
        if (ic) ic.style.display = (t === type) ? 'block' : 'none';
    });
    overlay.classList.add('show');
    if (window.notifTimeout) clearTimeout(window.notifTimeout);
    window.notifTimeout = setTimeout(() => overlay.classList.remove('show'), 4000);
}

function showNotification(msg, type) {
    type = type || 'error';
    var overlay = document.getElementById('notificationOverlay');
    var content = document.getElementById('notificationContent');
    var text = document.getElementById('notificationText');
    if (!overlay || !content || !text) return;
    text.innerText = msg;
    content.classList.remove('error', 'success', 'warning');
    content.classList.add(type);
    ['error', 'success', 'warning'].forEach(function (t) {
        var ic = document.getElementById('notif-icon-' + t);
        if (ic) ic.style.display = (t === type) ? 'block' : 'none';
    });
    overlay.classList.add('show');
    if (window.notifTimeout) clearTimeout(window.notifTimeout);
    window.notifTimeout = setTimeout(function () { overlay.classList.remove('show'); }, 4000);
}
function showToast(msg) {
    var m = String(msg == null ? '' : msg);
    var type = 'success';
    if (/fail|error|couldn|cannot|can't|unable|invalid/i.test(m)) type = 'error';
    else if (/select|first|no |not |please|already|warning|unsaved|choose/i.test(m)) type = 'warning';
    else if (/saved|imported|applied|added|created|updated|renamed|moved|deleted|done|ready|success/i.test(m)) type = 'success';
    showNotification(m, type);
}

document.addEventListener("DOMContentLoaded", () => {
    
    // ==========================================
    // CROSS-APP ROUTER LOGIC
    // ==========================================
    if (csInterface) {
        const env = csInterface.getHostEnvironment();
        // Check if environment exists and is NOT After Effects
        if (env && env.appId && env.appId !== "AEFT") {
            // We are in Premiere Pro or Photoshop
            // Hide all tab buttons except the Discord tab
            document.querySelectorAll('.tab-btn').forEach(btn => {
                if (btn.id !== 'btn-tab-discord') {
                    btn.style.display = 'none';
                }
            });
            
            // Center the remaining Discord button
            const tabsHeader = document.querySelector('.tabs-header');
            if (tabsHeader) {
                tabsHeader.style.justifyContent = 'center';
            }

            // Immediately switch to the Discord tab
            window.switchTab('tab-discord');
        } else {
            // We are in After Effects, load tabs normally
            loadTabOrder(); 
        }
    } else {
        // Fallback if CSInterface is missing
        loadTabOrder(); 
    }

    // ==========================================
    // STANDARD INITIALIZATION
    // ==========================================
    initDraggableTabs(); 
    initTabScroll(); 
    initSliders(); 
    
    if (document.getElementById('layer-type-select')) {
        window.buildCustomDropdown('layer-type-select');
    }

    document.addEventListener('click', () => document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('active')));
});

// 🚨 ULTIMATE TOOLTIP OVERRIDE 🚨
(function() {
    // 1. Force inner icons to be ignored so they don't break hovers
    const style = document.createElement('style');
    style.innerHTML = `[data-tooltip] * { pointer-events: none !important; }`;
    document.head.appendChild(style);

    // 2. Create a totally independent tooltip that ignores your CSS files
    const tip = document.createElement('div');
    tip.id = 'ultimate-tooltip';
    tip.style.cssText = `
        position: fixed !important;
        background: var(--rfx-menu) !important;
        color: var(--rfx-text-1) !important;
        border: 1px solid var(--rfx-line-2) !important;
        padding: 6px 10px !important;
        border-radius: var(--rfx-r-md) !important;
        font-size: 11px !important;
        font-weight: 400 !important;
        white-space: pre-line !important;
        max-width: calc(100vw - 16px) !important;
        overflow-wrap: anywhere !important;
        line-height: 1.4 !important;
        box-shadow: var(--rfx-shadow) !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        transition: opacity 0.15s ease, transform 0.15s ease !important;
        left: 0px !important;
        top: 0px !important;
        transform: translate(-50%, 8px) !important;
    `;
    document.body.appendChild(tip);

    let timer = null;

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;

        clearTimeout(timer);
        timer = setTimeout(() => {
            tip.innerText = target.getAttribute('data-tooltip');
            
            // Make it readable for exact measurement. Measure at left:0 so the text wraps
            // against the full panel width (a fixed element's wrap width shrinks with `left`).
            tip.style.visibility = 'hidden';
            tip.style.opacity = '0';
            tip.style.left = '0px';
            tip.style.top = '0px';
            tip.style.width = '';

            const targetRect = target.getBoundingClientRect();
            const tipRect = tip.getBoundingClientRect();
            // Lock the measured width, otherwise moving it right would re-wrap it narrower and taller.
            tip.style.width = Math.ceil(tipRect.width) + 'px';

            // Center exactly ABOVE the button
            let x = targetRect.left + (targetRect.width / 2);
            let y = targetRect.top - tipRect.height - 8;

            // EDGE DETECTION: long text wraps (max-width above), then the box is kept inside the panel
            if (y < 8) y = targetRect.bottom + 8; // Flips below if it hits the top edge
            if (y + tipRect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - tipRect.height - 8); // Bottom edge
            if (x - (tipRect.width / 2) < 8) x = (tipRect.width / 2) + 8; // Left edge
            if (x + (tipRect.width / 2) > window.innerWidth - 8) x = window.innerWidth - (tipRect.width / 2) - 8; // Right edge

            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
            
            // Animate in smoothly
            tip.style.visibility = 'visible';
            tip.style.opacity = '1';
            tip.style.transform = 'translate(-50%, 0px)';
        }, 300);
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('[data-tooltip]')) {
            clearTimeout(timer);
            tip.style.opacity = '0';
            tip.style.visibility = 'hidden';
            tip.style.transform = 'translate(-50%, 8px)';
        }
    });

    document.addEventListener('mousedown', () => {
        clearTimeout(timer);
        tip.style.opacity = '0';
        tip.style.visibility = 'hidden';
        tip.style.transform = 'translate(-50%, 8px)';
    });
})();