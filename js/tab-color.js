// This tab's ExtendScript backend (jsx/color.jsx), loaded on first use.
const colorJsx = window.createJsxLoader('color.jsx');
let ctxSvBg, ctxHBg, hueNorm = 0, svNorm = { x: 1, y: 0 }, currentHue = 0, currentHex = "FF0000", currentName = "Red";
let isDraggingSV = false, isDraggingH = false, savedPresets = [], fs, path, presetsFile, useNodeJS = false;

if (typeof window !== 'undefined' && window.cep) {
    try {
        fs = require('fs'); path = require('path'); useNodeJS = true;
        let appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '');
        let presetsDir = path.join(appDataPath, 'UltimateFXSuite');
        if (!fs.existsSync(presetsDir)) fs.mkdirSync(presetsDir, { recursive: true });
        presetsFile = path.join(presetsDir, 'colorPresets.json');
        if (fs.existsSync(presetsFile)) savedPresets = JSON.parse(fs.readFileSync(presetsFile, 'utf8')) || [];
    } catch(e) { useNodeJS = false; }
}
if (!useNodeJS) savedPresets = JSON.parse(localStorage.getItem('ultColorPresets')) || [];

function persistData() {
    if (useNodeJS) fs.writeFileSync(presetsFile, JSON.stringify(savedPresets, null, 2), 'utf8');
    else localStorage.setItem('ultColorPresets', JSON.stringify(savedPresets));
}

function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255; let max = Math.max(r, g, b), min = Math.min(r, g, b), h, s, v = max, d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max == min) h = 0; else { switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; } h /= 6; }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}

function hsbToRgb(h, s, v) {
    let r, g, b, i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) { case 0: r = v, g = t, b = p; break; case 1: r = q, g = v, b = p; break; case 2: r = p, g = v, b = t; break; case 3: r = p, g = q, b = v; break; case 4: r = t, g = p, b = v; break; case 5: r = v, g = p, b = q; break; }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function getGranularColorName(h, s, b) {
    if (b < 8) return "Pure Black"; if (b > 94 && s < 8) return "Pure White";
    if (s < 12) { if (b < 30) return "Charcoal Gray"; if (b > 80) return "Light Gray"; return "Gray"; }
    let prefix = ""; if (b < 35) prefix = "Very Dark "; else if (b < 55) prefix = "Dark "; else if (b > 90 && s < 40) prefix = "Very Light "; else if (b > 80 && s < 60) prefix = "Light "; else if (s < 40) prefix = "Muted ";
    let baseColor = "";
    if (h >= 345 || h < 15) baseColor = (b < 60 && s < 70) ? "Brown" : "Red"; else if (h >= 15 && h < 45) baseColor = (b < 60 || s < 50) ? "Brown" : "Orange"; else if (h >= 45 && h < 65) baseColor = (b < 50) ? "Olive" : "Yellow"; else if (h >= 65 && h < 150) baseColor = "Green"; else if (h >= 150 && h < 170) baseColor = "Teal"; else if (h >= 170 && h < 195) baseColor = "Cyan"; else if (h >= 195 && h < 255) baseColor = "Blue"; else if (h >= 255 && h < 290) baseColor = "Purple"; else if (h >= 290 && h < 345) baseColor = "Pink";
    if (prefix === "Very Dark " && baseColor === "Blue") return "Midnight Blue"; if (prefix === "Light " && baseColor === "Orange") return "Peach"; return prefix + baseColor;
}

function drawHueBg() {
    if(!ctxHBg) return;
    const hBg = document.getElementById('h-bg'), grad = ctxHBg.createLinearGradient(0, 0, 0, hBg.height);
    grad.addColorStop(0, '#f00'); grad.addColorStop(1/6, '#ff0'); grad.addColorStop(2/6, '#0f0'); grad.addColorStop(3/6, '#0ff'); grad.addColorStop(4/6, '#00f'); grad.addColorStop(5/6, '#f0f'); grad.addColorStop(1, '#f00'); // rfx-content-color (hue strip)
    ctxHBg.fillStyle = grad; ctxHBg.fillRect(0, 0, hBg.width, hBg.height);
}

