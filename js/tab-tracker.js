(function() {
    // --- Tracker Sub-Tab Engine ---
    window.switchTrackerTab = function(tabId) {
        if (window.isDraggingTrackerTab) return; // <--- ADD THIS LINE!

        document.querySelectorAll('.tracker-tab-content').forEach(t => {
            t.style.display = 'none';
            t.classList.remove('active');
        });
        document.querySelectorAll('.tracker-tab-btn').forEach(b => b.classList.remove('active'));
        
        const targetTab = document.getElementById(tabId);
        const targetBtn = document.getElementById('btn-' + tabId);
        if (targetTab && targetBtn) {
            targetTab.style.display = 'flex';
            targetTab.classList.add('active');
            targetBtn.classList.add('active');
        }
    };

    window.appStats = {
        today: 0, week: 0, month: 0, year: 0, total: 0,
        activeProject: "Untitled Project",
        projects: {},
        history: {},
        presets: [
            { id: 'p1', name: 'Pomodoro', time: 1500 },
            { id: 'p2', name: 'Short Break', time: 300 },
            { id: 'p3', name: 'Long Break', time: 900 }
        ]
    };

    window.trackerState = { 
        activeProject: "No Project Open",
        activeComp: "No Comp",
        lastTickTime: Date.now(),
        sessionTime: 0,
        expectedToken: 0
    };

    window.expandedProjects = {};

    window.toggleProjectExpand = function(rowId) {
        window.expandedProjects[rowId] = !window.expandedProjects[rowId];
        window.updateProjectsUI();
    };

    window.isSoundEnabled = true;
    const timerAlertSound = new Audio('sounds/timer.mp3');
    timerAlertSound.loop = true; 

    let cp = null;
    let isMac = false;
    let nativeSetInterval = window.setInterval; 

    document.addEventListener("DOMContentLoaded", () => {
        loadTrackerTabOrder(); // <--- ADD THIS HERE
        // Safe node.js injection inside DOMContentLoaded
        const isCEP = (typeof window.__adobe_cep__ !== "undefined");
        if (isCEP && typeof require !== 'undefined') {
            try {
                cp = require('child_process'); 
                isMac = require('os').platform() === 'darwin';
                const timers = require('timers'); 
                if (timers && timers.setInterval) nativeSetInterval = timers.setInterval;
            } catch(e) { console.warn("Node.js handles failed for Tracker.", e); }
        }

        loadStats();
        checkDateRollover();
        initDashboard();
        buildStopwatchDial(); 
        updateProjectsUI(); 
        startBackgroundLoop();
        initTrackerDraggableTabs(); // <--- ADD THIS HERE
    });

    window.addEventListener('beforeunload', saveStats);
    
    // Slight delay to ensure window.csInterface exists from globals.js
    setTimeout(() => {
        if (window.csInterface) {
            window.csInterface.addEventListener("com.adobe.csxs.events.WindowVisibilityChanged", () => { saveStats(); });
        }
    }, 500);

    function getTodayDateString() { return new Date().toLocaleDateString('en-CA'); }

    function checkDateRollover() {
        const todayStr = getTodayDateString();
        if (!window.appStats.history) window.appStats.history = {};
        if (window.appStats.history[todayStr] === undefined) {
            window.appStats.today = 0; window.appStats.history[todayStr] = 0; saveStats();
        }
    }

    function startBackgroundLoop() {
        window.trackerState.lastTickTime = Date.now();

        nativeSetInterval(() => {
            let now = Date.now();
            let deltaMs = now - window.trackerState.lastTickTime;
            window.trackerState.lastTickTime = now;

            let elapsedSeconds = Math.round(deltaMs / 1000);
            if (elapsedSeconds <= 0) return;

            checkDateRollover();
            const todayStr = getTodayDateString();

            window.trackerState.sessionTime += elapsedSeconds;
            window.appStats.today += elapsedSeconds; 
            window.appStats.total += elapsedSeconds;
            window.appStats.history[todayStr] = window.appStats.today;

            // Force the exact name directly from After Effects, ignoring OS window titles
            let pName = window.trackerState.lastKnownProjectName && window.trackerState.lastKnownProjectName !== "No Project Open"
                        ? window.trackerState.lastKnownProjectName
                        : window.trackerState.activeProject; 

            // Use the absolute file path as the unique database key. Fallback to name if ID is missing.
            let pID = window.trackerState.lastKnownProjectID && window.trackerState.lastKnownProjectID !== "NO_PROJECT" 
                        ? window.trackerState.lastKnownProjectID 
                        : pName;

            if (pName && pName !== "No Project Open") {
                if (!window.appStats.projects[pID]) {
                    window.appStats.projects[pID] = { name: pName, active: 0, lastUpdated: Date.now(), comps: {} };
                }
                
                // Ensure the database always knows the display name
                window.appStats.projects[pID].name = pName;

                if (!window.appStats.projects[pID].comps) {
                    window.appStats.projects[pID].comps = {};
                }
                window.appStats.projects[pID].active += elapsedSeconds;

                let cName = window.trackerState.activeComp;
                if (cName && cName !== "No Comp") {
                    if (!window.appStats.projects[pID].comps[cName]) {
                        window.appStats.projects[pID].comps[cName] = 0;
                    }
                    window.appStats.projects[pID].comps[cName] += elapsedSeconds;
                }

                // Stamp with the actual moment we tracked activity (not the file's
                // on-disk save time, which can be stale for hours if you haven't hit Ctrl+S).
                // This is what makes the Today/Week/Month/Year project filters accurate.
                window.appStats.projects[pID].lastUpdated = Date.now();
                
                window.appStats.activeProject = pID;
            } else {
                window.appStats.activeProject = "No Project Open";
            }

            updateDashboardUI(); 
            updateProjectsUI();
            
            if (window.appStats.today % 5 === 0) saveStats(); 
        }, 1000);

        if (cp) {
            nativeSetInterval(pollOSForProject, 3000);
            pollOSForProject(); 
        }
        pingAfterEffects();
    }

    function pollOSForProject() {
        if (!cp) return;
        if (isMac) {
            let script = `osascript -e 'tell application "System Events" to get name of first window of (first process whose name contains "After Effects")'`;
            cp.exec(script, (err, stdout) => { parseWindowTitle(stdout || ""); });
        } else {
            let script = `powershell -command "(Get-Process '*AfterFX*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty MainWindowTitle -First 1)"`;
            cp.exec(script, (err, stdout) => { parseWindowTitle(stdout || ""); });
        }
    }

    function parseWindowTitle(titleStr) {
        titleStr = titleStr.trim();
        if (!titleStr) return;

        let cleanTitle = titleStr.replace(/^Adobe After Effects \d{4}\s*-\s*/i, "");
        let match = cleanTitle.match(/([^/\\]+)\.aep/i);
        
        if (match && match[1]) {
            window.trackerState.activeProject = match[1].trim();
        } else if (cleanTitle.toLowerCase().includes("untitled project")) {
            window.trackerState.activeProject = "Untitled Project";
        } else if (cleanTitle.toLowerCase().includes("after effects") || cleanTitle === "") {
            window.trackerState.activeProject = "No Project Open";
        }
    }

    window.pingAfterEffectsTimeout = null;
    function pingAfterEffects() {
        clearTimeout(window.pingAfterEffectsTimeout);
        window.trackerState.expectedToken++;
        let currentToken = window.trackerState.expectedToken;

        const jsxCode = `(function() {
            try {
                if (!app || !app.project) return "NO_PROJECT|||No Project Open|||false|||${currentToken}|||0";
                var pPath = "UNSAVED_PROJECT";
                var pName = "Untitled Project";
                var isR = "false";
                var modTime = 0;
                
                if (app.project.file != null) {
                    pPath = app.project.file.fsName; 
                    var raw = app.project.file.name;
                    try { raw = decodeURI(raw); } catch(e){}
                    var idx = raw.lastIndexOf(".");
                    if (idx > -1) raw = raw.substring(0, idx);
                    pName = raw;
                    
                    try {
                        if (app.project.file.exists) {
                            modTime = app.project.file.modified.getTime();
                        }
                    } catch(e){}
                }
                
                var cName = "No Comp";
                if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
                    cName = app.project.activeItem.name;
                }

                if (app.project.renderQueue) {
                    for (var i = 1; i <= app.project.renderQueue.numItems; i++) {
                        if (app.project.renderQueue.item(i).status === 2) { 
                            isR = "true"; break;
                        }
                    }
                }
                return pPath + "|||" + pName.replace(/\\|/g, "") + "|||" + isR + "|||${currentToken}|||" + modTime + "|||" + cName.replace(/\\|/g, "");
            } catch(e) {
                return "AE_ERROR|||AE Error|||false|||${currentToken}|||0|||No Comp";
            }
        })()`;

        if (!window.csInterface) {
            window.pingAfterEffectsTimeout = setTimeout(pingAfterEffects, 1000);
            return;
        }

        // Failsafe: if AE is rendering or has a modal open, it might swallow the signal.
        // This ensures the tracking loop never dies and falls back to the OS.
        window.pingAfterEffectsTimeout = setTimeout(pingAfterEffects, 3000);

        window.csInterface.evalScript(jsxCode, (res) => {
            if (currentToken !== window.trackerState.expectedToken) return; 
            
            clearTimeout(window.pingAfterEffectsTimeout);
            window.pingAfterEffectsTimeout = setTimeout(pingAfterEffects, 1000);

            if (!res || res === "EvalScript error." || res === "undefined" || res === "null") return;

            let parts = res.split('|||');
            let newID = parts[0] ? parts[0] : "NO_PROJECT";
            let newName = parts[1] ? parts[1].trim() : "No Project Open";
            let modTime = parseInt(parts[4]);
            let newComp = parts[5] ? parts[5].trim() : "No Comp";
            
            if (newID !== "AE_ERROR") {
                // TRANSFER LOGIC: If we were tracking an unsaved project, and now we have a real file path,
                // merge the unsaved time into the new project file.
                let prevID = window.trackerState.lastKnownProjectID;
                if (prevID === "UNSAVED_PROJECT" && newID !== "UNSAVED_PROJECT" && newID !== "NO_PROJECT") {
                    if (window.appStats.projects["UNSAVED_PROJECT"]) {
                        let unsavedData = window.appStats.projects["UNSAVED_PROJECT"];
                        if (!window.appStats.projects[newID]) {
                            window.appStats.projects[newID] = { name: newName, active: 0, lastUpdated: Date.now(), comps: {} };
                        }
                        window.appStats.projects[newID].active += unsavedData.active;
                        for (let c in unsavedData.comps) {
                            if (!window.appStats.projects[newID].comps[c]) window.appStats.projects[newID].comps[c] = 0;
                            window.appStats.projects[newID].comps[c] += unsavedData.comps[c];
                        }
                        delete window.appStats.projects["UNSAVED_PROJECT"];
                        if (window.saveStats) window.saveStats();
                    }
                }

                window.trackerState.lastKnownProjectID = newID;
                window.trackerState.lastKnownProjectName = newName;
                window.trackerState.activeProject = newName;
                window.trackerState.activeComp = newComp;
                window.trackerState.isRendering = (parts[2] === "true");
                if (!isNaN(modTime) && modTime > 0) {
                    window.trackerState.lastKnownModTime = modTime;
                }
            }
        });
    }

    function loadStats() {
        const saved = localStorage.getItem('ultProductivityTrackerV3');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                window.appStats = { ...window.appStats, ...parsed };
            } catch (e) { console.warn("Failed to parse local storage."); }
        }
        
        if (!window.appStats.history) window.appStats.history = {};
        if (!window.appStats.projects) window.appStats.projects = {};

        // --- ONE-TIME DATE RESET (v2) ---
        // The old "cluster detection" healer only caught corrupt timestamps if 3+ projects
        // shared the exact same 1-second window. Anything spread out slipped through, which is
        // why the Today/Week/Month/Year filters kept showing every project. This runs once,
        // wipes every lastUpdated back to a clean slate, and from now on real dates accumulate
        // naturally as you actually work (see the per-tick update above).
        if (!window.appStats.dateFilterFixV2) {
            Object.values(window.appStats.projects).forEach(p => { p.lastUpdated = 0; });
            window.appStats.dateFilterFixV2 = true;
        }
        // ------------------------------------------
        
        if (!window.appStats.presets) {
            window.appStats.presets = [
                { id: 'p1', name: 'Pomodoro', time: 1500 },
                { id: 'p2', name: 'Short Break', time: 300 },
                { id: 'p3', name: 'Long Break', time: 900 }
            ];
        }

        const invalidNames = ["EvalScript error.", "AE Busy", "AE_BUSY", "No Project Open", "undefined", "null", "UNSAVED_PROJECT", "Untitled Project"];
        invalidNames.forEach(badName => {
            if (window.appStats.projects[badName]) delete window.appStats.projects[badName];
        });
    }

    function saveStats() { localStorage.setItem('ultProductivityTrackerV3', JSON.stringify(window.appStats)); }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function formatHoursMins(seconds) {
        if (!seconds || seconds === 0) return "0m";
        let h = Math.floor(seconds / 3600); let m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`; return `${m}m`;
    }

    function getCurrentWeekDates() {
        const now = new Date();
        let dayOfWeek = now.getDay(); if (dayOfWeek === 0) dayOfWeek = 7; 
        const distanceToMonday = dayOfWeek - 1; 
        const monday = new Date(now); monday.setDate(now.getDate() - distanceToMonday);

        const weekDates = [];
        for(let i = 0; i < 7; i++) {
            const d = new Date(monday); d.setDate(monday.getDate() + i);
            weekDates.push({ dateString: d.toLocaleDateString('en-CA'), dayName: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i], isToday: d.toDateString() === now.toDateString(), isFuture: d > now });
        }
        return weekDates;
    }

    function initDashboard() { updateDashboardUI(); }

    function calculateStreak() {
        let streak = 0;
        const now = new Date();
        let checkDate = new Date(now);
        const todayStr = checkDate.toLocaleDateString('en-CA');
        
        if (!window.appStats.history[todayStr] || window.appStats.history[todayStr] === 0) {
            checkDate.setDate(checkDate.getDate() - 1);
        }
        
        for (let i = 0; i < 3650; i++) { 
            let pastStr = checkDate.toLocaleDateString('en-CA');
            if (window.appStats.history[pastStr] && window.appStats.history[pastStr] > 0) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else { break; }
        }
        return streak;
    }

    window.isChartHovered = false;

    window.showChartTooltip = function(el, text) {
        window.isChartHovered = true; 
        const tooltip = document.getElementById('chart-tooltip');
        if(!tooltip) return;
        const rect = el.getBoundingClientRect();
        const wrapper = el.closest('.chart-svg-wrapper').getBoundingClientRect();
        let left = rect.left - wrapper.left + (rect.width / 2);
        let top = rect.top - wrapper.top;
        tooltip.innerText = text;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        tooltip.classList.add('active');
    };

    window.hideChartTooltip = function() {
        window.isChartHovered = false;
        const tooltip = document.getElementById('chart-tooltip');
        if(tooltip) tooltip.classList.remove('active');
    };

    function updateDashboardUI() {
        if (document.getElementById('daily-time-val')) document.getElementById('daily-time-val').innerText = formatTime(window.appStats.today);
        if (document.getElementById('streak-days')) document.getElementById('streak-days').innerText = calculateStreak();
        if (document.getElementById('session-time')) document.getElementById('session-time').innerText = formatTime(window.trackerState.sessionTime);

        const goal = 5 * 3600; 
        const perc = Math.min((window.appStats.today / goal) * 100, 100);
        if (document.getElementById('dh-daily-progress')) document.getElementById('dh-daily-progress').style.width = `${perc}%`;

        let currentWeekSecs = 0;
        getCurrentWeekDates().forEach(day => { currentWeekSecs += (window.appStats.history[day.dateString] || 0); });

        let currentMonthSecs = 0;
        const now = new Date();
        const yearMonthPrefix = now.toLocaleDateString('en-CA').substring(0, 7); 
        for (let i = 1; i <= 31; i++) {
            let dayStr = i.toString().padStart(2, '0');
            currentMonthSecs += (window.appStats.history[`${yearMonthPrefix}-${dayStr}`] || 0);
        }

        if (document.getElementById('week-time')) document.getElementById('week-time').innerText = formatHoursMins(currentWeekSecs);
        if (document.getElementById('month-time')) document.getElementById('month-time').innerText = formatHoursMins(currentMonthSecs);
        if (document.getElementById('total-time')) document.getElementById('total-time').innerText = formatHoursMins(window.appStats.total);
        
        if (!window.isChartHovered) { renderDynamicCharts(); }
    }

    function renderDynamicCharts() {
        const streakContainer = document.getElementById('streak-container');
        const chart = document.getElementById('weekly-chart');

        if (streakContainer) {
            streakContainer.innerHTML = '';
            const svgCheck = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            const svgFire = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>`;
            const svgBolt = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
            const svgCross = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none" style="opacity: 0.3;"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;
            const svgDash = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
            
            const weekDates = getCurrentWeekDates();
            weekDates.forEach((dayData) => {
                let secondsLogged = window.appStats.history[dayData.dateString] || 0;
                let circleClass = 'dh-day-circle';
                let icon = '';

                if (!dayData.isFuture) {
                    if (secondsLogged >= 5*3600) { circleClass += ' elite'; icon = svgBolt; }
                    else if (secondsLogged >= 3*3600) { circleClass += ' strong'; icon = svgFire; }
                    else if (secondsLogged >= 3600) { circleClass += ' basic'; icon = svgCheck; }
                    else if (dayData.isToday) { circleClass += ' current'; icon = svgDash; }
                    else { circleClass += ' missed'; icon = svgCross; }
                }

                let dayCol = document.createElement('div'); 
                dayCol.className = 'dh-day-col';
                dayCol.innerHTML = `<div class="${circleClass}">${icon}</div><span class="dh-day-label" style="position:relative; transform:none; bottom:auto; ${dayData.isToday ? 'color:var(--text-primary); font-weight:500;' : ''}">${dayData.dayName}</span>`;
                streakContainer.appendChild(dayCol);
            });
        }

        if (chart) {
            chart.innerHTML = '';
            const rollingDates = [];
            const now = new Date();
            const daysArr = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            
            for(let i = 6; i >= 0; i--) {
                let d = new Date(now); d.setDate(now.getDate() - i);
                rollingDates.push({ dateString: d.toLocaleDateString('en-CA'), dayName: daysArr[d.getDay()], secs: window.appStats.history[d.toLocaleDateString('en-CA')] || 0 });
            }

            let maxSecs = 5 * 3600; 
            let actualMax = Math.max(...rollingDates.map(d => d.secs));
            if (actualMax > maxSecs) maxSecs = actualMax; 

            const w = 300; const h = 100; const xPad = 28; 
            
            let points = rollingDates.map((d, i) => {
                let x = xPad + i * ((w - (xPad * 2)) / 6); 
                let y = 90 - (d.secs / maxSecs) * 75; 
                return { x, y, secs: d.secs };
            });

            let pathD = `M ${points[0].x},${points[0].y}`;
            for (let i = 0; i < points.length - 1; i++) {
                let p0 = i > 0 ? points[i - 1] : points[i];
                let p1 = points[i]; let p2 = points[i + 1];
                let p3 = i !== points.length - 2 ? points[i + 2] : p2;
                let cp1x = p1.x + (p2.x - p0.x) / 6; let cp1y = p1.y + (p2.y - p0.y) / 6;
                let cp2x = p2.x - (p3.x - p1.x) / 6; let cp2y = p2.y - (p3.y - p1.y) / 6;
                pathD += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
            }

            let chartHTML = `<div class="chart-x-axis">`;
            rollingDates.forEach((d, i) => {
                let isToday = (i === 6);
                let leftPerc = (points[i].x / w) * 100; 
                chartHTML += `<div class="chart-day-label ${isToday ? 'today' : ''}" style="left: ${leftPerc}%;">${d.dayName}</div>`;
            });
            chartHTML += `</div><div class="chart-svg-wrapper"><svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; overflow:visible; display:block;">`;
            chartHTML += `<defs><linearGradient id="chartGradient" x1="0" y1="10" x2="0" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0%" class="chart-grad-stop" stop-opacity="0.20"/><stop offset="250%" class="chart-grad-stop" stop-opacity="0"/></linearGradient></defs>`;

            points.forEach(p => { chartHTML += `<line x1="${p.x}" y1="0" x2="${p.x}" y2="${h}" class="chart-grid-line" />`; });

            let goalY = 90 - ((5 * 3600) / maxSecs) * 75;
            chartHTML += `<line x1="${xPad}" y1="${goalY}" x2="${w - xPad}" y2="${goalY}" class="chart-goal-line" />`;
            let areaD = pathD + ` L ${points[points.length-1].x},${h} L ${points[0].x},${h} Z`;
            chartHTML += `<path d="${areaD}" class="chart-area" /><path d="${pathD}" class="chart-line" />`;

            points.forEach((p, i) => {
                let timeTxt = formatHoursMins(p.secs);
                let isToday = (i === points.length - 1);
                
                if (isToday) {
                    chartHTML += `<g class="chart-dot-today-group" data-chart-tooltip="${timeTxt}"><circle cx="${p.x}" cy="${p.y}" class="chart-dot-today-outer" /><circle cx="${p.x}" cy="${p.y}" class="chart-dot-today-inner" /><circle cx="${p.x}" cy="${p.y}" r="14" fill="transparent" /></g>`;
                } else {
                    chartHTML += `<circle cx="${p.x}" cy="${p.y}" class="chart-dot-past" data-chart-tooltip="${timeTxt}" />`;
                }
            });

            chartHTML += `</svg></div>`;
            chart.innerHTML = chartHTML;
        }
    }

    const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    const ICON_PAUSE = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

    window.setTimerMode = function(mode) {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.time-view').forEach(v => v.classList.remove('active'));
        document.getElementById('btn-mode-' + mode).classList.add('active');
        document.getElementById('view-' + mode).classList.add('active');
        const soundToggle = document.getElementById('btn-sound-toggle');
        if (soundToggle) soundToggle.style.display = (mode === 'timer') ? 'flex' : 'none';
    };

    window.toggleSound = function() {
        window.isSoundEnabled = !window.isSoundEnabled;
        const iconOn = document.getElementById('icon-sound-on');
        const iconOff = document.getElementById('icon-sound-off');
        if (iconOn && iconOff) {
            iconOn.style.display = window.isSoundEnabled ? 'block' : 'none';
            iconOff.style.display = window.isSoundEnabled ? 'none' : 'block';
        }
    };

    window.timerData = { remaining: 1500, remainingExact: 1500000, totalSet: 1500, isRunning: false, endTime: 0, animFrame: null, lastTextStr: "" };

    window.toggleTimer = function() {
        const circle = document.getElementById('timer-progress-svg');
        if (window.timerData.isRunning) {
            window.timerData.isRunning = false;
            cancelAnimationFrame(window.timerData.animFrame);
            let remMs = window.timerData.endTime - Date.now();
            window.timerData.remainingExact = remMs;
            window.timerData.remaining = Math.ceil(remMs / 1000);
            document.getElementById('btn-timer-play').innerHTML = ICON_PLAY;
            updateTimerDisplay(remMs); 
        } else {
            if (window.timerData.remaining > 0) {
                let msToRun = window.timerData.remainingExact || (window.timerData.remaining * 1000);
                window.timerData.endTime = Date.now() + msToRun;
                window.timerData.isRunning = true;
                document.getElementById('btn-timer-play').innerHTML = ICON_PAUSE;
                if(circle) circle.classList.remove('resetting');
                document.getElementById('view-timer').classList.remove('timer-paused');
                window.timerData.animFrame = requestAnimationFrame(timerLoop);
            }
        }
    };

    function timerLoop() {
        if (!window.timerData.isRunning) return;
        let remMs = window.timerData.endTime - Date.now();
        if (remMs <= 0) {
            window.timerData.remaining = 0; window.timerData.remainingExact = 0;
            updateTimerDisplay(0);
            window.showAlarmOverlay();
            return;
        }
        window.timerData.remaining = Math.ceil(remMs / 1000);
        updateTimerDisplay(remMs);
        window.timerData.animFrame = requestAnimationFrame(timerLoop);
    }

    window.showAlarmOverlay = function() {
        window.timerData.isRunning = false;
        document.getElementById('btn-timer-play').innerHTML = ICON_PLAY;
        document.getElementById('view-timer').classList.remove('timer-paused');
        document.getElementById('alarm-overlay').classList.add('active');
        if (window.isSoundEnabled) {
            timerAlertSound.currentTime = 0;
            timerAlertSound.play().catch(e => console.warn("CEP Blocked Audio:", e));
        }
    };

    window.handleAlarm = function(action) {
        timerAlertSound.pause(); timerAlertSound.currentTime = 0;
        document.getElementById('alarm-overlay').classList.remove('active');
        if (action === 'dismiss') { window.resetTimer(); } 
        else if (action === 'restart') { window.resetTimer(); window.toggleTimer(); } 
        else if (action === 'break5') { window.setTimer(5 * 60); window.toggleTimer(); } 
        else if (action === 'break15') { window.setTimer(15 * 60); window.toggleTimer(); }
        else if (action === 'plus10') { window.setTimer(10 * 60); window.toggleTimer(); }
    };

    window.resetTimer = function() {
        window.timerData.isRunning = false;
        cancelAnimationFrame(window.timerData.animFrame);
        document.getElementById('btn-timer-play').innerHTML = ICON_PLAY;
        window.timerData.remaining = window.timerData.totalSet;
        window.timerData.remainingExact = window.timerData.totalSet * 1000;
        const circle = document.getElementById('timer-progress-svg');
        if (circle) {
            circle.classList.add('resetting');
            updateTimerDisplay(window.timerData.remainingExact);
            setTimeout(() => { if(circle) circle.classList.remove('resetting'); }, 600);
        } else {
            updateTimerDisplay(window.timerData.remainingExact);
        }
    };

    window.setTimer = function(seconds) {
        window.timerData.remaining = seconds || 1500;
        window.timerData.totalSet = window.timerData.remaining;
        window.timerData.remainingExact = window.timerData.remaining * 1000;
        let h = Math.floor(seconds / 3600); let m = Math.floor((seconds % 3600) / 60); let s = seconds % 60;
        document.getElementById('input-h').value = h.toString().padStart(2, '0');
        document.getElementById('input-m').value = m.toString().padStart(2, '0');
        document.getElementById('input-s').value = s.toString().padStart(2, '0');
        updateTimerDisplay(window.timerData.remainingExact);
    };

    function updateTimerDisplay(exactMs) {
        if (exactMs === undefined) exactMs = window.timerData.remaining * 1000;
        const h = Math.floor(window.timerData.remaining / 3600); const m = Math.floor((window.timerData.remaining % 3600) / 60); const s = window.timerData.remaining % 60;
        let timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        if (window.timerData.lastTextStr !== timeStr) {
            document.getElementById('timer-display').innerText = timeStr;
            window.timerData.lastTextStr = timeStr;
        }
        const circle = document.getElementById('timer-progress-svg');
        if (circle) {
            const perc = window.timerData.totalSet > 0 ? (exactMs / (window.timerData.totalSet * 1000)) : 0;
            const offset = 666.017 * (1 - perc);
            circle.style.strokeDashoffset = offset;
        }
        const viewTimer = document.getElementById('view-timer');
        if (viewTimer) {
            if (!window.timerData.isRunning && window.timerData.remaining < window.timerData.totalSet && window.timerData.remaining > 0) { viewTimer.classList.add('timer-paused'); } 
            else { viewTimer.classList.remove('timer-paused'); }
        }
    }

    window.swData = { startTime: 0, elapsed: 0, animFrame: null, isRunning: false, laps: [], lastLapTime: 0 };

    function buildStopwatchDial() {
        const dial = document.getElementById('sw-dial-ticks');
        if (!dial) return;
        let svg = `<svg viewBox="0 0 220 220" width="100%" height="100%">`;
        for(let i=0; i<120; i++) {
            let angle = i * 3; let isPrimary = i % 5 === 0; let length = isPrimary ? 8 : 4;
            let color = i === 0 ? "var(--rfx-accent)" : "var(--rfx-line-2)"; let thickness = i === 0 ? 2 : 1.5;
            svg += `<line x1="110" y1="4" x2="110" y2="${4 + length}" stroke="${color}" stroke-width="${thickness}" transform="rotate(${angle} 110 110)" stroke-linecap="round" />`;
        }
        svg += `</svg>`;
        dial.innerHTML = svg;
        updateTimerDisplay(); 
    }

    function formatSWTime(ms) {
        let totalSec = Math.floor(ms / 1000); let m = Math.floor(totalSec / 60); let s = totalSec % 60; let milli = Math.floor((ms % 1000) / 10);
        return { m: m.toString().padStart(2, '0'), s: s.toString().padStart(2, '0'), ms: milli.toString().padStart(2, '0') };
    }

    window.toggleStopwatch = function() {
        const dotContainer = document.getElementById('sw-dot-container');
        if (window.swData.isRunning) {
            cancelAnimationFrame(window.swData.animFrame);
            window.swData.isRunning = false;
            document.getElementById('btn-sw-play').innerHTML = ICON_PLAY;
            document.getElementById('icon-sw-reset').style.display = 'block';
            document.getElementById('icon-sw-flag').style.display = 'none';
        } else {
            if(dotContainer) dotContainer.style.transition = 'none'; 
            window.swData.startTime = Date.now() - window.swData.elapsed;
            window.swData.isRunning = true;
            document.getElementById('btn-sw-play').innerHTML = ICON_PAUSE;
            document.getElementById('icon-sw-reset').style.display = 'none';
            document.getElementById('icon-sw-flag').style.display = 'block';
            window.swData.animFrame = requestAnimationFrame(swLoop);
        }
    };

    function swLoop() { updateStopwatchDisplay(); if (window.swData.isRunning) { window.swData.animFrame = requestAnimationFrame(swLoop); } }

    window.handleSwAction = function() {
        if (window.swData.isRunning) {
            let totalMs = window.swData.elapsed; let lapMs = totalMs - window.swData.lastLapTime;
            window.swData.laps.unshift({ num: window.swData.laps.length + 1, lap: lapMs, total: totalMs });
            window.swData.lastLapTime = totalMs; renderLaps();
        } else { window.resetStopwatch(); }
    };

    window.resetStopwatch = function() {
        cancelAnimationFrame(window.swData.animFrame);
        window.swData.isRunning = false; window.swData.elapsed = 0; window.swData.laps = []; window.swData.lastLapTime = 0;
        document.getElementById('btn-sw-play').innerHTML = ICON_PLAY;
        document.getElementById('icon-sw-reset').style.display = 'block';
        document.getElementById('icon-sw-flag').style.display = 'none';
        document.getElementById('sw-display-main').innerText = `00:00`;
        document.getElementById('sw-display-ms').innerText = `.00`;
        document.getElementById('sw-lap-current').innerText = `00:00.00`;
        const dotContainer = document.getElementById('sw-dot-container');
        if (dotContainer) {
            dotContainer.style.transition = 'transform 0.6s cubic-bezier(0.33, 0.00, 0.30, 1.00)';
            dotContainer.style.transform = `rotate(0deg)`;
        }
        renderLaps();
    };

    function updateStopwatchDisplay() {
        window.swData.elapsed = Date.now() - window.swData.startTime;
        let totalMs = window.swData.elapsed;
        let t = formatSWTime(totalMs);
        document.getElementById('sw-display-main').innerText = `${t.m}:${t.s}`;
        document.getElementById('sw-display-ms').innerText = `.${t.ms}`;
        let currentLapMs = totalMs - window.swData.lastLapTime;
        let l = formatSWTime(currentLapMs);
        document.getElementById('sw-lap-current').innerText = `${l.m}:${l.s}.${l.ms}`;
        let deg = (totalMs % 60000) / 60000 * 360;
        document.getElementById('sw-dot-container').style.transform = `rotate(${deg}deg)`;
    }

    function renderLaps() {
        const container = document.getElementById('sw-laps-container');
        if (!container) return;
        container.innerHTML = '';
        window.swData.laps.forEach(lap => {
            let l = formatSWTime(lap.lap); let t = formatSWTime(lap.total);
            container.innerHTML += `
                <div class="sw-lap-row">
                    <span class="sw-lap-num">${lap.num.toString().padStart(2, '0')}</span>
                    <span class="sw-lap-time">${l.m}:${l.s}.${l.ms}</span>
                    <span class="sw-lap-total">+${t.m}:${t.s}.${t.ms}</span>
                </div>`;
        });
    }

    window.updateProjectsUI = function() {
        const list = document.getElementById('project-list');
        if (!list) return;

        if (!window.projectSortState) window.projectSortState = { filter: 'all', sort: 'newest' };

        let searchInput = document.getElementById('project-search-input');
        let q = searchInput ? searchInput.value.toLowerCase().trim() : '';
        let filter = window.projectSortState.filter;
        let sortMode = window.projectSortState.sort;

        let now = new Date();
        let todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let projArray = Object.entries(window.appStats.projects).map(([idKey, data]) => {
            return { id: idKey, name: data.name || idKey, active: data.active, lastUpdated: data.lastUpdated || 0, comps: data.comps || {} };
        });

        // 1. Core & Search Filters
        projArray = projArray.filter(p => p.name && p.name !== "No Project Open" && !p.name.includes("OS_PopupWindow"));
        if (q !== '') projArray = projArray.filter(p => p.name.toLowerCase().includes(q));

        // 2. Time Filter (Now works because the corrupt dates are gone!)
        if (filter !== 'all') {
            projArray = projArray.filter(p => {
                if (p.lastUpdated === 0) return false; 
                let pDate = new Date(p.lastUpdated);
                let targetMidnight = new Date(pDate.getFullYear(), pDate.getMonth(), pDate.getDate());
                let diffDays = Math.round((todayMidnight - targetMidnight) / (1000 * 60 * 60 * 24));
                
                if (filter === 'today' && diffDays > 0) return false;
                if (filter === 'week' && diffDays > 7) return false;
                if (filter === 'month' && diffDays > 30) return false;
                if (filter === 'year' && diffDays > 365) return false;
                return true;
            });
        }

        // 3. Sort Order (Fixed: Use ID to properly pin the active project to the top)
        projArray.sort((a, b) => {
            if (a.id === window.appStats.activeProject) return -1;
            if (b.id === window.appStats.activeProject) return 1;
            return sortMode === 'oldest' ? a.lastUpdated - b.lastUpdated : b.lastUpdated - a.lastUpdated;
        });

        // 4. Native DOM Sync Engine
        list.style.flexDirection = 'column';
        let activeIds = new Set();

        projArray.forEach((proj, index) => {
                let rawId = proj.id || proj.name; 
                let safeBase64 = btoa(unescape(encodeURIComponent(rawId))).replace(/[^a-zA-Z0-9]/g, '');
                let rowId = "proj_" + safeBase64;
                activeIds.add(rowId);

                let existingRow = document.getElementById(rowId);
                let act = formatTime(proj.active); 
                let isActive = (proj.id === window.appStats.activeProject);
                let isLegacy = (proj.lastUpdated === 0);
                
                let tags = '';
                if (isActive) tags += '<span style="font-size:9px; background:var(--rfx-fill-active); color:var(--rfx-text-1); font-weight:600; padding:3px 6px; border-radius:4px;">ACTIVE</span>';
                else if (isLegacy) tags += '<span style="font-size:9px; background:var(--rfx-fill-hover); color:var(--text-secondary); font-weight:600; padding:3px 6px; border-radius:4px;" title="Tracked before dates were saved">LEGACY</span>';

                let isExpanded = window.expandedProjects[rowId] === true;
                let compsHtml = '';
                let compsArr = [];
                if (isExpanded) {
                    compsArr = Object.entries(proj.comps || {}).map(([cName, cActive]) => {
                        return { name: cName, active: cActive };
                    });
                    compsArr.sort((a, b) => {
                        if (isActive && a.name === window.trackerState.activeComp) return -1;
                        if (isActive && b.name === window.trackerState.activeComp) return 1;
                        return b.active - a.active;
                    });
                    
                    compsArr.forEach(c => {
                        let isCompActive = (isActive && c.name === window.trackerState.activeComp);
                        compsHtml += `
                            <div data-comp-name="${c.name.replace(/"/g, '&quot;')}" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 4px; background: ${isCompActive ? 'var(--rfx-fill-active)' : 'transparent'}; margin-top: 4px;">
                                <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="${isCompActive ? 'var(--rfx-text-1)' : 'var(--text-secondary)'}" stroke-width="2" fill="none" style="flex-shrink: 0;"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
                                    <span style="font-size: 11px; color: ${isCompActive ? 'var(--rfx-text-1)' : 'var(--text-secondary)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.name}</span>
                                </div>
                                <span class="comp-time-val" style="font-size: 11px; font-variant-numeric: tabular-nums; font-weight: 500; color: ${isCompActive ? 'var(--rfx-text-1)' : 'var(--text-secondary)'}; flex-shrink: 0;">${formatTime(c.active)}</span>
                            </div>
                        `;
                    });
                    if (compsHtml === '') compsHtml = `<div style="font-size: 10px; color: var(--text-secondary); text-align: center; font-style: italic; margin-top: 8px;">No comps tracked yet.</div>`;
                }

                if (existingRow) {
                    existingRow.style.display = '';
                    let actEl = document.getElementById(rowId + '-act');
                    if (actEl && actEl.innerText !== act) actEl.innerText = act;
                    
                    // MISSING CODE RESTORED: This properly clears the blue UI state when you switch projects!
                    const iconSvg = existingRow.querySelector('.project-icon');
                    const titleSpan = existingRow.querySelector('.project-title');
                    const tagSpan = existingRow.querySelector('.active-tag-container');
                    
                    if (isActive) {
                        if(iconSvg && iconSvg.getAttribute('stroke') !== 'var(--rfx-text-1)') iconSvg.setAttribute('stroke', 'var(--rfx-text-1)');
                        if(titleSpan && titleSpan.style.color !== 'var(--rfx-text-1)') titleSpan.style.color = 'var(--rfx-text-1)';
                    } else {
                        if(iconSvg && iconSvg.getAttribute('stroke') !== 'currentColor') iconSvg.setAttribute('stroke', 'currentColor');
                        if(titleSpan && titleSpan.style.color !== 'var(--text-primary)') titleSpan.style.color = 'var(--text-primary)';
                    }
                    if(tagSpan && tagSpan.innerHTML !== tags) tagSpan.innerHTML = tags;

                    const chevronBtn = existingRow.querySelector('.btn-icon-square');
                    const compsContainer = existingRow.querySelector('.project-comps-container');
                    
                    let targetRotation = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
                    if(chevronBtn && chevronBtn.style.transform !== targetRotation) chevronBtn.style.transform = targetRotation;
                    
                    if (compsContainer) {
                        if (isExpanded) {
                            if (compsContainer.style.display !== 'flex') {
                                compsContainer.style.marginTop = '8px'; compsContainer.style.paddingTop = '8px'; compsContainer.style.borderTop = '1px solid var(--border-color)'; compsContainer.style.display = 'flex'; compsContainer.style.flexDirection = 'column'; compsContainer.style.maxHeight = '100px'; compsContainer.style.overflowY = 'auto'; compsContainer.style.paddingRight = '4px';
                            }
                            let currentChildren = Array.from(compsContainer.children);
                            let needsRebuild = (compsArr.length === 0 || currentChildren.length !== compsArr.length || compsContainer.innerHTML.includes('No comps tracked yet'));
                            if (needsRebuild) { compsContainer.innerHTML = compsHtml; } 
                            else {
                                for (let i = 0; i < compsArr.length; i++) {
                                    let timeSpan = currentChildren[i].querySelector('.comp-time-val');
                                    let newTime = formatTime(compsArr[i].active);
                                    if (timeSpan && timeSpan.innerText !== newTime) timeSpan.innerText = newTime;
                                }
                            }
                        } else if (compsContainer.style.display !== 'none') {
                            compsContainer.style.display = 'none'; compsContainer.innerHTML = '';
                        }
                    }
                    if (list.children[index] !== existingRow) list.insertBefore(existingRow, list.children[index]);
                } else {
                    let li = document.createElement('div');
                    li.className = 'project-card'; li.id = rowId;
                    li.innerHTML = `
                        <div class="project-header">
                            <svg class="project-icon" viewBox="0 0 24 24" fill="none" stroke="${isActive ? 'var(--rfx-text-1)' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                            <span class="project-title" style="${isActive ? 'color:var(--rfx-text-1);' : ''}">${proj.name}</span>
                            <div class="active-tag-container" style="margin-left:auto; display:flex; gap:4px;">${tags}</div>
                        </div>
                        <div class="project-metrics">
                            <div class="p-metric" style="padding-right: 6px;">
                                <span class="p-metric-label">Total Time Spent</span>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <span class="p-metric-val" id="${rowId}-act" style="color:var(--rfx-text-1); font-size: 13.5px;">${act}</span>
                                    <div style="width: 1px; height: 16px; background: var(--border-color); border-radius: 1px;"></div>
                                    <button class="btn-icon-square" onclick="event.preventDefault(); event.stopPropagation(); window.toggleProjectExpand('${rowId}');" style="width: 28px !important; height: 28px !important; min-width: 28px !important; min-height: 28px !important; max-width: 28px !important; max-height: 28px !important; padding: 0 !important; margin: 0 !important; box-sizing: border-box !important; flex-shrink: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); transform: ${isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'}; cursor: pointer;">
                                        <svg viewBox="0 0 24 24" style="width: 20px !important; height: 20px !important; stroke-width: 2.5px !important; pointer-events: none;" stroke="var(--rfx-text-2)" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="project-comps-container" style="${isExpanded ? 'margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; max-height: 100px; overflow-y: auto; padding-right: 4px;' : 'display: none;'}">${compsHtml}</div>`;
                    let targetSibling = list.children[index];
                    if (targetSibling) list.insertBefore(li, targetSibling); else list.appendChild(li);
                }
            });

        // 6. Empty State Feedback
        let emptyMsg = document.getElementById('project-empty-msg');
        if (activeIds.size === 0) {
            if (!emptyMsg) {
                emptyMsg = document.createElement('div');
                emptyMsg.id = 'project-empty-msg';
                emptyMsg.style.cssText = "text-align:center; padding: 24px 12px; color: var(--text-secondary); font-size: 11px; font-style: italic;";
                list.appendChild(emptyMsg);
            }
            emptyMsg.innerText = filter !== 'all' ? "No active projects in this timeframe.\n(Older legacy projects only appear in 'All Time')" : "No projects found.";
            emptyMsg.style.display = 'block';
            list.appendChild(emptyMsg);
        } else if (emptyMsg) {
            emptyMsg.style.display = 'none';
        }
    };

    function updateProjectsUI() { window.updateProjectsUI(); }

    window.activeNumpadInput = null;
    window.activeNumpadSlider = null;
    window.activeWrapper = null;
    window.numpadFresh = false;
    window.isSyncingFromInput = false;

    window.syncSliderToInput = function(sliderId, inputId) {
        if (window.isSyncingFromInput) return;
        const sliderEl = document.getElementById(sliderId), inputEl = document.getElementById(inputId);
        if (!sliderEl || !inputEl) return;
        if (document.activeElement === inputEl) return;
        inputEl.value = sliderEl.value; window.isSyncingFromInput = true;
        sliderEl.dispatchEvent(new Event('input')); window.isSyncingFromInput = false;
    };

    window.syncInputToSlider = function(inputId, sliderId) {
        const inputEl = document.getElementById(inputId), sliderEl = document.getElementById(sliderId);
        if (!sliderEl || !inputEl) return;
        let val = parseFloat(inputEl.value);
        if (isNaN(val) || inputEl.value === "") return; 
        window.isSyncingFromInput = true; sliderEl.value = val;
        sliderEl.dispatchEvent(new Event('input')); window.isSyncingFromInput = false;
    };

    window.openNumpad = function(inputId, sliderId, wrapperId) {
        if (['input-h', 'input-m', 'input-s'].includes(inputId) && window.timerData.isRunning) return; 
        window.activeNumpadInput = document.getElementById(inputId);
        window.activeNumpadSlider = document.getElementById(sliderId);
        window.numpadFresh = true; 
        if (window.activeWrapper) window.activeWrapper.classList.remove('active');
        window.activeWrapper = wrapperId ? document.getElementById(wrapperId) : null;
        if (window.activeWrapper) window.activeWrapper.classList.add('active');
        
        // FIX: Target the global numpad so it works on ALL tabs!
        const numpad = document.getElementById('global-numpad');
        if (numpad) numpad.classList.add('active'); 
        setTimeout(() => { document.addEventListener('click', window.closeNumpadOutside); }, 10);
    };

    window.closeNumpadOutside = function(e) {
        const numpad = document.getElementById('global-numpad');
        if (numpad && !numpad.contains(e.target) && (!window.activeWrapper || !window.activeWrapper.contains(e.target)) && (!window.activeNumpadInput || !window.activeNumpadInput.contains(e.target))) {
            window.closeNumpad();
        }
    };

    window.validateTimerInputs = function() {
        let hEl = document.getElementById('input-h'); let mEl = document.getElementById('input-m'); let sEl = document.getElementById('input-s');
        if (!hEl || !mEl || !sEl) return;
        let h = parseInt(hEl.value); if (isNaN(h)) h = 0;
        let m = parseInt(mEl.value); if (isNaN(m)) m = 0;
        let s = parseInt(sEl.value); if (isNaN(s)) s = 0;
        h = Math.max(0, Math.min(23, h)); m = Math.max(0, Math.min(59, m)); s = Math.max(0, Math.min(59, s));
        if (h === 0 && m === 0 && s === 0) { s = 1; }
        hEl.value = h.toString().padStart(2, '0'); mEl.value = m.toString().padStart(2, '0'); sEl.value = s.toString().padStart(2, '0');
        let totalSec = (h * 3600) + (m * 60) + s;
        window.timerData.totalSet = totalSec;
        if (!window.timerData.isRunning) {
            window.timerData.remaining = totalSec; window.timerData.remainingExact = totalSec * 1000;
            updateTimerDisplay(window.timerData.remainingExact);
        }
    };

    window.closeNumpad = function() {
        const numpad = document.getElementById('global-numpad');
        if (numpad) numpad.classList.remove('active');
        
        document.removeEventListener('click', window.closeNumpadOutside);
        if (window.activeWrapper) window.activeWrapper.classList.remove('active');
        
        if (window.activeNumpadInput) {
            // Timer Validation
            if (['input-h', 'input-m', 'input-s'].includes(window.activeNumpadInput.id)) { 
                window.validateTimerInputs(); 
            } 
            // FIX: Sequence Box Validation
            else if (window.activeNumpadInput.id === 'seq-val-input') {
                let val = parseInt(window.activeNumpadInput.value);
                // If the box is empty (NaN) or you typed 0, snap it to 1
                if (isNaN(val) || val < 1) {
                    window.activeNumpadInput.value = "1";
                    window.activeNumpadInput.dispatchEvent(new Event('input')); // Force the slider to sync to 1
                }
            }
            
            window.activeNumpadInput.blur();
        }
        window.activeNumpadInput = null; window.activeNumpadSlider = null; window.activeWrapper = null;
    };

    window.numpadPress = function(val) {
        if (!window.activeNumpadInput) return;
        
        if (val === 'AC') { 
            window.activeNumpadInput.value = ''; 
            window.activeNumpadInput.dispatchEvent(new Event('input')); // Forces UI sliders to sync
            return; 
        } 
        else if (val === 'OK') { window.closeNumpad(); return; } 
        
        let currentVal = window.activeNumpadInput.value;
        if (window.numpadFresh) { currentVal = ''; window.numpadFresh = false; }
        currentVal += val;
        
        // Limits time inputs to 2 digits
        if (['input-h', 'input-m', 'input-s'].includes(window.activeNumpadInput.id) && currentVal.length > 2) { 
            currentVal = currentVal.slice(-2); 
        }
        // Limits the frames input to 3 digits so it doesn't overflow the UI
        if (window.activeNumpadInput.id === 'seq-val-input' && currentVal.length > 3) {
            currentVal = currentVal.slice(-3);
        }
        
        window.activeNumpadInput.value = currentVal;
        
        // FIX: Dispatch an input event so that sliders attached to this box actually update live!
        window.activeNumpadInput.dispatchEvent(new Event('input')); 
    };

    window.openPresetModal = function() {
        renderPresets();
        document.getElementById('preset-modal-backdrop').classList.add('active');
    };

    window.closePresetModal = function() {
        document.getElementById('preset-modal-backdrop').classList.remove('active');
        document.getElementById('new-preset-name').value = '';
        document.getElementById('new-preset-h').value = '';
        document.getElementById('new-preset-m').value = '';
        document.getElementById('new-preset-s').value = '';
    };

    function renderPresets() {
        const list = document.getElementById('preset-list');
        list.innerHTML = '';
        window.appStats.presets.forEach(p => {
            const h = Math.floor(p.time / 3600); const m = Math.floor((p.time % 3600) / 60); const s = p.time % 60;
            let timeStr = h > 0 ? 
                `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : 
                `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            list.innerHTML += `
                <div class="preset-item" onclick="applyPreset(${p.time})">
                    <span class="preset-name">${p.name}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="preset-time">${timeStr}</span>
                        <div class="preset-delete" onclick="event.stopPropagation(); deletePreset('${p.id}')" title="Delete Preset">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </div>
                    </div>
                </div>`;
        });
    }

    window.applyPreset = function(seconds) {
        if (window.timerData.isRunning) { window.toggleTimer(); } 
        window.setTimer(seconds); 
        closePresetModal();
    };

    window.addPreset = function() {
        let name = document.getElementById('new-preset-name').value.trim() || 'Custom Timer';
        let h = parseInt(document.getElementById('new-preset-h').value) || 0;
        let m = parseInt(document.getElementById('new-preset-m').value) || 0;
        let s = parseInt(document.getElementById('new-preset-s').value) || 0;
        let totalSec = (h * 3600) + (m * 60) + s;
        if (totalSec <= 0) return; 
        window.appStats.presets.push({ id: 'p' + Date.now(), name: name, time: totalSec });
        saveStats();
        document.getElementById('new-preset-name').value = '';
        document.getElementById('new-preset-h').value = '';
        document.getElementById('new-preset-m').value = '';
        document.getElementById('new-preset-s').value = '';
        renderPresets();
    };

    window.deletePreset = function(id) {
        if (confirm("Are you sure you want to delete this preset?")) {
            window.appStats.presets = window.appStats.presets.filter(p => p.id !== id);
            saveStats();
            renderPresets();
        }
    };

    let tooltipTimer; 
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-chart-tooltip]');
        if (target) {
            window.isChartHovered = true; 
            tooltipTimer = setTimeout(() => {
                const globalTooltip = document.getElementById('chart-tooltip');
                if(!globalTooltip) return;
                globalTooltip.innerText = target.getAttribute('data-chart-tooltip');
                const targetRect = target.getBoundingClientRect();
                const tooltipRect = globalTooltip.getBoundingClientRect();
                let x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
                let y = targetRect.top - tooltipRect.height - 12; 
                if (x + tooltipRect.width > window.innerWidth) x = window.innerWidth - tooltipRect.width - 8;
                if (x < 0) x = 8;
                if (y < 0) y = targetRect.bottom + 12;
                globalTooltip.style.left = x + 'px';
                globalTooltip.style.top = y + 'px';
                globalTooltip.classList.add('visible');
            }, 150); 
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-chart-tooltip]');
        if (target) {
            window.isChartHovered = false; 
            clearTimeout(tooltipTimer); 
            const globalTooltip = document.getElementById('chart-tooltip');
            if(globalTooltip) globalTooltip.classList.remove('visible');
        }
    });

    // ==========================================
    // TRACKER SUB-TAB DRAG & DROP ENGINE (Copied from Globals)
    // ==========================================
    window.isDraggingTrackerTab = false;

    function initTrackerDraggableTabs() {
        const container = document.querySelector('#tab-tracker .tabs-header');
        if (!container) return;

        let draggedItem = null, startX = 0, currentX = 0, siblings = [], startIndex = 0, currentIndex = 0, shiftAmount = 0; 
        
        container.addEventListener('pointerdown', (e) => {
            const tab = e.target.closest('.tracker-tab-btn'); 
            if (!tab) return;
            draggedItem = tab; startX = e.clientX; currentX = 0; draggedItem.setPointerCapture(e.pointerId);
            const allTabs = Array.from(container.querySelectorAll('.tracker-tab-btn'));
            startIndex = allTabs.indexOf(draggedItem); currentIndex = startIndex;
            shiftAmount = allTabs.length > 1 ? Math.abs(allTabs[1].getBoundingClientRect().left - allTabs[0].getBoundingClientRect().left) : draggedItem.offsetWidth + 2;
            siblings = allTabs.map((t, index) => ({ el: t, index: index, rect: t.getBoundingClientRect(), shift: 0 }));
        });
        
        container.addEventListener('pointermove', (e) => {
            if (!draggedItem) return;
            const deltaX = e.clientX - startX;
            if (Math.abs(deltaX) > 4 || window.isDraggingTrackerTab) {
                window.isDraggingTrackerTab = true;
                if (!draggedItem.classList.contains('dragging')) draggedItem.classList.add('dragging');
                currentX = deltaX; draggedItem.style.transform = `translate3d(${currentX}px, 0, 0)`; draggedItem.style.transition = 'none';
                const draggedCenter = draggedItem.getBoundingClientRect().left + draggedItem.getBoundingClientRect().width / 2;
                let newIndex = startIndex;
                siblings.forEach(sib => {
                    if (sib.index === startIndex) return; 
                    const sibCenter = sib.rect.left + sib.rect.width / 2;
                    let shift = 0;
                    if (startIndex < sib.index && draggedCenter > sibCenter) { shift = -shiftAmount; newIndex = Math.max(newIndex, sib.index); } 
                    else if (startIndex > sib.index && draggedCenter < sibCenter) { shift = shiftAmount; newIndex = Math.min(newIndex, sib.index); }
                    if (sib.shift !== shift) { sib.shift = shift; sib.el.style.transform = `translate3d(${shift}px, 0, 0)`; sib.el.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)'; }
                });
                currentIndex = newIndex;
            }
        });
        
        container.addEventListener('pointerup', (e) => {
            if (!draggedItem) return;
            draggedItem.releasePointerCapture(e.pointerId);
            if (window.isDraggingTrackerTab) {
                draggedItem.classList.remove('dragging'); draggedItem.style.transition = 'none'; draggedItem.style.transform = '';
                siblings.forEach(sib => { sib.el.style.transition = 'none'; sib.el.style.transform = ''; });
                if (currentIndex !== startIndex) {
                    const targetSibling = siblings[currentIndex].el;
                    if (currentIndex > startIndex) container.insertBefore(draggedItem, targetSibling.nextSibling);
                    else container.insertBefore(draggedItem, targetSibling);
                }
                void container.offsetWidth; draggedItem.style.transition = ''; siblings.forEach(sib => { sib.el.style.transition = ''; });
                saveTrackerTabOrder(); 
                setTimeout(() => { window.isDraggingTrackerTab = false; }, 50);
            }
            draggedItem = null;
        });
    }

    function saveTrackerTabOrder() { 
        const container = document.querySelector('#tab-tracker .tabs-header');
        if (container) {
            localStorage.setItem('ultTrackerTabsOrder', JSON.stringify(Array.from(container.querySelectorAll('.tracker-tab-btn')).map(t => t.id))); 
        }
    }

    function loadTrackerTabOrder() {
        const orderStr = localStorage.getItem('ultTrackerTabsOrder');
        if (!orderStr) return;
        try { 
            const order = JSON.parse(orderStr); 
            const container = document.querySelector('#tab-tracker .tabs-header'); 
            if (container) {
                order.forEach(id => { const tab = document.getElementById(id); if (tab) container.appendChild(tab); }); 
            }
        } catch(e){}
    }

})();

