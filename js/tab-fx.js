// This tab's ExtendScript backend (jsx/fx.jsx), loaded on first use.
const fxJsx = window.createJsxLoader('fx.jsx');
let fxBundles = []; 

window.copyFX = function() {
    fxJsx('copySelectedLayerFX()', (res) => {
        if (!res || res === "null" || res === "none") return showToast("No layer selected or no effects found.");
        try { fxBundles = JSON.parse(res); renderFXList(); } catch(e) {}
    });
};

function renderFXList() {
    const container = document.getElementById('fx-list-container'); container.innerHTML = '';
    if (fxBundles.length === 0) { 
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; margin-top: 10px; font-size: 12px;">No effects copied yet.</p>'; 
        return; 
    }
    
    fxBundles.forEach((bundleNamesString, i) => {
        const div = document.createElement('div'); 
        div.className = 'preset-item';
        div.innerHTML = `<input type="checkbox" checked value="${i}" style="margin: 0 8px 0 0;"><div class="preset-info" style="overflow: hidden;"><div class="preset-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px;">${i+1}. ${bundleNamesString}</div></div><button class="preset-del" onclick="deleteFXBundle(${i}, event)">×</button>`;
        
        div.addEventListener('click', (e) => { 
            if(e.target.tagName.toLowerCase() === 'button') return; 
            const cb = div.querySelector('input'); 
            if(e.target !== cb) cb.checked = !cb.checked; 
        });
        
        container.appendChild(div);
    });
}

window.deleteFXBundle = function(index, event) {
    if(event) event.stopPropagation();
    fxBundles.splice(index, 1); 
    fxJsx(`removeFXBundleFromMemory(${index})`); 
    renderFXList();
};

window.removeFX = function() { 
    fxJsx('removeAllFX()'); 
};

window.pasteFX = function() {
    const checkedBoxes = document.querySelectorAll('#fx-list-container input[type="checkbox"]:checked');
    const indexesToPaste = Array.from(checkedBoxes).map(cb => cb.value);
    fxJsx(`pasteSpecificFX("${indexesToPaste.join(',')}")`);
};