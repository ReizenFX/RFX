// ==========================================
// RENDER TAB — tab-render.js
// Depends on: globals.js (csInterface, safeEval, showToast)
// ==========================================

// Node modules — must be at top level, outside DOMContentLoaded,
// so CEP's Node.js context is available when this script first executes.
let _exec, _path, _fs, _os;
try {
    _exec = require('child_process').exec;
    _path = require('path');
    _fs   = require('fs');
    _os   = require('os');
} catch (e) {
    console.warn("Render Tab: Node modules unavailable.");
}

window.addEventListener("DOMContentLoaded", () => {

    // ------------------------------------------
    // ELEMENT REFS
    // All IDs are unique to tab-render in index.html
    // ------------------------------------------
    const renderPathDisplay  = document.getElementById('renderPathDisplay');
    const togglePathBtn      = document.getElementById('render-togglePathBtn');
    const iconEyeOpen        = document.getElementById('render-icon-eye-open');
    const iconEyeClosed      = document.getElementById('render-icon-eye-closed');
    const importRenderCheck  = document.getElementById('importRenderCheck');
    const includeNativeCheck = document.getElementById('includeNativeCheck');
    const presetModal        = document.getElementById('presetModal');
    const presetNameInput    = document.getElementById('presetNameInput');
    const renameModal        = document.getElementById('renameModal');
    const renameInput        = document.getElementById('renameInput');
    const alertModal         = document.getElementById('alertModal');
    const alertMessage       = document.getElementById('alertMessage');
    const closeAlertBtn      = document.getElementById('closeAlertBtn');
    const queueModal         = document.getElementById('queueModal');
    const queueListContainer = document.getElementById('queueListContainer');
    const cancelRenameBtn    = document.getElementById('render-cancelRenameBtn');
    const applyRenameBtn     = document.getElementById('render-applyRenameBtn');

    // ------------------------------------------
    // ALERT SYSTEM (scoped to render tab)
    // ------------------------------------------
    function showCustomAlert(msg) {
        if (!alertModal || !alertMessage) { console.error("Alert modal missing:", msg); return; }
        alertMessage.innerText = msg;
        alertModal.classList.add('show');
        if (closeAlertBtn) setTimeout(() => closeAlertBtn.focus(), 100);
    }
    if (closeAlertBtn) {
        closeAlertBtn.addEventListener('click', () => alertModal.classList.remove('show'));
    }

    // ------------------------------------------
    // SAFE STRING — escapes for evalScript calls
    // ------------------------------------------
    function safeString(s) {
        return s ? s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') : "";
    }

    // ------------------------------------------
    // RENDER LOCATION & PER-PROJECT MEMORY
    // ------------------------------------------
    let currentProjectKey = 'unknown';
    let isProjectSaved    = false;
    let renderLocation    = "";

    function autoUpdateDataFromAE() {
        if (!csInterface) return;
        csInterface.evalScript('getProjectData()', (aeResult) => {
            try {
                const parsed = JSON.parse(aeResult);
                if (parsed.error) return;

                const newKey = parsed.isSaved ? parsed.projectPath : 'unsaved';
                isProjectSaved = parsed.isSaved;

                if (newKey !== currentProjectKey) {
                    if (currentProjectKey === 'unsaved' && renderLocation !== "" && parsed.isSaved) {
                        currentProjectKey = newKey;
                        localStorage.setItem('zlp_loc_' + currentProjectKey, renderLocation);
                    } else {
                        currentProjectKey = newKey;
                        renderLocation = (currentProjectKey === 'unsaved')
                            ? ""
                            : (localStorage.getItem('zlp_loc_' + currentProjectKey) || "");
                    }
                }
                updateLocationDisplay();
            } catch(e) {}
        });
    }

    autoUpdateDataFromAE();
    document.body.addEventListener('mouseenter', autoUpdateDataFromAE);
    window.addEventListener('focus', autoUpdateDataFromAE);
    if (csInterface) csInterface.addEventListener('com.adobe.csxs.events.ApplicationActivate', autoUpdateDataFromAE);
    window.addEventListener('tabSwitched', (e) => { if (e.detail === 'tab-render') autoUpdateDataFromAE(); });

    function updateLocationDisplay() {
        if (!renderPathDisplay) return;
        renderPathDisplay.innerText = renderLocation
            ? renderLocation
            : (isProjectSaved ? "Default (Export Folder)" : "Default (Downloads)");
    }

    // ------------------------------------------
    // PATH VISIBILITY TOGGLE
    // ------------------------------------------
    let isPathHidden = localStorage.getItem('zlp_hide_render_path') === 'true';

    function updatePathVisibility() {
        if (!renderPathDisplay || !iconEyeOpen || !iconEyeClosed) return;
        renderPathDisplay.classList.toggle('blurred', isPathHidden);
        iconEyeOpen.style.display   = isPathHidden ? 'none'  : 'block';
        iconEyeClosed.style.display = isPathHidden ? 'block' : 'none';
    }
    updatePathVisibility();

    if (togglePathBtn) {
        togglePathBtn.addEventListener('click', () => {
            isPathHidden = !isPathHidden;
            localStorage.setItem('zlp_hide_render_path', isPathHidden);
            updatePathVisibility();
        });
    }

    // ------------------------------------------
    // BROWSE LOCATION
    // ------------------------------------------
    const browseLocationBtn = document.getElementById('browseLocationBtn');
    if (browseLocationBtn) {
        browseLocationBtn.addEventListener('click', () => {
            if (_os && _os.platform() === 'win32') {
                // Windows: use PowerShell folder picker
                const scriptPath = _path.join(_os.tmpdir(), 'zlp_folder_picker.ps1');
                const psScript = `
                if (-not ([System.Management.Automation.PSTypeName]'DpiAware').Type) {
                    Add-Type -TypeDefinition @"
                    using System;
                    using System.Runtime.InteropServices;
                    public class DpiAware {
                        [DllImport("user32.dll")]
                        public static extern bool SetProcessDPIAware();
                    }
"@
                }
                [DpiAware]::SetProcessDPIAware() | Out-Null
                Add-Type -AssemblyName System.Windows.Forms
                $dialog = New-Object System.Windows.Forms.OpenFileDialog
                $dialog.Title = "Select Render Output Folder"
                $dialog.ValidateNames = $false
                $dialog.CheckFileExists = $false
                $dialog.CheckPathExists = $true
                $dialog.FileName = "Select_This_Folder"
                if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                    Write-Output ([System.IO.Path]::GetDirectoryName($dialog.FileName))
                }
                `;
                _fs.writeFileSync(scriptPath, psScript, 'utf8');
                _exec(`powershell -ExecutionPolicy Bypass -sta -NoProfile -File "${scriptPath}"`, (error, stdout) => {
                    if (_fs.existsSync(scriptPath)) _fs.unlinkSync(scriptPath);
                    const pickedPath = stdout.trim();
                    if (pickedPath && _fs.existsSync(pickedPath) && _fs.lstatSync(pickedPath).isDirectory()) {
                        renderLocation = pickedPath;
                        if (currentProjectKey !== 'unsaved') localStorage.setItem('zlp_loc_' + currentProjectKey, renderLocation);
                        updateLocationDisplay();
                    }
                });
            } else {
                // macOS/Linux: use CEP native dialog
                if (window.cep && window.cep.fs) {
                    const result = window.cep.fs.showOpenDialog(false, true, "Select Render Output Folder", "", "");
                    if (result.data && result.data.length > 0) {
                        renderLocation = result.data[0];
                        if (currentProjectKey !== 'unsaved') localStorage.setItem('zlp_loc_' + currentProjectKey, renderLocation);
                        updateLocationDisplay();
                    }
                } else {
                    showCustomAlert("File system access is not available.");
                }
            }
        });
    }

    // ------------------------------------------
    // SETTING TOGGLES
    // ------------------------------------------
    if (importRenderCheck) {
        const savedImport = localStorage.getItem('zlp_import_render');
        if (savedImport !== null) importRenderCheck.checked = (savedImport === 'true');
        importRenderCheck.addEventListener('change', () => localStorage.setItem('zlp_import_render', importRenderCheck.checked));
    }

    if (includeNativeCheck) {
        const savedIncludeNative = localStorage.getItem('zlp_include_native');
        if (savedIncludeNative !== null) includeNativeCheck.checked = (savedIncludeNative === 'true');
        includeNativeCheck.addEventListener('change', () => localStorage.setItem('zlp_include_native', includeNativeCheck.checked));
    }

    // ------------------------------------------
    // PRESET STORAGE
    // ------------------------------------------
    let renderPresets = JSON.parse(localStorage.getItem('zlp_render_presets') || '[]');
    function savePresets() { localStorage.setItem('zlp_render_presets', JSON.stringify(renderPresets)); }

    function updateCheckboxStyles() {
        document.querySelectorAll('#presetListContainer .preset-checkbox').forEach((el, i) => {
            const checked = renderPresets[i] && renderPresets[i].isChecked;
            el.style.background = checked ? '#142840' : '#141414';
            el.style.border     = checked ? '1px solid #1a3554' : '1px solid #2a2a2a';
            let tick = el.querySelector('.checkbox-tick');
            if (checked) {
                if (!tick) {
                    tick = document.createElement('span');
                    tick.className = 'checkbox-tick';
                    // Exact values from original style.css ::after rule:
                    // display:block, width:5px, height:12px, border shorthand,
                    // rotate(45deg), margin-bottom:3px (shifts tick up inside flex center)
                    tick.style.cssText = 'display:block; width:5px; height:12px; border:solid #5ea5f0; border-width:0 2px 2px 0; transform:rotate(45deg); margin-bottom:3px; box-sizing:border-box;';
                    el.appendChild(tick);
                }
            } else {
                if (tick) tick.remove();
            }
        });
    }

    function renderPresetList() {
        const container = document.getElementById('presetListContainer');
        if (!container) return;
        container.innerHTML = '';

        if (renderPresets.length === 0) {
            container.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);text-align:center;padding:10px;">No presets saved yet.</div>';
            return;
        }

        renderPresets.forEach((preset, index) => {
            const row = document.createElement('div');
            row.className = 'preset-row';
            row.style.cssText = 'display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:space-between !important; gap:8px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:6px; padding:8px 10px;';

            // Checkbox — radio-style single select
            // div instead of input so ::after renders reliably in CEP's Chromium
            const checkEl = document.createElement('div');
            checkEl.className = 'preset-checkbox';
            if (preset.isChecked) checkEl.classList.add('checked');
            checkEl.setAttribute('data-tooltip', 'Select as active Render Format');
            // Matches original style.css: flex container to center the tick via margin-bottom
            checkEl.style.cssText = 'width:24px; height:24px; min-width:24px; border-radius:4px; cursor:pointer; flex-shrink:0; display:flex; align-items:center; justify-content:center; box-sizing:border-box;';
            checkEl.onclick = () => {
                const wasChecked = checkEl.classList.contains('checked');
                document.querySelectorAll('#presetListContainer .preset-checkbox').forEach(c => c.classList.remove('checked'));
                renderPresets.forEach(p => p.isChecked = false);
                if (!wasChecked) {
                    checkEl.classList.add('checked');
                    preset.isChecked = true;
                }
                updateCheckboxStyles();
                savePresets();
            };

            // Name — click to apply to active comp
            const nameEl = document.createElement('div');
            nameEl.className = 'preset-name';
            nameEl.style.cssText = 'font-size:12px; color:var(--text-primary); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:6px 8px; border-radius:4px; cursor:pointer; min-width:0;';
            nameEl.innerText = preset.name;
            nameEl.setAttribute('data-tooltip', 'Click to apply to selected Comp');
            nameEl.onmouseover = () => { nameEl.style.background = 'rgba(255,255,255,0.1)'; };
            nameEl.onmouseout  = () => { nameEl.style.background = ''; };
            nameEl.onclick = () => {
                if (!csInterface) return;
                const tempName        = safeString(preset.templateName || preset.name);
                const safeLoc         = safeString(renderLocation);
                const safeExt         = safeString(preset.ext || ".mp4");
                const customNameInput = document.getElementById('customFileNameInput');
                const safeCustomName  = safeString(customNameInput ? customNameInput.value.trim() : "");
                const originalColor   = nameEl.style.color;

                nameEl.style.color = "rgba(46,160,67,1)";
                csInterface.evalScript(`applyRenderPreset("${tempName}","${safeLoc}","${safeExt}","${safeCustomName}")`, (res) => {
                    if (res && res.startsWith("ERROR:")) {
                        showCustomAlert(res.split("ERROR:")[1]);
                        nameEl.style.color = originalColor;
                    } else if (res === "SUCCESS") {
                        setTimeout(() => { nameEl.style.color = originalColor; }, 1000);
                    }
                });
            };

            // Edit / Delete buttons
            const actionsEl = document.createElement('div');
            actionsEl.className = 'preset-actions';
            actionsEl.style.cssText = 'display:flex; flex-direction:row; gap:4px; flex-shrink:0;';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-icon edit-btn';
            editBtn.style.cssText = 'background:transparent; border:1px solid transparent; color:var(--text-secondary); cursor:pointer; border-radius:4px; padding:6px 8px; font-size:11px;';
            editBtn.innerHTML = '✎';
            editBtn.setAttribute('data-tooltip', 'Rename Preset');
            editBtn.onmouseover = () => { editBtn.style.background = 'rgba(255,255,255,0.1)'; editBtn.style.color = 'var(--text-primary)'; };
            editBtn.onmouseout  = () => { editBtn.style.background = 'transparent'; editBtn.style.color = 'var(--text-secondary)'; };
            editBtn.onclick = () => openRenameModal(index);

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon delete-btn';
            delBtn.style.cssText = 'background:transparent; border:1px solid transparent; color:var(--text-secondary); cursor:pointer; border-radius:4px; padding:6px 8px; font-size:11px;';
            delBtn.innerHTML = '✕';
            delBtn.setAttribute('data-tooltip', 'Delete Preset');
            delBtn.onmouseover = () => { delBtn.style.background = 'rgba(255,60,60,0.2)'; delBtn.style.color = '#ff5555'; };
            delBtn.onmouseout  = () => { delBtn.style.background = 'transparent'; delBtn.style.color = 'var(--text-secondary)'; };
            delBtn.onclick = () => {
                renderPresets.splice(index, 1);
                savePresets();
                renderPresetList();
            };

            actionsEl.appendChild(editBtn);
            actionsEl.appendChild(delBtn);
            row.appendChild(checkEl);
            row.appendChild(nameEl);
            row.appendChild(actionsEl);
            container.appendChild(row);
        });
        // Apply correct checked visual state to all checkboxes
        updateCheckboxStyles();
    }

    // ------------------------------------------
    // RENDER BUTTON
    // ------------------------------------------
    const renderBtn = document.getElementById('renderBtn');
    if (renderBtn) {
        renderBtn.addEventListener('click', () => {
            if (!csInterface) return;
            const doImport       = importRenderCheck  ? importRenderCheck.checked  : false;
            const incNative      = includeNativeCheck ? includeNativeCheck.checked : false;
            const customNameEl   = document.getElementById('customFileNameInput');
            const safeCustomName = safeString(customNameEl ? customNameEl.value.trim() : "");
            const safeLoc        = safeString(renderLocation);

            const checkedPresets = renderPresets.filter(p => p.isChecked);
            const batchString    = checkedPresets.length > 0
                ? checkedPresets.map(p => safeString(p.templateName || p.name) + ":::&&:::" + safeString(p.ext || ".mp4")).join("|||")
                : "";

            csInterface.evalScript(`prepareQueue("${batchString}","${safeLoc}","${safeCustomName}","${incNative}")`, (res) => {
                if (!res || res === "EvalScript error.") return;
                if (res.startsWith("ERROR:")) return showCustomAlert(res.split("ERROR:")[1]);
                if (res.startsWith("QUEUE_LIST:::&&:::")) {
                    const queueData = res.split(":::&&:::")[1].split("|||");
                    if (queueData.length === 1) {
                        executeSpecific(queueData[0].split(":::")[0], doImport);
                    } else {
                        showQueueModal(queueData, doImport);
                    }
                }
            });
        });
    }

    // ------------------------------------------
    // QUEUE MODAL
    // ------------------------------------------
    const cancelQueueBtn = document.getElementById('cancelQueueBtn');
    if (cancelQueueBtn) cancelQueueBtn.onclick = () => queueModal.classList.remove('show');

    function showQueueModal(queueData, doImport) {
        if (!queueListContainer || !queueModal) return;
        queueListContainer.innerHTML = '';
        let lastIndex = -1;

        queueData.forEach(qItem => {
            const parts  = qItem.split(":::");
            const qIndex = parts[0];
            const qName  = parts[1];
            lastIndex = qIndex;

            const row = document.createElement('label');
            row.className    = 'preset-row';
            row.style.cursor = 'pointer';

            const chk = document.createElement('input');
            chk.type      = 'checkbox';
            chk.className = 'preset-checkbox queue-item-checkbox';
            chk.value     = qIndex;
            chk.checked   = true;

            const nameDiv = document.createElement('div');
            nameDiv.className = 'preset-name';
            nameDiv.innerText = qName;

            row.appendChild(chk);
            row.appendChild(nameDiv);
            queueListContainer.appendChild(row);
        });

        queueModal.classList.add('show');

        const renderLastBtn     = document.getElementById('renderLastBtn');
        const renderSelectedBtn = document.getElementById('renderSelectedBtn');

        if (renderLastBtn) {
            renderLastBtn.onclick = () => {
                queueModal.classList.remove('show');
                executeSpecific(lastIndex.toString(), doImport);
            };
        }
        if (renderSelectedBtn) {
            renderSelectedBtn.onclick = () => {
                const checkboxes      = queueListContainer.querySelectorAll('.queue-item-checkbox:checked');
                const selectedIndices = Array.from(checkboxes).map(c => c.value).join(",");
                if (!selectedIndices) return showCustomAlert("Please select at least one item to render.");
                queueModal.classList.remove('show');
                executeSpecific(selectedIndices, doImport);
            };
        }
    }

    // ------------------------------------------
    // EXECUTE RENDER
    // ------------------------------------------
    function executeSpecific(indicesStr, doImport) {
        if (!csInterface) return;
        const renderProgressModal = document.getElementById('renderProgressModal');
        const renderModalTitle    = document.getElementById('renderModalTitle');
        const renderModalDesc     = document.getElementById('renderModalDesc');

        if (renderModalTitle) { renderModalTitle.innerText = "Rendering in Progress"; renderModalTitle.style.color = "var(--accent-blue)"; }
        if (renderModalDesc)  renderModalDesc.innerText = "After Effects will be unresponsive until complete.";
        if (renderProgressModal) renderProgressModal.classList.add('show');

        setTimeout(() => {
            csInterface.evalScript(`executeSpecificRender("${indicesStr}",${doImport})`, (res) => {
                if (!res || res === "EvalScript error.") {
                    if (renderProgressModal) renderProgressModal.classList.remove('show');
                    return showCustomAlert("Backend rendering error.");
                }

                if (res.startsWith("IMPORT_PENDING:::&&:::")) {
                    if (renderModalTitle) { renderModalTitle.innerText = "Finalizing & Importing"; renderModalTitle.style.color = "rgba(46,160,67,1)"; }
                    if (renderModalDesc)  renderModalDesc.innerText = "Dropping file into active composition...";

                    const parts = res.split(":::&&:::");
                    setTimeout(() => {
                        csInterface.evalScript(`processImport("${parts[1]}","${safeString(parts[2])}")`, (importRes) => {
                            if (renderProgressModal) renderProgressModal.classList.remove('show');
                            if (importRes && importRes.startsWith("ERROR:")) showCustomAlert(importRes.split("ERROR:")[1]);
                        });
                    }, 1500);
                } else {
                    if (renderProgressModal) renderProgressModal.classList.remove('show');
                    if (res.startsWith("ERROR:")) showCustomAlert(res.split("ERROR:")[1]);
                }
            });
        }, 150);
    }

    // ------------------------------------------
    // SAVE PRESET MODAL
    // ------------------------------------------
    const savePresetBtn = document.getElementById('savePresetBtn');
    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', () => {
            if (presetNameInput) presetNameInput.value = "";
            if (presetModal)     presetModal.classList.add('show');
            if (presetNameInput) setTimeout(() => presetNameInput.focus(), 100);
        });
    }

    if (presetNameInput) {
        presetNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('applyPresetBtn').click();
        });
    }

    const cancelPresetBtn = document.getElementById('cancelPresetBtn');
    if (cancelPresetBtn) cancelPresetBtn.addEventListener('click', () => presetModal.classList.remove('show'));

    const applyPresetBtn = document.getElementById('applyPresetBtn');
    if (applyPresetBtn) {
        applyPresetBtn.addEventListener('click', () => {
            if (!csInterface) return;
            const name = presetNameInput ? presetNameInput.value.trim() : "";
            if (!name) return showCustomAlert("Please enter a name for your preset.");

            csInterface.evalScript(`saveRenderPreset("${safeString(name)}")`, (result) => {
                if (!result || result === "EvalScript error.") {
                    if (presetModal) presetModal.classList.remove('show');
                    return showCustomAlert("Backend error: Verify the render script is loaded in render.jsx!");
                }
                if (result.startsWith("SUCCESS:::&&:::")) {
                    const extractedExt = result.split(":::&&:::")[1];
                    renderPresets.push({ name: name, templateName: name, ext: extractedExt, isChecked: true });
                    savePresets();
                    renderPresetList();
                } else if (result.startsWith("ERROR:")) {
                    showCustomAlert(result.split("ERROR:")[1]);
                } else {
                    showCustomAlert(result);
                }
                if (presetModal) presetModal.classList.remove('show');
            });
        });
    }

    // ------------------------------------------
    // RENAME PRESET MODAL
    // ------------------------------------------
    let currentEditIndex = -1;

    window.openRenameModal = function(index) {
        currentEditIndex = index;
        if (renameInput)  renameInput.value = renderPresets[index].name;
        if (renameModal)  renameModal.classList.add('show');
        if (renameInput)  setTimeout(() => renameInput.focus(), 100);
    };

    if (renameInput) {
        renameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && applyRenameBtn) applyRenameBtn.click();
        });
    }

    if (cancelRenameBtn) cancelRenameBtn.addEventListener('click', () => renameModal.classList.remove('show'));

    if (applyRenameBtn) {
        applyRenameBtn.addEventListener('click', () => {
            const newName = renameInput ? renameInput.value.trim() : "";
            if (!newName) return showCustomAlert("Name cannot be empty.");
            if (currentEditIndex > -1) {
                renderPresets[currentEditIndex].name = newName;
                savePresets();
                renderPresetList();
            }
            if (renameModal) renameModal.classList.remove('show');
        });
    }

    // ------------------------------------------
    // BOOT
    // ------------------------------------------
    renderPresetList();
});
