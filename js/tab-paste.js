// Wrapped in DOMContentLoaded to prevent variable crashes with tab-color.js
window.addEventListener("DOMContentLoaded", () => {
    
    const csInterface = new CSInterface();
    let exec, path, fs, os;
    try {
        exec = require('child_process').exec;
        path = require('path');
        fs = require('fs');
        os = require('os');
    } catch (e) {
        console.warn("Node modules not loaded.");
    }

    // ==========================================
    // NOTIFICATION SYSTEM
    // ==========================================
    function showNotification(msg, type = 'error') {
        const overlay = document.getElementById('notificationOverlay');
        const text = document.getElementById('notificationText');
        const errIcon = document.getElementById('notif-icon-error');
        const succIcon = document.getElementById('notif-icon-success');

        text.innerText = msg;
        if (type === 'success') {
            errIcon.style.display = 'none';
            succIcon.style.display = 'block';
        } else {
            errIcon.style.display = 'block';
            succIcon.style.display = 'none';
        }

        overlay.classList.add('show');

        clearTimeout(window.notifTimeout);
        window.notifTimeout = setTimeout(() => {
            overlay.classList.remove('show');
        }, 4000);
    }

    document.getElementById('closeNotificationBtn').addEventListener('click', () => {
        document.getElementById('notificationOverlay').classList.remove('show');
    });

    // ==========================================
    // DYNAMIC RELATIVE FOLDER LOGIC
    // ==========================================
    let isFirstBoot = false;
    let relativeFolderName = localStorage.getItem('zlp_relative_folder_name');

    if (!relativeFolderName) {
        relativeFolderName = "Assets"; 
        isFirstBoot = true;
    }

    // ==========================================
    // PER-PROJECT MEMORY LOGIC 
    // ==========================================
    function getSavedPathForProject(aepFolder) {
        if (aepFolder === "UNSAVED") return null; 
        let pathsStr = localStorage.getItem('zlp_project_paths');
        if (!pathsStr) return null;
        try {
            let paths = JSON.parse(pathsStr);
            return paths[aepFolder] || null;
        } catch(e) { return null; }
    }

    function savePathForProject(aepFolder, customPath) {
        if (aepFolder === "UNSAVED") return; 
        let paths = {};
        let pathsStr = localStorage.getItem('zlp_project_paths');
        if (pathsStr) {
            try { paths = JSON.parse(pathsStr); } catch(e){}
        }
        if (customPath && customPath.trim() !== "") {
            paths[aepFolder] = customPath;
        } else {
            delete paths[aepFolder]; 
        }
        localStorage.setItem('zlp_project_paths', JSON.stringify(paths));
    }

    function updateMainPathDisplay() {
        csInterface.evalScript(`getAepPath()`, (aepPath) => {
            let activeCustomPath = getSavedPathForProject(aepPath);
            if (activeCustomPath) {
                document.getElementById('pathDisplay').innerText = "Folder: " + activeCustomPath;
            } else {
                if (aepPath === "UNSAVED") {
                    document.getElementById('pathDisplay').innerText = "Folder: Unsaved Project";
                } else {
                    document.getElementById('pathDisplay').innerText = `Folder: ${relativeFolderName} (Next to AEP)`;
                }
            }
        });
    }
    updateMainPathDisplay();

    let currentValidModalPath = ""; 
    let targetAeFolder = localStorage.getItem('zlp_ae_folder') || "Assets";

    function safePath(p) { return p.replace(/\\/g, '/'); }
    function safeString(s) { return s.replace(/"/g, '\\"'); }

    // ==========================================
    // TAB SWITCH / FIRST BOOT TRIGGER
    // ==========================================
    window.addEventListener('tabSwitched', (e) => {
        if (e.detail === 'tab-paste') {
            updateMainPathDisplay();
            if (isFirstBoot) {
                const initInput = document.getElementById('initRelativeInput');
                const initModal = document.getElementById('initRelativeModal');
                if (initInput && initModal) {
                    initInput.value = "Assets";
                    initModal.classList.add('show');
                    setTimeout(() => initInput.select(), 50);
                }
            }
        }
    });

    const cancelInitBtn = document.getElementById('cancelInitBtn');
    if (cancelInitBtn) {
        cancelInitBtn.addEventListener('click', () => {
            document.getElementById('initRelativeModal').classList.remove('show');
            isFirstBoot = false;
            localStorage.setItem('zlp_relative_folder_name', relativeFolderName);
            updateMainPathDisplay();
        });
    }

    const applyInitBtn = document.getElementById('applyInitBtn');
    if (applyInitBtn) {
        applyInitBtn.addEventListener('click', () => {
            let newName = document.getElementById('initRelativeInput').value.trim();
            if (!newName) {
                showNotification("Folder name cannot be empty.", "error");
                return;
            }
            newName = newName.replace(/[\\/:*?"<>|]/g, '');
            relativeFolderName = newName;
            localStorage.setItem('zlp_relative_folder_name', relativeFolderName);
            
            isFirstBoot = false;
            updateMainPathDisplay();
            document.getElementById('initRelativeModal').classList.remove('show');
        });
    }

    // ==========================================
    // RENAME RELATIVE FOLDER LOGIC 
    // ==========================================
    const renameRelativeModal = document.getElementById('renameRelativeModal');
    const renameRelativeInput = document.getElementById('renameRelativeInput');
    const cancelRenameBtn = document.getElementById('cancelRenameBtn');

    document.getElementById("renameRelativeBtn").addEventListener("click", () => {
        renameRelativeInput.value = relativeFolderName;
        renameRelativeModal.classList.add('show');
        setTimeout(() => renameRelativeInput.select(), 50);
    });

    cancelRenameBtn.addEventListener("click", () => { renameRelativeModal.classList.remove('show'); });

    document.getElementById("applyRenameBtn").addEventListener("click", () => {
        let newName = renameRelativeInput.value.trim();
        if (!newName) {
            showNotification("Folder name cannot be empty.", "error");
            return;
        }

        newName = newName.replace(/[\\/:*?"<>|]/g, '');
        
        let oldName = relativeFolderName;
        relativeFolderName = newName;
        localStorage.setItem('zlp_relative_folder_name', relativeFolderName);

        if (oldName !== newName) {
            const shouldMove = document.getElementById('renameMoveCheck').checked;
            if (shouldMove) {
                csInterface.evalScript(`getAepPath()`, (aepPath) => {
                    if (aepPath !== "UNSAVED") {
                        let oldPath = path.join(aepPath, oldName);
                        let newPath = path.join(aepPath, newName);
                        if (fs.existsSync(oldPath)) {
                            try {
                                fs.renameSync(oldPath, newPath);
                                csInterface.evalScript(`relinkAssets("${safePath(oldPath)}", "${safePath(newPath)}")`, (res) => {
                                    if (res && res.startsWith("ERROR:")) showNotification(res.split("ERROR:")[1], "error");
                                });
                            } catch (e) {
                                showNotification("Could not rename folder on disk. Make sure no files are open in another program.", "error");
                            }
                        }
                    }
                });
            }
        }
        
        updateMainPathDisplay();
        renameRelativeModal.classList.remove('show');
    });

    // ==========================================
    // PATH VISIBILITY TOGGLE 
    // ==========================================
    const togglePathBtn = document.getElementById('togglePathBtn');
    const pathDisplay = document.getElementById('pathDisplay');
    const iconEyeOpen = document.getElementById('icon-eye-open');
    const iconEyeClosed = document.getElementById('icon-eye-closed');

    let savedHidePref = localStorage.getItem('zlp_hide_path');
    let isPathHidden = savedHidePref !== null ? savedHidePref === 'true' : true;

    function updatePathVisibility() {
        if (isPathHidden) {
            pathDisplay.classList.add('blurred');
            iconEyeOpen.style.display = 'none';
            iconEyeClosed.style.display = 'block';
        } else {
            pathDisplay.classList.remove('blurred');
            iconEyeOpen.style.display = 'block';
            iconEyeClosed.style.display = 'none';
        }
    }
    updatePathVisibility(); 

    togglePathBtn.addEventListener('click', () => {
        isPathHidden = !isPathHidden;
        localStorage.setItem('zlp_hide_path', isPathHidden);
        updatePathVisibility();
    });

    // ==========================================
    // TOGGLE STATE MEMORY 
    // ==========================================
    const copyLocalCheck = document.getElementById('copyLocalCheck');
    const matchDurationCheck = document.getElementById('matchDurationCheck');
    const stretchVideoCheck = document.getElementById('stretchVideoCheck');

    let savedCopyLocal = localStorage.getItem('zlp_copy_local');
    if (savedCopyLocal !== null) copyLocalCheck.checked = (savedCopyLocal === 'true');

    let savedMatchDur = localStorage.getItem('zlp_match_duration');
    if (savedMatchDur !== null) matchDurationCheck.checked = (savedMatchDur === 'true');

    let savedStretch = localStorage.getItem('zlp_stretch_video');
    if (savedStretch !== null) stretchVideoCheck.checked = (savedStretch === 'true');

    copyLocalCheck.addEventListener('change', () => localStorage.setItem('zlp_copy_local', copyLocalCheck.checked));
    matchDurationCheck.addEventListener('change', () => localStorage.setItem('zlp_match_duration', matchDurationCheck.checked));
    stretchVideoCheck.addEventListener('change', () => localStorage.setItem('zlp_stretch_video', stretchVideoCheck.checked));

    // ==========================================
    // COPY TO SYSTEM LOGIC
    // ==========================================
    document.getElementById("copyToSystemBtn").addEventListener("click", function() {
        csInterface.evalScript(`getLayerSourcePaths()`, (result) => {
            if (result && result.startsWith("ERROR:")) {
                showNotification(result.split("ERROR:")[1], "error");
                return;
            }

            if (result && result.startsWith("SUCCESS:")) {
                const pathsString = result.split("SUCCESS:")[1];
                const scriptPath = path.join(os.tmpdir(), 'zlp_clipboard_writer.ps1');

                const psScript = `
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName System.Collections
                
                $pathsString = "${safePath(pathsString)}"
                $paths = $pathsString.Split("|")
                $collection = New-Object System.Collections.Specialized.StringCollection
                
                foreach ($p in $paths) {
                    $fixedPath = [System.IO.Path]::GetFullPath($p)
                    if (Test-Path $fixedPath) {
                        $collection.Add($fixedPath) | Out-Null
                    }
                }
                
                if ($collection.Count -gt 0) {
                    [System.Windows.Forms.Clipboard]::SetFileDropList($collection)
                    Write-Output "COPIED"
                } else {
                    Write-Output "FAILED"
                }
                `;

                fs.writeFileSync(scriptPath, psScript, 'utf8');

                exec(`powershell -ExecutionPolicy Bypass -sta -NoProfile -File "${scriptPath}"`, (error, stdout, stderr) => {
                    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
                    
                    if (stdout.includes("COPIED")) {
                        const btn = document.getElementById("copyToSystemBtn");
                        const originalText = btn.innerText;
                        const originalColor = btn.style.color;
                        const originalBorder = btn.style.borderColor;
                        const originalBg = btn.style.backgroundColor;
                        
                        btn.innerText = "Copied to PC!";
                        btn.style.color = "#fff";
                        btn.style.backgroundColor = "rgba(46, 160, 67, 0.8)";
                        btn.style.borderColor = "rgba(46, 160, 67, 1)";
                        
                        setTimeout(() => {
                            btn.innerText = originalText;
                            btn.style.color = originalColor;
                            btn.style.backgroundColor = originalBg;
                            btn.style.borderColor = originalBorder;
                        }, 1500);
                    } else {
                        showNotification("Failed to write files to system clipboard.", "error");
                    }
                });
            }
        });
    });

    // ==========================================
    // PASTE LOGIC
    // ==========================================
    let isPasting = false;
    document.getElementById("pasteBtn").addEventListener("click", function() {
        if (isPasting) return;
        isPasting = true;
        const matchDuration = document.getElementById('matchDurationCheck').checked;
        const stretchVideo = document.getElementById('stretchVideoCheck').checked;
        const copyLocal = document.getElementById('copyLocalCheck').checked;

        csInterface.evalScript(`getAepPath()`, (aepPath) => {
            
            let targetFolder = getSavedPathForProject(aepPath);
            if (!targetFolder && aepPath !== "UNSAVED") { 
                targetFolder = path.join(aepPath, relativeFolderName); 
            }

            let hasValidTargetDir = false;
            let psTargetDir = "";

            if (targetFolder) {
                hasValidTargetDir = true;
                if (!fs.existsSync(targetFolder)) { fs.mkdirSync(targetFolder, { recursive: true }); }
                psTargetDir = safePath(targetFolder);
            }

            const psHasValidTargetDir = hasValidTargetDir ? "$true" : "$false";
            const psCopyLocal = copyLocal ? "$true" : "$false";

            const scriptPath = path.join(os.tmpdir(), 'zlp_clipboard_reader.ps1');
            
            const psScript = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    function Get-UniqueFileName ($Dir, $Base, $Ext) {
        $Name = $Base
        $Counter = 1
        $FinalPath = Join-Path $Dir ($Name + $Ext)
        while (Test-Path $FinalPath) {
            $Name = "$Base ($Counter)"
            $FinalPath = Join-Path $Dir ($Name + $Ext)
            $Counter++
        }
        return $FinalPath
    }

    try {
        Add-Type -AssemblyName System.Windows.Forms
        
        $targetDir = '${psTargetDir}'
        $hasValidTargetDir = ${psHasValidTargetDir}
        $copyLocal = ${psCopyLocal}
        $successPaths = @()
        $success = $false

        if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
            $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
            foreach ($file in $files) {
                $ext = [System.IO.Path]::GetExtension($file).ToLower()
                if ($ext -match "\\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff|psd|mp4|mov|avi|wmv|mp3|wav)$") {
                    if ($copyLocal) {
                        if (-not $hasValidTargetDir) {
                            Write-Output "ZLP_RESULT:PROJECT_UNSAVED"
                            exit
                        }
                        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file)
                        $finalPath = Get-UniqueFileName -Dir $targetDir -Base $baseName -Ext $ext
                        Copy-Item $file -Destination $finalPath
                        $successPaths += $finalPath
                    } else {
                        $successPaths += $file
                    }
                }
            }
            if ($successPaths.Count -gt 0) {
                $joinedPaths = $successPaths -join "|"
                Write-Output "ZLP_RESULT:SUCCESS:$joinedPaths"
                exit
            } else {
                Write-Output "ZLP_RESULT:FILE_NOT_SUPPORTED"
                exit
            }
        }

        if (-not $hasValidTargetDir) {
            $abortWeb = $false
            if ([System.Windows.Forms.Clipboard]::ContainsData([System.Windows.Forms.DataFormats]::Html) -or [System.Windows.Forms.Clipboard]::ContainsData('PNG') -or [System.Windows.Forms.Clipboard]::ContainsImage()) {
                $abortWeb = $true
            } elseif ([System.Windows.Forms.Clipboard]::ContainsText()) {
                $txt = [System.Windows.Forms.Clipboard]::GetText()
                if ($txt -match '\\.(jpg|jpeg|png|gif|webp|bmp|mp4)(?:\\?|$)') {
                    $abortWeb = $true
                } else {
                    Write-Output "ZLP_RESULT:TEXT_NOT_MEDIA"
                    exit
                }
            }
            
            if ($abortWeb) {
                Write-Output "ZLP_RESULT:PROJECT_UNSAVED_WEB"
                exit
            } else {
                Write-Output "ZLP_RESULT:EMPTY_CLIPBOARD"
                exit
            }
        }

        $fallbackBase = "Paste_" + (Get-Date -Format "yyyyMMdd_HHmmss")
        $webBase = "Web_Image"

        if ([System.Windows.Forms.Clipboard]::ContainsData([System.Windows.Forms.DataFormats]::Html)) {
            try {
                $htmlStr = [System.Windows.Forms.Clipboard]::GetData([System.Windows.Forms.DataFormats]::Html) -as [string]
                if ($htmlStr -match 'src=["'']([^"'']+)["'']') {
                    $srcUrl = $matches[1]
                    $srcUrl = $srcUrl -replace '&amp;', '&'
                    $uri = New-Object System.Uri($srcUrl)
                    $sniffedName = [System.IO.Path]::GetFileNameWithoutExtension($uri.LocalPath)
                    if (-not [string]::IsNullOrWhiteSpace($sniffedName)) {
                        $webBase = $sniffedName -replace '[\\\\/:*?"<>|]', '_'
                    }
                }
            } catch {}
        }

        if (-not $success -and [System.Windows.Forms.Clipboard]::ContainsData('PNG')) {
            try {
                $ms = [System.Windows.Forms.Clipboard]::GetData('PNG')
                if ($ms -is [System.IO.Stream]) {
                    $finalPath = Get-UniqueFileName -Dir $targetDir -Base $webBase -Ext ".png"
                    $fs = New-Object System.IO.FileStream($finalPath, [System.IO.FileMode]::Create)
                    $ms.CopyTo($fs)
                    $fs.Close()
                    $ms.Close()
                    $success = $true
                    Write-Output "ZLP_RESULT:SUCCESS:$finalPath"
                }
            } catch {}
        }
        
        if (-not $success -and [System.Windows.Forms.Clipboard]::ContainsImage()) {
            $finalPath = Get-UniqueFileName -Dir $targetDir -Base $webBase -Ext ".png"
            $img = [System.Windows.Forms.Clipboard]::GetImage()
            $img.Save($finalPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $success = $true
            Write-Output "ZLP_RESULT:SUCCESS:$finalPath"
        } 
        
        if (-not $success -and [System.Windows.Forms.Clipboard]::ContainsText()) {
            $txt = [System.Windows.Forms.Clipboard]::GetText()
            $extMatch = [regex]::match($txt, '\\.(jpg|jpeg|png|gif|webp|bmp|mp4)(?:\\?|$)')
            if ($extMatch.Success) {
                $ext = "." + $extMatch.Groups[1].Value
                $urlBase = $fallbackBase
                
                try {
                    $uri = New-Object System.Uri($txt)
                    $nameFromUrl = [System.IO.Path]::GetFileNameWithoutExtension($uri.LocalPath)
                    if (-not [string]::IsNullOrWhiteSpace($nameFromUrl)) {
                        $urlBase = $nameFromUrl -replace '[\\\\/:*?"<>|]', '_'
                    }
                } catch {}

                $finalPath = Get-UniqueFileName -Dir $targetDir -Base $urlBase -Ext $ext
                Invoke-WebRequest -Uri $txt -OutFile $finalPath -UseBasicParsing
                $success = $true
                Write-Output "ZLP_RESULT:SUCCESS:$finalPath"
            } else {
                Write-Output "ZLP_RESULT:TEXT_NOT_MEDIA"
                $success = $true
            }
        }
        
        if (-not $success) {
            Write-Output "ZLP_RESULT:EMPTY_CLIPBOARD"
        }
    } catch {
        Write-Output "ZLP_RESULT:ERROR:$($_.Exception.Message)"
    }
    `;

            fs.writeFileSync(scriptPath, psScript, 'utf8');

            exec(`powershell -ExecutionPolicy Bypass -sta -NoProfile -File "${scriptPath}"`, (error, stdout, stderr) => {
                isPasting = false;
                if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

                const output = stdout.trim();
                if (output.includes("ZLP_RESULT:SUCCESS:")) {
                    const generatedPaths = output.split("ZLP_RESULT:SUCCESS:")[1].trim();
                    const safeGeneratedPaths = safePath(generatedPaths); 
                    csInterface.evalScript(`importAndPasteImage("${safeGeneratedPaths}", ${matchDuration}, ${stretchVideo}, "${safeString(targetAeFolder)}")`, (result) => {
                        if (result !== "OK") showNotification("ExtendScript Error: " + result, "error");
                    });
                } else if (output.includes("ZLP_RESULT:PROJECT_UNSAVED")) {
                    showNotification("Please save your project first (or set a Custom Save Location) to copy files locally!", "error");
                } else if (output.includes("ZLP_RESULT:PROJECT_UNSAVED_WEB")) {
                    showNotification("Please save your project first (or set a Custom Save Location) to paste assets from the web!", "error");
                } else if (output.includes("ZLP_RESULT:TEXT_NOT_MEDIA")) {
                    showNotification("Clipboard contains text, but not a valid media URL.", "error");
                } else if (output.includes("ZLP_RESULT:FILE_NOT_SUPPORTED")) {
                    showNotification("You copied a file, but it's not a supported media format.", "error");
                } else if (output.includes("ZLP_RESULT:EMPTY_CLIPBOARD")) {
                    showNotification("Clipboard check returned empty. Please copy an asset again.", "error");
                } else if (output.includes("ZLP_RESULT:ERROR:")) {
                    showNotification("Windows System Error: " + output.split("ZLP_RESULT:ERROR:")[1], "error");
                } else {
                    showNotification("PowerShell Output: " + output, "error");
                }
            });
        });
    });

    // ==========================================
    // PC SAVE FOLDER MODAL
    // ==========================================
    const folderModal = document.getElementById('folderModal');
    const customPathInput = document.getElementById('customPathInput');

    document.getElementById("changeFolderBtn").addEventListener("click", function() {
        csInterface.evalScript(`getAepPath()`, (aepPath) => {
            let activeCustomPath = getSavedPathForProject(aepPath);
            if (!activeCustomPath && aepPath !== "UNSAVED") { activeCustomPath = path.join(aepPath, relativeFolderName); }
            currentValidModalPath = activeCustomPath || "";
            customPathInput.value = currentValidModalPath;
            folderModal.classList.add('show');
        });
    });

    customPathInput.addEventListener("blur", function() {
        let typedPath = customPathInput.value.trim();
        if (typedPath === "") { currentValidModalPath = ""; return; }
        try {
            if (fs.existsSync(typedPath) && fs.lstatSync(typedPath).isDirectory()) {
                currentValidModalPath = typedPath;
            } else {
                customPathInput.value = currentValidModalPath;
            }
        } catch(e) { customPathInput.value = currentValidModalPath; }
    });
    customPathInput.addEventListener("keydown", function(e) { if (e.key === "Enter") customPathInput.blur(); });

    document.getElementById("cancelModalBtn").addEventListener("click", function() { folderModal.classList.remove('show'); });

    document.getElementById("browseBtn").addEventListener("click", function() {
        if (os.platform() === 'win32') {
            const scriptPath = path.join(os.tmpdir(), 'zlp_folder_picker.ps1');
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
            $dialog.Title = "Navigate inside your desired folder and click 'Open'"
            $dialog.ValidateNames = $false
            $dialog.CheckFileExists = $false
            $dialog.CheckPathExists = $true
            $dialog.FileName = "Select_This_Folder"
            if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                Write-Output ([System.IO.Path]::GetDirectoryName($dialog.FileName))
            }
            `;
            fs.writeFileSync(scriptPath, psScript, 'utf8');

            exec(`powershell -ExecutionPolicy Bypass -sta -NoProfile -File "${scriptPath}"`, (error, stdout, stderr) => {
                if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
                const pickedPath = stdout.trim();
                if (pickedPath && fs.existsSync(pickedPath) && fs.lstatSync(pickedPath).isDirectory()) {
                    customPathInput.value = pickedPath;
                    currentValidModalPath = pickedPath; 
                }
            });
        } else {
            const result = window.cep.fs.showOpenDialog(false, true, "Select Save Folder", "", "");
            if (result.data && result.data.length > 0) {
                customPathInput.value = result.data[0];
                currentValidModalPath = result.data[0];
            }
        }
    });

    document.getElementById("applyModalBtn").addEventListener("click", function() {
        const newFolder = customPathInput.value.trim();
        const shouldMoveFiles = document.getElementById('moveAssetsCheck').checked;

        csInterface.evalScript(`getAepPath()`, (aepPath) => {
            let oldFolder = getSavedPathForProject(aepPath) || (aepPath !== "UNSAVED" ? path.join(aepPath, relativeFolderName) : null);
            
            if (newFolder === "") {
                savePathForProject(aepPath, null);
            } else {
                savePathForProject(aepPath, newFolder);
            }
            
            updateMainPathDisplay();
            folderModal.classList.remove('show');

            let targetFolder = getSavedPathForProject(aepPath) || (aepPath !== "UNSAVED" ? path.join(aepPath, relativeFolderName) : null);

            if (shouldMoveFiles && oldFolder && targetFolder && fs.existsSync(oldFolder) && oldFolder !== targetFolder) {
                try {
                    let files = fs.readdirSync(oldFolder);
                    let filesMoved = false;

                    files.forEach(file => {
                        let oldFilePath = path.join(oldFolder, file);
                        let newFilePath = path.join(targetFolder, file);
                        if (fs.lstatSync(oldFilePath).isFile()) {
                            fs.renameSync(oldFilePath, newFilePath);
                            filesMoved = true;
                        }
                    });
                    if (filesMoved) {
                        csInterface.evalScript(`relinkAssets("${safePath(oldFolder)}", "${safePath(targetFolder)}")`, (res) => {
                            if (res && res.startsWith("ERROR:")) showNotification(res.split("ERROR:")[1], "error");
                        });
                    }
                } catch (err) {
                    showNotification("Error moving files: " + err.message, "error");
                }
            }
        });
    });

    // ==========================================
    // AFTER EFFECTS PROJECT FOLDER MODAL
    // ==========================================
    const aeFolderModal = document.getElementById('aeFolderModal');
    const aeFolderInput = document.getElementById('aeFolderInput');
    const aeFolderDropdown = document.getElementById('aeFolderDropdown');

    document.getElementById("changeAeFolderBtn").addEventListener("click", function() {
        csInterface.evalScript(`getAeFolders()`, (foldersString) => {
            aeFolderDropdown.innerHTML = '<option value="">-- Or select an existing folder --</option>';
            if (foldersString !== "") {
                const folders = foldersString.split(":::");
                folders.forEach(f => {
                    let opt = document.createElement('option');
                    opt.value = f;
                    opt.textContent = f;
                    aeFolderDropdown.appendChild(opt);
                });
            }
            aeFolderInput.value = targetAeFolder;
            aeFolderModal.classList.add('show');
        });
    });

    aeFolderDropdown.addEventListener("change", function() {
        if (this.value !== "") { aeFolderInput.value = this.value; }
    });

    document.getElementById("cancelAeModalBtn").addEventListener("click", function() { aeFolderModal.classList.remove('show'); });

    document.getElementById("applyAeModalBtn").addEventListener("click", function() {
        const desiredFolder = aeFolderInput.value.trim();
        if (desiredFolder !== "") {
            let oldAeFolder = targetAeFolder;
            targetAeFolder = desiredFolder;
            localStorage.setItem('zlp_ae_folder', targetAeFolder);

            if (oldAeFolder !== desiredFolder) {
                csInterface.evalScript(`moveAeFolderItems("${safeString(oldAeFolder)}", "${safeString(desiredFolder)}")`, (res) => {
                    if (res && res.startsWith("ERROR:")) showNotification(res.split("ERROR:")[1], "error");
                });
            }
        }
        aeFolderModal.classList.remove('show');
    });

    // ==========================================
    // AUTO-REFRESH LOGIC
    // ==========================================
    document.body.addEventListener('mouseenter', updateMainPathDisplay);
    window.addEventListener('focus', updateMainPathDisplay);
    csInterface.addEventListener("com.adobe.csxs.events.ApplicationActivate", updateMainPathDisplay);

});