function drawSvBg() {
    if(!ctxSvBg) return;
    const svBg = document.getElementById('sv-bg');
    ctxSvBg.fillStyle = `hsl(${currentHue}, 100%, 50%)`; ctxSvBg.fillRect(0, 0, svBg.width, svBg.height); // rfx-content-color
    const gradWhite = ctxSvBg.createLinearGradient(0, 0, svBg.width, 0); gradWhite.addColorStop(0, 'rgba(255,255,255,1)'); gradWhite.addColorStop(1, 'rgba(255,255,255,0)'); // rfx-content-color
    ctxSvBg.fillStyle = gradWhite; ctxSvBg.fillRect(0, 0, svBg.width, svBg.height);
    const gradBlack = ctxSvBg.createLinearGradient(0, 0, 0, svBg.height); gradBlack.addColorStop(0, 'rgba(0,0,0,0)'); gradBlack.addColorStop(1, 'rgba(0,0,0,1)'); // rfx-content-color
    ctxSvBg.fillStyle = gradBlack; ctxSvBg.fillRect(0, 0, svBg.width, svBg.height);
}

function updateThumbs() {
    document.getElementById('sv-thumb').style.left = `${svNorm.x * 100}%`; document.getElementById('sv-thumb').style.top = `${svNorm.y * 100}%`; document.getElementById('h-thumb').style.top = `${hueNorm * 100}%`;
}

function updateColorData() {
    const svBg = document.getElementById('sv-bg');
    let px = Math.min(Math.floor(svNorm.x * svBg.width), svBg.width - 1), py = Math.min(Math.floor(svNorm.y * svBg.height), svBg.height - 1);
    let imgData = ctxSvBg.getImageData(px, py, 1, 1).data;
    let hex = ((1 << 24) + (imgData[0] << 16) + (imgData[1] << 8) + imgData[2]).toString(16).slice(1).toUpperCase();
    let hsb = rgbToHsb(imgData[0], imgData[1], imgData[2]), name = getGranularColorName(hsb[0], hsb[1], hsb[2]);
    currentHex = hex; currentName = name;
    document.getElementById('preview').style.background = `#${hex}`; document.getElementById('hex-input').value = hex; document.getElementById('color-name').innerText = name;
    document.getElementById('val-h').value = hsb[0]; document.getElementById('val-s').value = hsb[1]; document.getElementById('val-b').value = hsb[2];
}

function applyManualHSB() {
    let h = Math.max(0, Math.min(360, parseInt(document.getElementById('val-h').value) || 0)), s = Math.max(0, Math.min(100, parseInt(document.getElementById('val-s').value) || 0)), b = Math.max(0, Math.min(100, parseInt(document.getElementById('val-b').value) || 0));
    currentHue = h; hueNorm = h / 360; svNorm.x = s / 100; svNorm.y = 1 - (b / 100);
    let rgb = hsbToRgb(h / 360, s / 100, b / 100), hex = ((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1).toUpperCase();
    currentHex = hex; currentName = getGranularColorName(h, s, b);
    document.getElementById('preview').style.background = `#${hex}`; document.getElementById('hex-input').value = hex; document.getElementById('color-name').innerText = currentName;
    drawSvBg(); updateThumbs();
}

function handleSvInput(e) {
    const rect = document.getElementById('sv-box').getBoundingClientRect();
    svNorm.x = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1)); svNorm.y = Math.max(0, Math.min((e.clientY - rect.top) / rect.height, 1));
    updateThumbs(); updateColorData();
}

function handleHueInput(e) {
    const rect = document.getElementById('h-box').getBoundingClientRect();
    hueNorm = Math.max(0, Math.min((e.clientY - rect.top) / rect.height, 1)); currentHue = hueNorm * 360; updateThumbs(); drawSvBg(); updateColorData();
}

function renderPresets() {
    const presetList = document.getElementById('presets-list'); presetList.innerHTML = '';
    savedPresets.forEach((p, index) => {
        let div = document.createElement('div'); div.className = 'preset-item';
        div.innerHTML = `<div class="preset-color" style="background: #${p.hex}"></div><div class="preset-info"><div class="preset-name">${p.name}</div><div class="preset-hex">#${p.hex}</div></div><button class="preset-del" data-index="${index}">×</button>`;
        div.addEventListener('click', (e) => {
            if(e.target.className === 'preset-del') { savedPresets.splice(index, 1); persistData(); renderPresets(); return; }
            document.getElementById('hex-input').value = p.hex; document.getElementById('preview').style.background = `#${p.hex}`; document.getElementById('color-name').innerText = p.name; currentHex = p.hex;
        });
        presetList.appendChild(div);
    });
}