// ==========================================
// PROJECTS SORT & SEARCH FILTER
// ==========================================
window.projectSortState = { filter: 'all', sort: 'newest' };

window.openProjectSortMenu = function(btnEl) {
    // Aggressively clean up any stuck UI states
    if (window.projectSortMenu) { 
        window.projectSortMenu.remove(); 
        window.projectSortMenu = null; 
        if (window._closeProjectSortMenu) document.removeEventListener('click', window._closeProjectSortMenu);
        return; 
    }

    const menu = document.createElement('div');
    menu.className = 'ctx-menu'; 
    menu.style.width = '140px';
    menu.style.zIndex = '99999';

    const opts = [
        { type: 'label', text: 'FILTER TIME' },
        { type: 'filter', id: 'all', text: 'All Time' },
        { type: 'filter', id: 'today', text: 'Today' },
        { type: 'filter', id: 'week', text: 'This Week' },
        { type: 'filter', id: 'month', text: 'This Month' },
        { type: 'filter', id: 'year', text: 'This Year' },
        { type: 'divider' },
        { type: 'label', text: 'SORT ORDER' },
        { type: 'sort', id: 'newest', text: 'Newer at top' },
        { type: 'sort', id: 'oldest', text: 'Older at top' }
    ];

    opts.forEach(o => {
        if (o.type === 'label') {
            const l = document.createElement('div');
            l.style.padding = '8px 12px 4px 12px';
            l.style.fontSize = '10px';
            l.style.color = 'var(--text-secondary)';
            l.style.fontWeight = 'bold';
            l.innerText = o.text;
            menu.appendChild(l);
        } else if (o.type === 'divider') {
            const d = document.createElement('div');
            d.style.height = '1px';
            d.style.background = 'var(--border-color)';
            d.style.margin = '4px 0';
            menu.appendChild(d);
        } else {
            const item = document.createElement('div');
            item.className = 'ctx-item';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.justifyContent = 'space-between';
            item.style.padding = '6px 12px';

            let isActive = (o.type === 'filter' && window.projectSortState.filter === o.id) || 
                           (o.type === 'sort' && window.projectSortState.sort === o.id);

            item.innerHTML = `<span style="font-size:11px; ${isActive ? 'color:var(--rfx-text-1);' : ''}">${o.text}</span>` + 
                             (isActive ? `<svg viewBox="0 0 24 24" width="12" height="12" stroke="var(--rfx-text-1)" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>` : '');
            
            item.onclick = (e) => {
                e.stopPropagation();
                if (o.type === 'filter') window.projectSortState.filter = o.id;
                if (o.type === 'sort') window.projectSortState.sort = o.id;
                if (window.applyProjectSortAndFilter) window.applyProjectSortAndFilter();
                menu.remove();
                window.projectSortMenu = null;
                if (window._closeProjectSortMenu) document.removeEventListener('click', window._closeProjectSortMenu);
            };
            menu.appendChild(item);
        }
    });

    document.body.appendChild(menu);
    window.projectSortMenu = menu;

    const rect = btnEl.getBoundingClientRect();
    if(window.repositionMenu) {
        window.repositionMenu(menu, rect.left - (140 - rect.width), rect.bottom + 4);
    } else {
        menu.style.position = 'absolute';
        menu.style.left = (rect.left - (140 - rect.width)) + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';
    }

    // Attach a named global listener so it can be securely killed
    window._closeProjectSortMenu = function(e) {
        if (window.projectSortMenu && !window.projectSortMenu.contains(e.target) && !btnEl.contains(e.target)) {
            window.projectSortMenu.remove();
            window.projectSortMenu = null;
            document.removeEventListener('click', window._closeProjectSortMenu);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', window._closeProjectSortMenu);
    }, 10);
};

window.applyProjectSortAndFilter = function() {
    // Pipe all menu clicks directly into the master rendering engine 
    if (typeof window.updateProjectsUI === 'function') {
        window.updateProjectsUI();
    }
};