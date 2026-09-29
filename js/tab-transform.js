// This tab's ExtendScript backend (jsx/transform.jsx), loaded on first use.
const transformJsx = window.createJsxLoader('transform.jsx');
window.runSortLayers = function(earlyAtBottom) { transformJsx(`sortLayersAE(${earlyAtBottom})`); };
window.runSelectProperties = function() { transformJsx('selectSameProperties()'); };
window.runSelectLayerType = function() { const type = document.getElementById('layer-type-select').value; transformJsx(`selectLayerType("${type}")`); };
window.runCreateNullParent = function() { transformJsx('createNullAndParent()'); };
window.moveAnchor = function(pos) { transformJsx(`moveAnchorPoint("${pos}")`); };
window.runFlipLayers = function() { transformJsx('flipSelectedLayers()'); };
window.sequenceLayers = function(direction) { const frames = document.getElementById('setting-seq-frames').value; transformJsx(`sequenceLayers("${direction}", ${frames})`); };
window.runAlign = function(type) { const el = document.getElementById('align-relative-to'); const rel = el ? el.value : 'selection'; transformJsx(`alignLayers("${type}", "${rel}")`); };
window.runCenterAnchorAndLayer = function() { transformJsx('centerAnchorAndLayer()'); };
window.runGroupCenter = function(doAnchor) { transformJsx(`groupCenter(${doAnchor})`); };
window.runReverseSpatial = function(axis) { transformJsx(`reverseSpatial("${axis}")`); };
window.runMatchStartTime = function() { transformJsx('matchLayerStartTime()'); };
window.runSequenceChain  = function(dir) { transformJsx(`sequenceLayersChain("${dir}")`); };
window.runSetInPoint  = function() { transformJsx('setLayerInPoint()'); };
window.runSetOutPoint = function() { transformJsx('setLayerOutPoint()'); };
window.runReverseSequence  = function() { transformJsx('reverseSequence()'); };
window.runMoveGroupStart   = function() { transformJsx('moveGroupStartToPlayhead()'); };
window.runMoveGroupEnd     = function() { transformJsx('moveGroupEndToPlayhead()'); };

// ==========================================
// NEW LAYERS LOGIC & COLOR ENGINE
// ==========================================
// Load from memory, or use factory defaults (Link: true, Single: false)
window.nulSettings = { 
    link: localStorage.getItem('nl_nul_link') !== null ? localStorage.getItem('nl_nul_link') === 'true' : true, 
    single: localStorage.getItem('nl_nul_single') !== null ? localStorage.getItem('nl_nul_single') === 'true' : false 
};

window.toggleNulOptionMenu = function(opt) {
    window.nulSettings[opt] = !window.nulSettings[opt];
    localStorage.setItem('nl_nul_' + opt, window.nulSettings[opt]); // Save choice to memory
    const checkbox = document.getElementById('nul-toggle-chk-' + opt);
    if (checkbox) checkbox.checked = window.nulSettings[opt];
};

const aeColors = [
    { name: "None", hex: "transparent", id: 0 }, { name: "Red", hex: "#B53838", id: 1 },
    { name: "Yellow", hex: "#E4D84C", id: 2 }, { name: "Aqua", hex: "#A9CBC7", id: 3 },
    { name: "Pink", hex: "#E5BCC9", id: 4 }, { name: "Lavender", hex: "#A9A9CA", id: 5 },
    { name: "Peach", hex: "#E7C19E", id: 6 }, { name: "Sea Foam", hex: "#B3C7B3", id: 7 },
    { name: "Blue", hex: "#677DE0", id: 8 }, { name: "Green", hex: "#4AA44C", id: 9 },
    { name: "Purple", hex: "#8E2C9A", id: 10 }, { name: "Orange", hex: "#E8920D", id: 11 },
    { name: "Brown", hex: "#7F452A", id: 12 }, { name: "Fuchsia", hex: "#F46DD6", id: 13 },
    { name: "Cyan", hex: "#3DA2A5", id: 14 }, { name: "Sandstone", hex: "#A89677", id: 15 },
    { name: "Dark Green", hex: "#1E401E", id: 16 }
];