function processImportData(fileContent) {
    try {
        let imported = JSON.parse(fileContent);
        if(Array.isArray(imported)) { imported.forEach(impP => { if(!savedPresets.some(p => p.hex === impP.hex)) savedPresets.push(impP); }); persistData(); renderPresets(); showToast("Presets imported!"); } else throw new Error();
    } catch(err) { showToast("Invalid presets file."); }
}

window.copyHexCode = function() {
    const hexInput = document.getElementById('hex-input'); hexInput.select(); hexInput.setSelectionRange(0, 99999); document.execCommand("copy"); showToast("Hex copied!");
};
window.applyColorToFill = function() { colorJsx(`applyHexToFill("${currentHex}")`); };
window.applyColorToStroke = function() { colorJsx(`applyHexToStroke("${currentHex}")`); };

window.addEventListener('tabSwitched', (e) => {
    if(e.detail === 'tab-color') {
        const svBg = document.getElementById('sv-bg'), hBg = document.getElementById('h-bg');
        if (svBg && hBg && ctxSvBg && ctxHBg) {
            const svRect = document.getElementById('sv-box').getBoundingClientRect(), hRect = document.getElementById('h-box').getBoundingClientRect();
            svBg.width = svRect.width; svBg.height = svRect.height; hBg.width = hRect.width; hBg.height = hRect.height;
            drawHueBg(); drawSvBg(); updateThumbs();
        }
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const svBg = document.getElementById('sv-bg'), hBg = document.getElementById('h-bg');
    if(svBg) ctxSvBg = svBg.getContext('2d', {willReadFrequently: true});
    if(hBg) ctxHBg = hBg.getContext('2d', {willReadFrequently: true});
    ['val-h', 'val-s', 'val-b'].forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('input', applyManualHSB); });
    const svBox = document.getElementById('sv-box'), hBox = document.getElementById('h-box');
    if(svBox) svBox.addEventListener('mousedown', (e) => { e.preventDefault(); isDraggingSV = true; handleSvInput(e); });
    if(hBox) hBox.addEventListener('mousedown', (e) => { e.preventDefault(); isDraggingH = true; handleHueInput(e); });
    window.addEventListener('mousemove', (e) => { if(isDraggingSV) { e.preventDefault(); handleSvInput(e); } else if(isDraggingH) { e.preventDefault(); handleHueInput(e); } });
    window.addEventListener('mouseup', () => { isDraggingSV = false; isDraggingH = false; });
    const btnSave = document.getElementById('btn-save'), btnExport = document.getElementById('btn-export'), btnImport = document.getElementById('btn-import');
    if(btnSave) btnSave.addEventListener('click', () => { if(!savedPresets.some(p => p.hex === currentHex)) { savedPresets.unshift({ hex: currentHex, name: currentName }); persistData(); renderPresets(); }});
    if(btnExport) btnExport.addEventListener('click', () => {
        if(savedPresets.length === 0) return showToast("No presets to export.");
        if (typeof window !== 'undefined' && window.cep && window.cep.fs) {
            let result = window.cep.fs.showSaveDialogEx("Export Presets", "", ["json"], ((window.APP && window.APP.name) || "") + "Colors.json", "");
            if (result.data) { const str = JSON.stringify(savedPresets, null, 2); if (useNodeJS) fs.writeFileSync(result.data, str, 'utf8'); else window.cep.fs.writeFile(result.data, str); showToast("Exported successfully!"); }
        }
    });
    if(btnImport) btnImport.addEventListener('click', () => {
        if (typeof window !== 'undefined' && window.cep && window.cep.fs) {
            let result = window.cep.fs.showOpenDialogEx(false, false, "Import Presets", "", ["json"], "");
            if (result.data && result.data.length > 0) processImportData(useNodeJS ? fs.readFileSync(result.data[0], 'utf8') : window.cep.fs.readFile(result.data[0]).data);
        }
    });
    renderPresets();
});