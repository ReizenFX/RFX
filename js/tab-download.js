// This tab's ExtendScript backend (jsx/download.jsx), loaded on first use.
const downloadJsx = window.createJsxLoader('download.jsx');
window.addEventListener("DOMContentLoaded", () => {
    const csInterface = new CSInterface();
    let exec, spawn, path, fs, os;
    try {
        exec = require('child_process').exec;
        spawn = require('child_process').spawn; 
        path = require('path');
        fs = require('fs');
        os = require('os');
    } catch (e) { 
        alert("CRITICAL ERROR: Node.js is not enabled! The extension cannot run background processes."); 
    }

    // --- ADD THIS BLOCK ---
    const isWin = os.platform() === 'win32';

    // 1. Grab the system path
    let extPath = csInterface.getSystemPath(SystemPath.EXTENSION);

    // 2. Clean the path: Decode URI (%20 to space) and strip "file:\" or "file://" prefixes
    extPath = decodeURI(extPath).replace(/^file:[\\/]+/, '');
    
    // 3. Fix Windows-specific leading slashes (e.g., turns "/C:/..." into "C:/...")
    if (isWin && extPath.startsWith('/')) {
        extPath = extPath.substring(1);
    }

    const binDir = path.join(extPath, 'bin', 'win', 'download');
    
    // Define the exact paths to the executables based on the OS
    const localYtDlpPath = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
    const localFfmpegPath = path.join(binDir, isWin ? 'ffmpeg.exe' : 'ffmpeg');
    // ----------------------

    // ==========================================
    // CUSTOM DROPDOWN SYSTEM
    // ==========================================
    window.buildCustomDropdown = function(selectId) {
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return;

        let existingWrapper = selectEl.nextElementSibling;
        if (existingWrapper && existingWrapper.classList.contains('custom-select-wrapper')) {
            existingWrapper.remove();
        }

        selectEl.style.display = 'none';

        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        
        const display = document.createElement('div');
        display.className = 'custom-select-display';
        
        const list = document.createElement('div');
        list.className = 'custom-select-list';

        Array.from(selectEl.options).forEach(opt => {
            const item = document.createElement('div');
            item.className = 'custom-select-option';
            item.innerText = opt.text;
            
            if (opt.selected) {
                item.classList.add('selected');
                display.innerText = opt.text;
            }

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectEl.value = opt.value;
                selectEl.dispatchEvent(new Event('change'));
                display.innerText = opt.text;
                Array.from(list.children).forEach(child => child.classList.remove('selected'));
                item.classList.add('selected');
                wrapper.classList.remove('active');
            });
            list.appendChild(item);
        });

        if (selectEl.selectedIndex >= 0 && (!display.innerText || display.innerText.trim() === "")) {
            display.innerText = selectEl.options[selectEl.selectedIndex].text || "\u00A0";
        }

        display.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-select-wrapper').forEach(w => {
                if (w !== wrapper) w.classList.remove('active');
            });
            wrapper.classList.toggle('active');
        });

        wrapper.appendChild(display);
        wrapper.appendChild(list);
        selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
    };

    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('active'));
    });

    // Initialize the static dropdowns on load
    window.buildCustomDropdown('dlOperationMode');
    window.buildCustomDropdown('dlTrimMethod');

    const dlBtnText = document.getElementById('dlBtnText');
    if (dlBtnText) dlBtnText.innerText = "Download";

    // ==========================================
    // NOTIFICATION HELPER
    // ==========================================
    function showDlNotification(msg, type = 'error') {
        const overlay = document.getElementById('notificationOverlay'); 
        const text = document.getElementById('notificationText');
        const errIcon = document.getElementById('notif-icon-error');
        const succIcon = document.getElementById('notif-icon-success');
        if(!overlay || !text) { alert(msg); return; } 

        text.innerText = msg;
        if (type === 'success') {
            if(errIcon) errIcon.style.display = 'none';
            if(succIcon) succIcon.style.display = 'block';
        } else {
            if(errIcon) errIcon.style.display = 'block';
            if(succIcon) succIcon.style.display = 'none';
        }
        overlay.classList.add('show');
        clearTimeout(window.dlNotifTimeout);
        window.dlNotifTimeout = setTimeout(() => overlay.classList.remove('show'), 4000);
    }

    // ==========================================
    // SYNCED MEMORY
    // ==========================================
    let dlRelativeFolder = localStorage.getItem('zlp_relative_folder_name') || "Assets";
    let targetAeFolder = localStorage.getItem('zlp_ae_folder') || "Assets";
    let isDlPathHidden = localStorage.getItem('yt_dlp_hide_path') !== 'false';
    let currentValidModalPath = ""; 

    function getSavedPathForProject(aepFolder) {
        if (aepFolder === "UNSAVED") return null; 
        let pathsStr = localStorage.getItem('zlp_project_paths');
        if (!pathsStr) return null;
        try { return JSON.parse(pathsStr)[aepFolder] || null; } catch(e) { return null; }
    }

    function savePathForProject(aepFolder, customPath) {
        if (aepFolder === "UNSAVED") return; 
        let paths = {};
        let pathsStr = localStorage.getItem('zlp_project_paths');
        if (pathsStr) { try { paths = JSON.parse(pathsStr); } catch(e){} }
        
        if (customPath && customPath.trim() !== "") paths[aepFolder] = customPath;
        else delete paths[aepFolder]; 
        
        localStorage.setItem('zlp_project_paths', JSON.stringify(paths));
    }

    function updateDlPathDisplay() {
        downloadJsx(`downloadGetAepPath()`, (aepPath) => {
            let activeCustomPath = getSavedPathForProject(aepPath);
            const disp = document.getElementById('dlPathDisplay');
            if(!disp) return;
            if (activeCustomPath) disp.innerText = "Folder: " + activeCustomPath;
            else if (aepPath === "UNSAVED") disp.innerText = "Folder: Unsaved Project";
            else disp.innerText = `Folder: ${dlRelativeFolder} (Next to AEP)`;
        });
    }

    function updateDlPathVisibility() {
        const pathDisplay = document.getElementById('dlPathDisplay');
        const iconEyeOpen = document.getElementById('icon-dl-eye-open');
        const iconEyeClosed = document.getElementById('icon-dl-eye-closed');
        if(!pathDisplay) return;

        if (isDlPathHidden) {
            pathDisplay.classList.add('blurred');
            if(iconEyeOpen) iconEyeOpen.style.display = 'none';
            if(iconEyeClosed) iconEyeClosed.style.display = 'block';
        } else {
            pathDisplay.classList.remove('blurred');
            if(iconEyeOpen) iconEyeOpen.style.display = 'block';
            if(iconEyeClosed) iconEyeClosed.style.display = 'none';
        }
    }

    const toggleBtn = document.getElementById('toggleDlPathBtn');
    if(toggleBtn) toggleBtn.addEventListener('click', () => { isDlPathHidden = !isDlPathHidden; localStorage.setItem('yt_dlp_hide_path', isDlPathHidden); updateDlPathVisibility(); });
    updateDlPathVisibility();

    // ==========================================
    // MUTUALLY EXCLUSIVE TIMELINE CHECKBOXES
    // ==========================================
    const matchDurCheck = document.getElementById('dlMatchDurCheck');
    const stretchCheck = document.getElementById('dlStretchCheck');
    if (matchDurCheck && stretchCheck) {
        matchDurCheck.addEventListener('change', () => { if (matchDurCheck.checked) stretchCheck.checked = false; });
        stretchCheck.addEventListener('change', () => { if (stretchCheck.checked) matchDurCheck.checked = false; });
    }

    // ==========================================
    // MODAL 1: CHANGE FOLDER
    // ==========================================
    const dlFolderModal = document.getElementById('dlFolderModal');
    const dlCustomPathInput = document.getElementById('dlCustomPathInput');

    const btnChangeFolder = document.getElementById("dlChangeFolderBtn");
    if (btnChangeFolder) {
        btnChangeFolder.addEventListener("click", () => {
            downloadJsx(`downloadGetAepPath()`, (aepPath) => {
                let activeCustomPath = getSavedPathForProject(aepPath);
                if (!activeCustomPath && aepPath !== "UNSAVED") { activeCustomPath = path.join(aepPath, dlRelativeFolder); }
                currentValidModalPath = activeCustomPath || "";
                if (dlCustomPathInput) dlCustomPathInput.value = currentValidModalPath;
                if (dlFolderModal) dlFolderModal.classList.add('show');
            });
        });
    }

    document.getElementById("dlCancelModalBtn")?.addEventListener("click", () => dlFolderModal.classList.remove('show'));

    document.getElementById("dlBrowseBtn")?.addEventListener("click", () => {
        if (os.platform() === 'win32') {
            const scriptPath = path.join(os.tmpdir(), 'zlp_folder_picker_dl.ps1');
            const psScript = `
            if (-not ([System.Management.Automation.PSTypeName]'DpiAware').Type) { Add-Type -TypeDefinition @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class DpiAware {\n[DllImport("user32.dll")]\npublic static extern bool SetProcessDPIAware();\n}\n"@ }
            [DpiAware]::SetProcessDPIAware() | Out-Null
            Add-Type -AssemblyName System.Windows.Forms
            $dialog = New-Object System.Windows.Forms.OpenFileDialog
            $dialog.Title = "Navigate inside your desired folder and click 'Open'"
            $dialog.ValidateNames = $false
            $dialog.CheckFileExists = $false
            $dialog.CheckPathExists = $true
            $dialog.FileName = "Select_This_Folder"
            if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output ([System.IO.Path]::GetDirectoryName($dialog.FileName)) }
            `;
            fs.writeFileSync(scriptPath, psScript, 'utf8');
            exec(`powershell -ExecutionPolicy Bypass -sta -NoProfile -File "${scriptPath}"`, (error, stdout) => {
                if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
                const pickedPath = stdout.trim();
                if (pickedPath && fs.existsSync(pickedPath) && fs.lstatSync(pickedPath).isDirectory()) {
                    dlCustomPathInput.value = pickedPath;
                    currentValidModalPath = pickedPath; 
                }
            });
        }
    });

    document.getElementById("dlApplyModalBtn")?.addEventListener("click", () => {
        const newFolder = dlCustomPathInput.value.trim();
        const shouldMove = document.getElementById('dlMoveAssetsCheck')?.checked;
        let oldFolder = currentValidModalPath;

        downloadJsx(`downloadGetAepPath()`, (aepPath) => {
            if (newFolder === "") savePathForProject(aepPath, null);
            else savePathForProject(aepPath, newFolder);
            
            let targetFolder = newFolder === "" ? (aepPath !== "UNSAVED" ? path.join(aepPath, dlRelativeFolder) : path.join(os.homedir(), 'Downloads', dlRelativeFolder)) : newFolder;
            updateDlPathDisplay();
            dlFolderModal.classList.remove('show');

            if (shouldMove && oldFolder && targetFolder && fs.existsSync(oldFolder) && oldFolder !== targetFolder) {
                try {
                    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
                    let files = fs.readdirSync(oldFolder);
                    let movedCount = 0;
                    files.forEach(file => {
                        let oldFilePath = path.join(oldFolder, file);
                        let newFilePath = path.join(targetFolder, file);
                        if (fs.lstatSync(oldFilePath).isFile()) {
                            fs.renameSync(oldFilePath, newFilePath);
                            movedCount++;
                        }
                    });
                    if (movedCount > 0) {
                        downloadJsx(`relinkDirectoryAssets("${oldFolder.replace(/\\/g, '/')}", "${targetFolder.replace(/\\/g, '/')}")`);
                        showDlNotification(`Moved and relinked ${movedCount} assets!`, "success");
                    }
                } catch (err) { showDlNotification("Error moving files. Check folder permissions.", "error"); }
            }
        });
    });

    // ==========================================
    // MODAL 2: RENAME RELATIVE FOLDER
    // ==========================================
    const dlRenameRelativeModal = document.getElementById('dlRenameRelativeModal');
    const dlRenameRelativeInput = document.getElementById('dlRenameRelativeInput');

    document.getElementById("dlRenameRelativeBtn")?.addEventListener("click", () => {
        if (dlRenameRelativeInput) dlRenameRelativeInput.value = dlRelativeFolder;
        if (dlRenameRelativeModal) dlRenameRelativeModal.classList.add('show');
        setTimeout(() => { if (dlRenameRelativeInput) dlRenameRelativeInput.select(); }, 50);
    });

    document.getElementById("dlCancelRenameBtn")?.addEventListener("click", () => dlRenameRelativeModal.classList.remove('show'));

    document.getElementById("dlApplyRenameBtn")?.addEventListener("click", () => {
        let newName = dlRenameRelativeInput.value.trim().replace(/[\\/:*?"<>|]/g, '');
        if (!newName) return;
        
        let oldName = dlRelativeFolder;
        dlRelativeFolder = newName;
        localStorage.setItem('zlp_relative_folder_name', dlRelativeFolder);
        
        const shouldRenameMove = document.getElementById('dlRenameMoveCheck')?.checked;

        if (oldName !== newName && shouldRenameMove) {
            downloadJsx(`downloadGetAepPath()`, (aepPath) => {
                let baseDir = getSavedPathForProject(aepPath) || (aepPath !== "UNSAVED" ? aepPath : path.join(os.homedir(), 'Downloads'));
                let oldPath = path.join(baseDir, oldName);
                let newPath = path.join(baseDir, newName);

                if (fs.existsSync(oldPath)) {
                    try {
                        fs.renameSync(oldPath, newPath);
                        downloadJsx(`relinkDirectoryAssets("${oldPath.replace(/\\/g, '/')}", "${newPath.replace(/\\/g, '/')}")`);
                        showDlNotification("Folder renamed and assets relinked!", "success");
                    } catch (e) {
                        showDlNotification("Error renaming folder. Close AE bins and try again.", "error");
                    }
                } else {
                    showDlNotification("Saved (Folder didn't exist yet on disk).", "success");
                }
            });
        }
        updateDlPathDisplay();
        dlRenameRelativeModal.classList.remove('show');
    });

    // ==========================================
    // MODAL 3: TARGET AE FOLDER
    // ==========================================
    const dlAeFolderModal = document.getElementById('dlAeFolderModal');
    const dlAeFolderInput = document.getElementById('dlAeFolderInput');
    const dlAeFolderDropdown = document.getElementById('dlAeFolderDropdown');

    document.getElementById("dlChangeAeFolderBtn")?.addEventListener("click", () => {
        downloadJsx(`downloadGetAeFolders()`, (foldersString) => {
            if (dlAeFolderDropdown) {
                dlAeFolderDropdown.innerHTML = '<option value="">-- Or select an existing folder --</option>';
                if (foldersString !== "") {
                    foldersString.split(":::").forEach(f => {
                        let opt = document.createElement('option');
                        opt.value = f; opt.textContent = f;
                        dlAeFolderDropdown.appendChild(opt);
                    });
                }
            }
            if (dlAeFolderInput) dlAeFolderInput.value = targetAeFolder;
            if (dlAeFolderModal) dlAeFolderModal.classList.add('show');
        });
    });

    dlAeFolderDropdown?.addEventListener("change", function() { if (this.value !== "") dlAeFolderInput.value = this.value; });
    document.getElementById("dlCancelAeModalBtn")?.addEventListener("click", () => dlAeFolderModal.classList.remove('show'));

    document.getElementById("dlApplyAeModalBtn")?.addEventListener("click", () => {
        const desiredFolder = dlAeFolderInput.value.trim();
        if (desiredFolder !== "") {
            targetAeFolder = desiredFolder;
            localStorage.setItem('zlp_ae_folder', targetAeFolder);
        }
        dlAeFolderModal.classList.remove('show');
    });

    window.addEventListener('tabSwitched', (e) => {
        if (e.detail === 'tab-download') {
            dlRelativeFolder = localStorage.getItem('zlp_relative_folder_name') || "Assets";
            targetAeFolder = localStorage.getItem('zlp_ae_folder') || "Assets";
            updateDlPathDisplay();
        }
    });

    // ==========================================
    // DOWNLOAD ENGINE & LIVE CANCEL
    // ==========================================
    let currentVideoDuration = 0;
    let partCounter = 0;
    let currentDlProcess = null;
    let isDlAborted = false;
    let isDownloading = false;
    let lastTerminalLineWasProgress = false; 
    let isProcessFinished = false;

    function formatTimeSec(sec) {
        if(isNaN(sec) || sec < 0) return "00:00:00";
        let h = Math.floor(sec / 3600); let m = Math.floor((sec % 3600) / 60); let s = Math.floor(sec % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function parseTimeStr(str) {
        let parts = str.split(':').map(Number);
        if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        if (parts.length === 2) return (parts[0] * 60) + parts[1];
        return parts[0] || 0;
    }

    function parseFfmpegTime(timeStr) {
        let parts = timeStr.split(':');
        if (parts.length === 3) return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
        if (parts.length === 2) return (parseFloat(parts[0]) * 60) + parseFloat(parts[1]);
        return parseFloat(timeStr) || 0;
    }

    function formatEta(seconds) {
        if (!isFinite(seconds) || seconds < 0) return "--:--";
        let m = Math.floor(seconds / 60);
        let s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function appendToTerminal(line, isProgress) {
        const debugConsole = document.getElementById('dlDebugConsole');
        if (!debugConsole) return;
        
        // Handles \r lines properly so it overwrites instead of spamming downward
        if (isProgress && lastTerminalLineWasProgress) {
            let content = debugConsole.textContent;
            let lastNewline = content.lastIndexOf('\n', content.length - 2); 
            if (lastNewline !== -1) {
                debugConsole.textContent = content.substring(0, lastNewline + 1) + line + '\n';
            } else {
                debugConsole.textContent = line + '\n';
            }
        } else {
            debugConsole.textContent += line + '\n';
        }
        lastTerminalLineWasProgress = isProgress;
        debugConsole.scrollTop = debugConsole.scrollHeight;
    }
    
    // ==========================================
    // RIGHT-CLICK CONTEXT MENU FOR URL INPUT
    // ==========================================
    const dlUrlInput = document.getElementById('dlUrlInput');
    if (dlUrlInput) {
        function closeDlCtxMenu() {
            const old = document.getElementById('dynamic-ctx-menu');
            if (old) old.remove();
        }

        dlUrlInput.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            
            // Focus the input so Cut/Copy/Paste targets it correctly
            if (document.activeElement !== dlUrlInput) dlUrlInput.focus();

            closeDlCtxMenu();
            
            // Create the menu using the exact ID and Classes from tab-graph.css
            const menu = document.createElement('div');
            menu.className = 'ctx-menu';
            menu.id = 'dynamic-ctx-menu'; 
            menu.style.position = 'fixed';
            menu.style.zIndex = '999999';

            const items = [
                { label: 'Cut', action: () => { dlUrlInput.focus(); document.execCommand('cut'); } },
                { label: 'Copy', action: () => { dlUrlInput.focus(); document.execCommand('copy'); } },
                { sep: true }, 
                { label: 'Paste', action: () => {
                    // Refocus the input box after clicking the context menu
                    dlUrlInput.focus();
                    
                    // CRITICAL FIX: CEP extensions run on the "file://" protocol, which strictly 
                    // blocks JavaScript from reading the clipboard. We bypass the browser completely
                    // and use Node.js to ask the Operating System for the clipboard text!
                    const pasteCmd = isWin ? 'powershell -NoProfile -command "Get-Clipboard"' : 'pbpaste';
                    
                    exec(pasteCmd, { encoding: 'utf8' }, (err, stdout) => {
                        if (!err && stdout) {
                            // "insertText" acts exactly like a human typing, triggering native input events
                            document.execCommand('insertText', false, stdout.trim());
                        } else {
                            document.execCommand('paste'); // Absolute fallback
                        }
                    });
                }}
            ];

            // Build the menu DOM exactly like the graph tab
            items.forEach(it => {
                if (it.sep) {
                    const sep = document.createElement('div');
                    sep.className = 'ctx-sep';
                    menu.appendChild(sep);
                } else {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'ctx-item';
                    itemDiv.style.display = 'flex';
                    itemDiv.style.justifyContent = 'space-between';
                    itemDiv.style.alignItems = 'center';
                    
                    const textSpan = document.createElement('span');
                    textSpan.innerHTML = it.label;
                    itemDiv.appendChild(textSpan);

                    itemDiv.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        closeDlCtxMenu();
                        it.action();
                    });

                    menu.appendChild(itemDiv);
                }
            });

            document.body.appendChild(menu);

            // Position the menu at the cursor, ensuring it doesn't clip off-screen
            if (typeof window.repositionMenu === 'function') {
                window.repositionMenu(menu, e.clientX, e.clientY);
            } else {
                let posX = e.clientX;
                let posY = e.clientY;
                const rect = menu.getBoundingClientRect();
                if (posX + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 5;
                if (posY + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 5;
                menu.style.left = posX + 'px';
                menu.style.top = posY + 'px';
            }

            // Close the menu if the user clicks anywhere else
            setTimeout(() => document.addEventListener('click', closeDlCtxMenu, { once: true }), 50);
        });
    }
    const fetchBtn = document.getElementById('dlFetchBtn');
    if (fetchBtn) {
        fetchBtn.addEventListener('click', () => {
            const url = document.getElementById('dlUrlInput').value.trim();
            if (!url) { showDlNotification("Please paste a URL first.", "error"); return; }
            
            fetchBtn.style.opacity = '0.5';
            fetchBtn.style.pointerEvents = 'none';
            
            // Includes JS Engine fix for the initial fetch parsing
            exec(`"${localYtDlpPath}" --js-runtimes node --dump-json --no-playlist "${url}"`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                fetchBtn.style.opacity = '1';
                fetchBtn.style.pointerEvents = 'auto';
                
                if (error) { 
                    if(stderr && stderr.includes("not recognized")) showDlNotification("yt-dlp is not in your PATH.", "error");
                    else showDlNotification("Failed to fetch. Check your URL.", "error");
                    return; 
                }
                
                try {
                    // CRITICAL FIX: Safely parse JSON line-by-line so yt-dlp console warnings never crash the UI
                    let data = null;
                    const lines = stdout.split('\n');
                    for (let i = lines.length - 1; i >= 0; i--) {
                        if (lines[i].trim().startsWith('{')) {
                            try { data = JSON.parse(lines[i]); break; } catch(e){}
                        }
                    }
                    if (!data) throw new Error("JSON parse failed");
                    
                    currentVideoDuration = data.duration || 0;
                    document.getElementById('dlVideoTitle').innerText = data.title || "Media";
                    
                    window.ytDlpFormats = data.formats || [];
                    
                    if (!window.updateQualityDropdown) {
                        window.updateQualityDropdown = function() {
                            const trimMethod = document.getElementById('dlTrimMethod') ? document.getElementById('dlTrimMethod').value : 'local';
                            const qSelect = document.getElementById('dlQualitySelect');
                            if (!qSelect || !window.ytDlpFormats) return;

                            let validFormats = window.ytDlpFormats.filter(f => f.vcodec !== 'none' && f.height != null);
                            
                            // TRUE NATIVE NETWORK ENGINE:
                            // yt-dlp's instant chunk downloader ONLY works if the stream has both Video AND Audio built-in.
                            // If we allow split streams, it falls back to FFmpeg and freezes for 60 seconds.
                            // This guarantees the UI only shows formats that support INSTANT network trimming.
                            if (trimMethod === 'network') {
                                validFormats = validFormats.filter(f => f.acodec !== 'none');
                            }

                            let heights = [...new Set(validFormats.map(f => f.height))].sort((a,b) => b - a);
                            const standardHeights = [8640, 4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
                            let availableHeights = standardHeights.filter(sh => heights.some(h => h >= sh * 0.9 && h <= sh * 1.1));
                            if (availableHeights.length === 0 && heights.length > 0) availableHeights = heights;

                            qSelect.innerHTML = '';
                            let defaultSet = false;
                            availableHeights.forEach(h => {
                                let opt = document.createElement('option');
                                opt.value = h;
                                opt.textContent = h + 'p';
                                if (h <= 1080 && !defaultSet) {
                                    opt.selected = true;
                                    defaultSet = true;
                                }
                                qSelect.appendChild(opt);
                            });
                            if (availableHeights.length === 0) qSelect.innerHTML = '<option value="best">Best Available</option>';
                            if (window.buildCustomDropdown) window.buildCustomDropdown('dlQualitySelect');
                        };

                        const trimSelect = document.getElementById('dlTrimMethod');
                        if (trimSelect) {
                            trimSelect.addEventListener('change', window.updateQualityDropdown);
                        }
                    }
                    
                    window.updateQualityDropdown();

                    document.getElementById('dlPartsContainer').innerHTML = '';
                    const progWrap = document.getElementById('dlProgressWrapper');
                    if(progWrap) progWrap.style.display = 'none';
                    
                    partCounter = 0;
                    addSegmentUI(0, currentVideoDuration);
                    document.getElementById('dlTrimModal').classList.add('show');
                } catch (e) { showDlNotification("Error parsing video data.", "error"); }
            });
        });
    }

    function addSegmentUI(start, end) {
        partCounter++;
        const container = document.getElementById('dlPartsContainer');
        const div = document.createElement('div');
        div.className = 'dl-part-row';
        // Improved styling: added Segment Title and better spacing
        div.style.cssText = "background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px; position: relative;";
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 10px; font-weight: 800; color: var(--accent-blue); text-transform: uppercase; letter-spacing: 0.5px;">Segment ${partCounter}</span>
                ${partCounter > 1 ? `<button class="dl-part-remove" style="background: transparent; border: none; color: #ff5b5b; cursor: pointer; padding: 2px; opacity: 0.7; transition: 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Remove Segment"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : '<div></div>'}
            </div>
            <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 9px; color: var(--text-secondary); font-weight: bold; text-transform: uppercase;">Start Time</label>
                    <input type="text" class="dl-start-input modal-input" style="font-family: monospace; text-align: center; padding: 6px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-input); color: var(--text-primary);" value="${formatTimeSec(start)}">
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 9px; color: var(--text-secondary); font-weight: bold; text-transform: uppercase;">End Time</label>
                    <input type="text" class="dl-end-input modal-input" style="font-family: monospace; text-align: center; padding: 6px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-input); color: var(--text-primary);" value="${formatTimeSec(end)}">
                </div>
            </div>
            <div style="position:relative; height:16px; display:flex; align-items:center; margin: 8px 4px 4px 4px;">
                <div class="range-slider-container" style="position:relative; width:100%; height:4px; background: rgba(255,255,255,0.1); border-radius:2px;">
                    <div class="range-slider-fill" style="position:absolute; height:100%; background:var(--accent-blue); left:0%; right:0%; border-radius:2px;"></div>
                    <div class="range-thumb left-thumb" style="position:absolute; width:14px; height:14px; background:#fff; border-radius:50%; top:-5px; left:0%; transform:translateX(-50%); cursor:ew-resize; box-shadow:0 1px 4px rgba(0,0,0,0.5); z-index: 2;"></div>
                    <div class="range-thumb right-thumb" style="position:absolute; width:14px; height:14px; background:#fff; border-radius:50%; top:-5px; left:100%; transform:translateX(-50%); cursor:ew-resize; box-shadow:0 1px 4px rgba(0,0,0,0.5); z-index: 2;"></div>
                </div>
            </div>
        `;
        container.appendChild(div);

        if (partCounter > 1) {
            div.querySelector('.dl-part-remove').addEventListener('click', () => {
                // Smooth delete animation
                div.style.opacity = '0';
                div.style.transform = 'scale(0.95)';
                setTimeout(() => div.remove(), 150);
            });
        }

        let startSec = start;
        let endSec = end;
        const startInput = div.querySelector('.dl-start-input');
        const endInput = div.querySelector('.dl-end-input');
        const sliderFill = div.querySelector('.range-slider-fill');
        const leftThumb = div.querySelector('.left-thumb');
        const rightThumb = div.querySelector('.right-thumb');
        const track = div.querySelector('.range-slider-container');

        function updateVisuals() {
            let p1 = currentVideoDuration > 0 ? (startSec / currentVideoDuration) * 100 : 0;
            let p2 = currentVideoDuration > 0 ? (endSec / currentVideoDuration) * 100 : 100;
            leftThumb.style.left = p1 + '%'; rightThumb.style.left = p2 + '%';
            sliderFill.style.left = p1 + '%'; sliderFill.style.width = (p2 - p1) + '%';
            startInput.value = formatTimeSec(startSec); endInput.value = formatTimeSec(endSec);
        }

        // Fixes input jumping while typing by updating on "blur" (clicking away) instead of "change"
        startInput.addEventListener('blur', () => { startSec = Math.max(0, Math.min(parseTimeStr(startInput.value), endSec)); updateVisuals(); });
        endInput.addEventListener('blur', () => { endSec = Math.max(startSec, Math.min(parseTimeStr(endInput.value), currentVideoDuration)); updateVisuals(); });

        // Add Enter key support
        startInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') startInput.blur(); });
        endInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') endInput.blur(); });

        let activeThumb = null;
        function pointerMove(e) {
            if (!activeThumb) return;
            let rect = track.getBoundingClientRect();
            let perc = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            let sec = perc * currentVideoDuration;
            if (activeThumb === 'left') {
                startSec = Math.min(sec, endSec);
                leftThumb.style.zIndex = "3"; rightThumb.style.zIndex = "2";
            } else {
                endSec = Math.max(sec, startSec);
                rightThumb.style.zIndex = "3"; leftThumb.style.zIndex = "2";
            }
            updateVisuals();
        }
        function pointerUp() { activeThumb = null; document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', pointerUp); }
        leftThumb.addEventListener('pointerdown', () => { activeThumb = 'left'; document.addEventListener('pointermove', pointerMove); document.addEventListener('pointerup', pointerUp); });
        rightThumb.addEventListener('pointerdown', () => { activeThumb = 'right'; document.addEventListener('pointermove', pointerMove); document.addEventListener('pointerup', pointerUp); });

        // Smooth Entrance Animation
        div.style.transition = 'all 0.2s ease-out';
        div.style.opacity = '0';
        div.style.transform = 'translateY(10px)';
        setTimeout(() => { div.style.opacity = '1'; div.style.transform = 'translateY(0)'; }, 10);

        updateVisuals();
    }

    // --- ADD SEGMENT BUTTON LOGIC ---
    // Connects to your HTML button (assuming it has ID "dlAddSegmentBtn" or "dlAddPartBtn")
    const btnAddSegment = document.getElementById('dlAddSegmentBtn') || document.getElementById('dlAddPartBtn');
    if (btnAddSegment) {
        btnAddSegment.addEventListener('click', () => {
            if (currentVideoDuration <= 0) return;
            
            // Limit to 20 segments to keep AE and FFmpeg from freezing
            if (document.querySelectorAll('.dl-part-row').length >= 20) {
                showDlNotification("Maximum segments reached.", "error");
                return;
            }

            // SMART PLACEMENT: Look at where the last segment ended
            let allEnds = Array.from(document.querySelectorAll('.dl-end-input')).map(inp => parseTimeStr(inp.value));
            let lastEnd = allEnds.length > 0 ? Math.max(...allEnds) : 0;
            
            // Default new segment to a 10-second block right after the previous one
            let newStart = lastEnd;
            let newEnd = Math.min(newStart + 10, currentVideoDuration); 
            
            // If the last segment ended exactly at the end of the video, bump the new one back a bit
            if (newStart >= currentVideoDuration) {
                newStart = Math.max(0, currentVideoDuration - 10);
                newEnd = currentVideoDuration;
            }
            
            addSegmentUI(newStart, newEnd);

            // Auto-scroll the container so you can see the new row instantly
            const container = document.getElementById('dlPartsContainer');
            setTimeout(() => {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            }, 50);
        });
    }

    document.getElementById('cancelDlBtn')?.addEventListener('click', () => {
        if(!isDownloading) document.getElementById('dlTrimModal').classList.remove('show');
    });

    const confirmDlBtn = document.getElementById('confirmDlBtn');
    if(confirmDlBtn) {
        confirmDlBtn.addEventListener('click', () => {
            
            if (isDownloading) {
                isDlAborted = true;
                if(dlBtnText) dlBtnText.innerText = "Stopping...";
                confirmDlBtn.style.pointerEvents = 'none';
                document.getElementById('dlProgressStatus').innerText = "Stopping & Cleaning up...";
                if (currentDlProcess) {
                    if (os.platform() === 'win32') exec(`taskkill /pid ${currentDlProcess.pid} /t /f`);
                    else currentDlProcess.kill('SIGKILL');
                }
                return;
            }

            const url = document.getElementById('dlUrlInput').value.trim();
            const isAudio = document.getElementById('dlAudioOnlyCheck').checked;
            const opMode = document.getElementById('dlOperationMode').value;
            const quality = document.getElementById('dlQualitySelect') ? document.getElementById('dlQualitySelect').value : 'best';
            const trimMethod = document.getElementById('dlTrimMethod') ? document.getElementById('dlTrimMethod').value : 'local';
            
            isDownloading = true;
            isDlAborted = false;
            isProcessFinished = false;
            lastTerminalLineWasProgress = false;
            
            if(dlBtnText) dlBtnText.innerText = "STOP";
            confirmDlBtn.style.background = "#ff5b5b";
            confirmDlBtn.style.borderColor = "#ff5b5b";
            confirmDlBtn.style.color = "#ffffff";
            
            const progWrap = document.getElementById('dlProgressWrapper');
            if(progWrap) {
                progWrap.style.display = 'flex';
                document.getElementById('dlProgressBar').style.width = '0%';
                document.getElementById('dlProgressStatus').innerText = "Starting engine...";
                document.getElementById('dlProgressEta').innerText = "ETA: Calc...";
                document.getElementById('dlProgressBar').style.background = "var(--accent-blue)";
                
                const debugConsole = document.getElementById('dlDebugConsole');
                if (debugConsole) debugConsole.textContent = "";
            }

            let rawSegments = [];
            document.querySelectorAll('.dl-part-row').forEach(row => {
                let s = parseTimeStr(row.querySelector('.dl-start-input').value);
                let e = parseTimeStr(row.querySelector('.dl-end-input').value);
                if (s < e) rawSegments.push({s, e});
            });

            let finalSegments = [];
            let downloadTasks = [];
            let totalDownloadSeconds = 0;

            const isDefaultFullRangeUntouched = rawSegments.length === 1 &&
                rawSegments[0].s <= 0.5 &&
                Math.abs(rawSegments[0].e - currentVideoDuration) <= 1.5;

            if (!isDefaultFullRangeUntouched) {
                if (opMode === 'trim') {
                    rawSegments.forEach(seg => {
                        let dur = seg.e - seg.s;
                        downloadTasks.push({ s: seg.s, e: seg.e, dur: dur });
                        totalDownloadSeconds += dur;
                        finalSegments.push(`*${formatTimeSec(seg.s)}-${formatTimeSec(seg.e)}`);
                    });
                } else {
                    rawSegments.sort((a,b) => a.s - b.s);
                    let merged = [];
                    rawSegments.forEach(seg => {
                        if(merged.length === 0) merged.push(seg);
                        else {
                            let last = merged[merged.length-1];
                            if(seg.s <= last.e) last.e = Math.max(last.e, seg.e);
                            else merged.push(seg);
                        }
                    });

                    let current = 0;
                    merged.forEach(seg => {
                        if (seg.s > current) {
                            let dur = seg.s - current;
                            downloadTasks.push({ s: current, e: seg.s, dur: dur });
                            totalDownloadSeconds += dur;
                            finalSegments.push(`*${formatTimeSec(current)}-${formatTimeSec(seg.s)}`);
                        }
                        current = seg.e;
                    });
                    if (current < currentVideoDuration) {
                        let dur = currentVideoDuration - current;
                        downloadTasks.push({ s: current, e: currentVideoDuration, dur: dur });
                        totalDownloadSeconds += dur;
                        finalSegments.push(`*${formatTimeSec(current)}-inf`);
                    }
                }
            } else {
                // CRITICAL FIX: If the user leaves the timeline untouched, we MUST populate the array.
                // Otherwise, Network Trim skips its loop entirely and silently closes the modal!
                downloadTasks.push({ s: 0, e: currentVideoDuration, dur: currentVideoDuration });
                finalSegments.push(`*00:00:00-inf`);
            }

            if (totalDownloadSeconds <= 0) totalDownloadSeconds = currentVideoDuration || 1;

            downloadJsx(`downloadGetAepPath()`, async (aepPath) => {
                let targetDir = getSavedPathForProject(aepPath) || (aepPath !== "UNSAVED" ? path.join(aepPath, dlRelativeFolder) : path.join(os.homedir(), 'Downloads', dlRelativeFolder));
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

                let beforeFiles = fs.existsSync(targetDir) ? fs.readdirSync(targetDir) : [];
                const progressFile = path.join(os.tmpdir(), `zlp_ffmpeg_prog_${Date.now()}.txt`).replace(/\\/g, '/');
                try { fs.writeFileSync(progressFile, ""); } catch(e){}

                let currentItemIndex = 0;

                // 1. I RESTORED YOUR MISSING UI WATCHER
                // This forces the UI to read FFmpeg's progress during the 60-second network trim
                let progressWatcher = setInterval(() => {
                    if (fs.existsSync(progressFile)) {
                        try {
                            let content = fs.readFileSync(progressFile, 'utf8');
                            let timeMatches = [...content.matchAll(/out_time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/g)];
                            if (timeMatches.length > 0) {
                                let timeStr = timeMatches[timeMatches.length - 1][1];
                                let currentSec = parseFfmpegTime(timeStr);
                                let task = downloadTasks[currentItemIndex] || {dur: totalDownloadSeconds};
                                let perc = Math.min(100, (currentSec / task.dur) * 100).toFixed(1);
                                
                                document.getElementById('dlProgressBar').style.width = perc + '%';
                                document.getElementById('dlProgressStatus').innerText = `FFmpeg Network Seek: ${perc}%`;
                                document.getElementById('dlProgressBar').style.background = '#e6a100'; // Yellow to indicate network processing
                            }
                        } catch(e) {}
                    }
                }, 500);

                const runProcessAsync = (binPath, args, stepName) => {
                    return new Promise((resolve, reject) => {
                        if (isDlAborted) return resolve(-1);
                        appendToTerminal(`\n[SYSTEM] Starting ${stepName}...`, false);
                        
                        currentDlProcess = spawn(binPath, args, { shell: false, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
                        currentDlProcess.stdout.on('data', processStream);
                        currentDlProcess.stderr.on('data', processStream);
                        
                        currentDlProcess.on('close', code => resolve(code));
                        currentDlProcess.on('error', err => reject(err));
                    });
                };

                let streamBuffer = "";
                let fullStdout = "";
                let completedSeconds = 0;
                let currentFfmpegSpeed = 0; 
                let hasHitDownload = false;
                let isFinalizingPhase = false;

                function doImport(files) {
                    document.getElementById('dlTrimModal').classList.remove('show');
                    const aeFolder = targetAeFolder.replace(/"/g, '\\"'); 
                    const importProj = document.getElementById('dlImportProjCheck').checked;
                    const importComp = document.getElementById('dlImportCompCheck').checked;
                    const matchDur = document.getElementById('dlMatchDurCheck').checked;
                    const stretch = document.getElementById('dlStretchCheck').checked;

                    const pathStr = files.map(p => p.replace(/\\/g, '/')).join('|||');
                    
                    downloadJsx(`importDownloadedMedia("${pathStr}", ${importProj}, "${aeFolder}", ${importComp}, ${matchDur}, ${stretch})`, (res) => {
                        if (res === "OK") {
                            showDlNotification("Downloaded and imported successfully!", "success");
                            document.getElementById('dlUrlInput').value = '';
                        } else {
                            showDlNotification("AE Error: " + res, "error");
                        }
                    });
                }

                function finalizeDownload(code, finalFilesOverride) {
                    clearInterval(progressWatcher); // Stop watching
                    try { fs.unlinkSync(progressFile); } catch(e){}
                    if (isProcessFinished) return;
                    isProcessFinished = true;
                    isDownloading = false;
                    
                    if(dlBtnText) dlBtnText.innerText = "Download";
                    confirmDlBtn.style.background = "";
                    confirmDlBtn.style.borderColor = "";
                    confirmDlBtn.style.color = "";
                    confirmDlBtn.style.pointerEvents = 'auto';

                    if (isDlAborted) {
                        document.getElementById('dlTrimModal').classList.remove('show');
                        showDlNotification("Download stopped and files cleaned.", "success");
                        return;
                    }

                    if (code !== 0 && (!finalFilesOverride || finalFilesOverride.length === 0)) {
                        document.getElementById('dlProgressStatus').innerText = `Finished / Failed (Code ${code})`;
                        document.getElementById('dlProgressBar').style.width = '100%';
                        document.getElementById('dlProgressBar').style.background = '#ff5b5b'; 
                        showDlNotification("Download failed. Read black box.", "error");
                        return; 
                    }

                    doImport(finalFilesOverride || []);
                }

                function processStream(data) {
                    const text = data.toString();
                    fullStdout += text;
                    streamBuffer += text;
                    const chunks = streamBuffer.split(/[\r\n]+/);
                    streamBuffer = chunks.pop(); 

                    for (let i = 0; i < chunks.length; i++) {
                        let cleanLine = chunks[i].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
                        if (!cleanLine) continue;
                        appendToTerminal(cleanLine, false);
                        
                        const percMatch = cleanLine.match(/\[download\].*?([\d\.]+)\s*%/i);
                        const fragMatch = cleanLine.match(/Frag\s+(\d+)\/(\d+)/i);

                        if (percMatch) {
                            document.getElementById('dlProgressBar').style.width = percMatch[1] + '%';
                            document.getElementById('dlProgressStatus').innerText = `Downloading: ${percMatch[1]}%`;
                            document.getElementById('dlProgressBar').style.background = 'var(--accent-blue)';
                        } else if (fragMatch) {
                            let fragPerc = ((parseInt(fragMatch[1]) / parseInt(fragMatch[2])) * 100).toFixed(1);
                            document.getElementById('dlProgressBar').style.width = fragPerc + '%';
                            document.getElementById('dlProgressStatus').innerText = `Downloading Chunks: ${fragPerc}%`;
                            document.getElementById('dlProgressBar').style.background = 'var(--accent-blue)';
                        }

                        // 2. I RESTORED THE "SEEKING" WARNING
                        if (cleanLine.includes('[download] Destination:') && trimMethod === 'network') {
                            document.getElementById('dlProgressStatus').innerText = "Network Probe... (Can take 60s)";
                            document.getElementById('dlProgressBar').style.background = '#e6a100';
                        }
                    }
                }

                try {
                    // 3. I RESTORED THE "--downloader-args" 
                    // This allows FFmpeg to output progress to the file we are watching
                    let baseArgs = [
                        '--newline', '--no-colors', '--no-continue', '--js-runtimes', 'node',
                        '--ffmpeg-location', localFfmpegPath, // CRITICAL: Fixes silent crash in Network Trim
                        '--downloader-args', `ffmpeg:-nostdin -nostats -progress "${progressFile}"`
                    ];
                    let finalImportFiles = [];

                    if (trimMethod === 'network' && !isAudio) {
                        for (let i = 0; i < downloadTasks.length; i++) {
                            if (isDlAborted) break;
                            currentItemIndex = i; // Track for UI
                            let task = downloadTasks[i];

                            document.getElementById('dlProgressStatus').innerText = `[Step 1/3] Video Probe...`;
                            document.getElementById('dlProgressBar').style.width = '33%'; 
                            document.getElementById('dlProgressBar').style.background = 'var(--accent-blue)';
                            
                            let tempVideoPath = path.join(targetDir, `temp_vid_${i}_${Date.now()}.mp4`).replace(/\\/g, '/');
                            
                            // CRITICAL FIX: Use native -S sorting to prevent Shorts from failing height checks
                            let videoArgs = [
                                ...baseArgs,
                                '-f', 'bestvideo[ext=mp4]/bestvideo/best',
                                '--download-sections', `*${task.s}-${task.e}`,
                                '-o', tempVideoPath,
                                url
                            ];
                            if (quality !== 'best') videoArgs.push('-S', `res:${quality}`);
                            let vCode = await runProcessAsync(localYtDlpPath, videoArgs, `Video Chunk ${i+1}`);
                            if (isDlAborted) break;
                            if (vCode !== 0) { finalizeDownload(vCode, []); return; } // CRITICAL: Stop silent crashes

                            document.getElementById('dlProgressStatus').innerText = `[Step 2/3] Audio Probe...`;
                            document.getElementById('dlProgressBar').style.width = '66%'; 
                            
                            let tempAudioPath = path.join(targetDir, `temp_aud_${i}_${Date.now()}.m4a`).replace(/\\/g, '/');
                            
                            // AUDIO FALLBACKS ADDED HERE:
                            let audioArgs = [
                                ...baseArgs,
                                '-f', 'bestaudio[ext=m4a]/bestaudio[ext=aac]/bestaudio/ba',
                                '--download-sections', `*${task.s}-${task.e}`,
                                '-o', tempAudioPath,
                                url
                            ];
                            let aCode = await runProcessAsync(localYtDlpPath, audioArgs, `Audio Chunk ${i+1}`);
                            if (isDlAborted) break;
                            if (aCode !== 0) { finalizeDownload(aCode, []); return; } // CRITICAL: Stop silent crashes

                            // 3. THE SMART SWITCH (UNIVERSAL FFMPEG MERGE)
                            document.getElementById('dlProgressStatus').innerText = `[Step 3/3] Synchronizing AV...`;
                            document.getElementById('dlProgressBar').style.width = '90%';
                            
                            let finalMergedPath = path.join(targetDir, `Segment_${task.s}_${Date.now()}.mp4`).replace(/\\/g, '/');
                            let ffmpegArgs = [];

                            // SMART SWITCH: Physically checks your hard drive. 
                            // If the separate audio file exists, it merges them. 
                            // If it doesn't, the video is already pre-merged!
                            if (fs.existsSync(tempAudioPath)) {
                                ffmpegArgs = [
                                    '-y',
                                    '-i', tempVideoPath,
                                    '-i', tempAudioPath,
                                    '-t', task.dur.toString(), 
                                    '-c:v', 'libx264',
                                    '-preset', 'fast',
                                    '-crf', '18',
                                    '-pix_fmt', 'yuv420p', // FORCES ADOBE-COMPATIBLE TIMELINE COLORS
                                    '-c:a', 'aac',
                                    '-map', '0:v:0',
                                    '-map', '1:a:0',
                                    finalMergedPath
                                ];
                            } else {
                                ffmpegArgs = [
                                    '-y',
                                    '-i', tempVideoPath,
                                    '-t', task.dur.toString(), 
                                    '-c:v', 'libx264',
                                    '-preset', 'fast',
                                    '-crf', '18',
                                    '-pix_fmt', 'yuv420p', // FORCES ADOBE-COMPATIBLE TIMELINE COLORS
                                    '-c:a', 'aac',
                                    finalMergedPath
                                ];
                            }

                            await runProcessAsync(localFfmpegPath, ffmpegArgs, `Local Merge ${i+1}`);

                            try { fs.unlinkSync(tempVideoPath); } catch(e){}
                            try { fs.unlinkSync(tempAudioPath); } catch(e){}

                            if (fs.existsSync(finalMergedPath)) finalImportFiles.push(finalMergedPath);
                        }

                        // CRITICAL FIX: Use filter_complex to bypass Windows text-file path bugs
                        if (opMode === 'cut' && finalImportFiles.length > 1) {
                            document.getElementById('dlProgressStatus').innerText = "Merging cut segments...";
                            let ext = path.extname(finalImportFiles[0]);
                            let mergedPath = path.join(targetDir, `Final_Cut_${Date.now()}${ext}`);
                            
                            let filterArgs = ['-y'];
                            let filterStr = "";
                            for (let j = 0; j < finalImportFiles.length; j++) {
                                filterArgs.push('-i', finalImportFiles[j]);
                                if (isAudio) filterStr += `[${j}:a:0]`;
                                else filterStr += `[${j}:v:0][${j}:a:0]`;
                            }
                            
                            if (isAudio) {
                                filterStr += `concat=n=${finalImportFiles.length}:v=0:a=1[outa]`;
                                filterArgs.push('-filter_complex', filterStr, '-map', '[outa]', '-c:a', 'aac', mergedPath);
                            } else {
                                filterStr += `concat=n=${finalImportFiles.length}:v=1:a=1[outv][outa]`;
                                filterArgs.push('-filter_complex', filterStr, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', mergedPath);
                            }
                            
                            await runProcessAsync(localFfmpegPath, filterArgs, "Final Concat");
                            if (isDlAborted) return;
                            
                            if (fs.existsSync(mergedPath)) {
                                finalImportFiles.forEach(f => { try { fs.unlinkSync(f); } catch(e){} });
                                finalImportFiles = [mergedPath];
                            }
                        }

                        finalizeDownload(0, finalImportFiles);

                    } else {
                        let stdArgs = [...baseArgs];
                        if (isAudio) {
                            stdArgs.push('-x', '--audio-format', 'mp3');
                            stdArgs.push('-f', 'bestaudio[ext=m4a]/ba');
                            if (trimMethod === 'network') finalSegments.forEach(s => stdArgs.push('--download-sections', '*' + s.replace(/[\*]/g, '')));
                        } else {
                            // CRITICAL FIX: Use native -S sorting for standard downloads as well
                            stdArgs.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
                            if (quality !== 'best') stdArgs.push('-S', `res:${quality}`);
                        }

                        let outFile = path.join(targetDir, `%(title)s_%(section_start)s.%(ext)s`);
                        stdArgs.push('-o', outFile, url);
                        
                        let code = await runProcessAsync(localYtDlpPath, stdArgs, "Standard Download");
                        if (isDlAborted) return;

                        let afterFiles = fs.readdirSync(targetDir);
                        let filesImported = afterFiles.filter(f => !beforeFiles.includes(f) && /\.(mp4|mp3|m4a|webm|mkv|wav)$/i.test(f)).map(f => path.join(targetDir, f));

                        if (trimMethod === 'local' && downloadTasks.length > 0 && filesImported.length === 1) {
                            document.getElementById('dlProgressStatus').innerText = "Trimming Locally (Instant)...";
                            let baseFile = filesImported[0];
                            let ext = path.extname(baseFile);
                            let slicedFiles = [];
                            
                            for (let i = 0; i < downloadTasks.length; i++) {
                                let task = downloadTasks[i];
                                let outPath = baseFile.replace(ext, `_${task.s}${ext}`);
                                let trimArgs = [
                                    '-y', 
                                    '-ss', task.s.toString(), 
                                    '-i', baseFile, 
                                    '-t', task.dur.toString(), 
                                    '-c:v', 'libx264', 
                                    '-preset', 'fast', 
                                    '-crf', '18', 
                                    '-pix_fmt', 'yuv420p', // FORCES ADOBE-COMPATIBLE TIMELINE COLORS
                                    '-c:a', 'aac', 
                                    outPath
                                ];
                                await runProcessAsync(localFfmpegPath, trimArgs, `Local Trim ${i+1}`);
                                slicedFiles.push(outPath);
                            }
                            try { fs.unlinkSync(baseFile); } catch(e){} 
                            filesImported = slicedFiles;
                        }

                        // CRITICAL FIX: Use filter_complex to bypass Windows text-file path bugs
                        if (opMode === 'cut' && filesImported.length > 1 && code === 0) {
                            document.getElementById('dlProgressStatus').innerText = "Merging cut segments...";
                            let ext = path.extname(filesImported[0]);
                            let mergedPath = path.join(targetDir, `Final_Cut_${Date.now()}${ext}`);
                            
                            let filterArgs = ['-y'];
                            let filterStr = "";
                            for (let j = 0; j < filesImported.length; j++) {
                                filterArgs.push('-i', filesImported[j]);
                                if (isAudio) filterStr += `[${j}:a:0]`;
                                else filterStr += `[${j}:v:0][${j}:a:0]`;
                            }
                            
                            if (isAudio) {
                                filterStr += `concat=n=${filesImported.length}:v=0:a=1[outa]`;
                                filterArgs.push('-filter_complex', filterStr, '-map', '[outa]', '-c:a', 'aac', mergedPath);
                            } else {
                                filterStr += `concat=n=${filesImported.length}:v=1:a=1[outv][outa]`;
                                filterArgs.push('-filter_complex', filterStr, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', mergedPath);
                            }
                            
                            await runProcessAsync(localFfmpegPath, filterArgs, "Final Concat");
                            if (isDlAborted) return;
                            
                            if (fs.existsSync(mergedPath)) {
                                filesImported.forEach(f => { try { fs.unlinkSync(f); } catch(e){} });
                                filesImported = [mergedPath];
                            }
                        }

                        finalizeDownload(code, filesImported);
                    }

                } catch (err) {
                    appendToTerminal(`\n[FATAL ERROR] ${err.message}`, false);
                    finalizeDownload(1, []);
                }
            });
        });
    }
    updateDlPathDisplay();
});