window.addCustomLayer = function(type) {
    let linkOpt = window.nulSettings.link ? "true" : "false";
    let singleOpt = window.nulSettings.single ? "true" : "false";
    let colorIdx = localStorage.getItem('nl_color_' + type) || 0;
    
    let cmd = `addCustomLayerAE('${type}', ${linkOpt}, ${singleOpt}, ${colorIdx})`;
    transformJsx(cmd);
};

let colorHoverTimer = null;
let activeColorMenu = null;

function initNewLayerButtons() {
    const types = ['NUL', 'ADJ', 'SLD', 'SHP', 'TXT', 'CAM', 'LIG'];
    
    types.forEach(type => {
        let btn = document.querySelector(`.nl-btn[onclick="addCustomLayer('${type}')"]`);
        if(!btn) return;
        
        let ind = document.createElement('div');
        ind.className = 'nl-color-indicator';
        let savedColor = parseInt(localStorage.getItem('nl_color_' + type) || 0);
        if(savedColor > 0) ind.style.backgroundColor = aeColors[savedColor].hex;
        btn.appendChild(ind);

        btn.addEventListener('mouseenter', (e) => {
            colorHoverTimer = setTimeout(() => { openLayerColorMenu(btn, type, ind); }, 500);
        });
        btn.addEventListener('mouseleave', () => { clearTimeout(colorHoverTimer); });
        
        btn.addEventListener('mousedown', (e) => { 
            if (e.button === 0) clearTimeout(colorHoverTimer); 
        });
        
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); 
            clearTimeout(colorHoverTimer);
            openLayerColorMenu(btn, type, ind);
        });
    });

    document.addEventListener('click', (e) => {
        if (activeColorMenu && !activeColorMenu.contains(e.target)) {
            activeColorMenu.remove();
            activeColorMenu = null;
        }
    });
}

function openLayerColorMenu(btnEl, type, indicatorEl) {
    if(activeColorMenu) activeColorMenu.remove();
    
    const menu = document.createElement('div');
    menu.className = 'ctx-menu'; 
    menu.style.maxHeight = '320px';
    menu.style.overflowY = 'auto';
    menu.style.width = '170px';
    
    // Inject Null Toggles exclusively for the NUL button
    if (type === 'NUL') {
        const toggleSection = document.createElement('div');
        toggleSection.style.padding = '8px 12px';
        toggleSection.style.borderBottom = '1px solid #444';
        toggleSection.style.marginBottom = '4px';
        toggleSection.style.display = 'flex';
        toggleSection.style.flexDirection = 'column';
        toggleSection.style.gap = '10px';
        
        toggleSection.innerHTML = `
            <div class="setting-row" style="margin-bottom:0; cursor:pointer;" onclick="event.stopPropagation(); window.toggleNulOptionMenu('link')">
                <span style="font-size:11px;">Link Layers</span>
                <label class="switch" style="pointer-events:none; margin:0;"><input type="checkbox" id="nul-toggle-chk-link" ${window.nulSettings.link ? 'checked' : ''}><span class="slider"></span></label>
            </div>
            <div class="setting-row" style="margin-bottom:0; cursor:pointer;" onclick="event.stopPropagation(); window.toggleNulOptionMenu('single')">
                <span style="font-size:11px;">Single Null</span>
                <label class="switch" style="pointer-events:none; margin:0;"><input type="checkbox" id="nul-toggle-chk-single" ${window.nulSettings.single ? 'checked' : ''}><span class="slider"></span></label>
            </div>
        `;
        menu.appendChild(toggleSection);
    }

    aeColors.forEach(c => {
        const item = document.createElement('div');
        item.className = 'ctx-item';
        item.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><div style="width:10px; height:10px; border-radius:50%; background:${c.hex}; border:1px solid ${c.id===0 ? '#555' : 'transparent'}"></div><span style="font-size:11px;">${c.name}</span></div>`;
        item.onclick = (e) => {
            e.stopPropagation();
            localStorage.setItem('nl_color_' + type, c.id);
            indicatorEl.style.backgroundColor = c.id === 0 ? 'transparent' : c.hex;
            menu.remove();
            activeColorMenu = null;
        };
        menu.appendChild(item);
    });

    document.body.appendChild(menu);
    activeColorMenu = menu;
    const rect = btnEl.getBoundingClientRect();
    if(window.repositionMenu) window.repositionMenu(menu, rect.left, rect.bottom + 4);
}

document.addEventListener('DOMContentLoaded', initNewLayerButtons);