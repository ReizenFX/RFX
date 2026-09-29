// This tab's ExtendScript backend (jsx/discord.jsx), loaded on first use.
const discordJsx = window.createJsxLoader('discord.jsx');
(function() {
    let discordrpc = null;
    let fs = null;
    try {
        discordrpc = require('discord-rpc');
        fs = require('fs');
    } catch(e) {
        console.error("Node modules not found:", e);
        setTimeout(() => {
            const ver = document.getElementById('version');
            if(ver) ver.innerText = "Error: NodeJS / node_modules missing";
        }, 1000);
        return;
    }

    class StateManager {
        constructor(localStorage) {
            this.localStorage = localStorage;
            this.defaults = {
                versionInfo: "Integrated v3.0", power: true, rpcConnection: null, rpcDetails: null, rpcState: null,
                rpcSmallImageKey: null, rpcPartySize: null, rpcPartyMax: null, showDetails: true,
                showState: true, showPrefix: true, showTool: true, showParty: true, showStreaks: true, customMainImage: false, customMainImageURL: null,
                customPrefix: false, customPrefixStr: null, customProject: false, customProjectStr: null,
                customState: false, customStateStr: null, customParty: false, customPartyStr: null,
                customToolImage: false, customToolImageURL: null, customToolName: false, customToolNameStr: null, 
                customIntervalVal: "",
                btn1Enabled: false, btn1Label: "", btn1Url: "",
                btn2Enabled: false, btn2Label: "", btn2Url: ""
            };
            this.init();
        }
        init() {
            const rawData = this.localStorage.getItem('discordData');
            let data = rawData ? JSON.parse(rawData) : null;
            for (const key in this.defaults) {
                this[key] = this.defaults[key];
                if (data && key in data) this[key] = data[key];
            }
            
            this.rpcDetails = "Untitled Project.aep"; 
            this.rpcState = "Idling."; 
            this.rpcSmallImageKey = null; 
            this.rpcPartySize = null; 
            this.rpcPartyMax = null;
        }
        updateFromObj(obj) {
            let safeSaveData = {};
            for (const key in this.defaults) { 
                if (key in obj) this[key] = obj[key]; 
                safeSaveData[key] = this[key];
            }
            this.localStorage.setItem('discordData', JSON.stringify(safeSaveData));
        }
    }

    class AdobeApp {
        constructor() {
            this.csInterface = new CSInterface();
            this.clientId = "1387049921982501055"; 
            this.appName = "Adobe After Effects";
            this.appImg = "https://res.cloudinary.com/dfzaret8p/image/v3/upload/AE.png";
        }
        load() {
            try {
                const path = this.csInterface.getSystemPath(SystemPath.EXTENSION);
                const rawConfig = fs.readFileSync(`${path}/backend/config.json`, 'utf-8');
                const config = JSON.parse(rawConfig);
                const appCode = this.csInterface.getApplicationID();
                
                if (config && config[appCode]) {
                    this.clientId = config[appCode].id || this.clientId;
                    this.appName = config[appCode].name || this.appName;
                    this.appImg = config[appCode].img || this.appImg;
                } else {
                    if (appCode === "PHSP" || appCode === "PHXS") { this.clientId = "1388901117156393171"; this.appName = "Adobe Photoshop"; this.appImg = "https://res.cloudinary.com/dfzaret8p/image/upload/PS_New.png"; }
                    else if (appCode === "PPRO") { this.clientId = "1389140344565923901"; this.appName = "Adobe Premiere Pro"; this.appImg = "https://res.cloudinary.com/dfzaret8p/image/upload/PR_New.png"; }
                }
            } catch (e) { console.log("Config load failed, using fallbacks."); }
        }
    }

    class AdobeRPC {
        constructor(stateManager, updateUI) {
            this.client = null; this.interval = null;
            this.adobeApp = new AdobeApp();
            this.stateManager = stateManager;
            this.updateUI = updateUI;
            this.startTimestamp = new Date();
            this.csInterface = new CSInterface();
            this.adobeApp.load();
        }

        login() {
            if (!this.stateManager.power) {
                this.stateManager.rpcConnection = 'disconnected'; this.updateUI(); return;
            }
            
            if (this.client) this.client.destroy().catch(()=>{});
            this.client = new discordrpc.Client({ transport: 'ipc' });

            let isReconnecting = false;
            const reconnect = () => {
                if (!isReconnecting) {
                    this.stateManager.rpcConnection = 'connecting'; this.updateUI();
                    setTimeout(() => this.login(), 4000);
                    isReconnecting = true;
                }
            };

            this.client.once("ready", () => {
                this.stateManager.rpcConnection = 'connected';
                this.updateUI();
                
                // FIX: Clear any stuck local cache first to force a server broadcast
                const safePid = (typeof process !== 'undefined' && process.pid) ? process.pid : 9999;
                if (this.client && typeof this.client.request === 'function') {
                    this.client.request('SET_ACTIVITY', { pid: safePid, activity: null }).catch(()=>{});
                }
                
                // Wait 1.5 seconds before sending the real payload so Discord's server can sync
                setTimeout(() => {
                    this.startPolling();
                }, 1500);
            });

            this.client.once("disconnected", () => {
                if (this.stateManager.power) { reconnect(); return; }
                this.stateManager.rpcConnection = 'disconnected'; this.updateUI();
            });

            this.stateManager.rpcConnection = 'connecting'; this.updateUI();
            this.client.login({ clientId: this.adobeApp.clientId }).catch((err) => {
                if (this.stateManager.power) { reconnect(); return; }
                this.stateManager.rpcConnection = 'disconnected'; this.updateUI();
            });
        }

        logout() {
            if (this.client) {
                this.client.clearActivity().catch(()=>{}).then(() => {
                    this.client.destroy().catch(()=>{});
                });
            }
            clearInterval(this.interval);
            this.stateManager.rpcConnection = 'disconnected';
            this.updateUI();
        }

        executeScript(props, func) {
            discordJsx(func, (r) => {
                if (r === null || r === "EvalScript error." || r === "undefined") return;
                if (r != this.stateManager[props]) {
                    this.stateManager[props] = r;
                    this.updateActivity();
                }
            });
        }

        safeStr(str) {
            if (!str || typeof str !== 'string') return undefined;
            let s = str.trim();
            if (s === "") return undefined;
            if (s.length === 1) s = s + "\u200B"; 
            if (s.length > 128) s = s.substring(0, 125) + "...";
            return s;
        }

        updateActivity() {
            if (this.stateManager.rpcConnection !== "connected" || !this.stateManager.power) return;
            
            let trackerStreak = "";
            let dynamicStart = this.startTimestamp; 
            
            try {
                const elStreak = document.getElementById('streak-days');
                if (elStreak) {
                    let val = parseInt(elStreak.innerText.trim(), 10);
                    if (!isNaN(val) && val > 0) trackerStreak = val.toString();
                }
                
                const elSession = document.getElementById('session-time');
                if (elSession) {
                    const parts = elSession.innerText.trim().split(':');
                    if (parts.length === 3) {
                        let ms = (parseInt(parts[0], 10) * 3600000) + 
                                 (parseInt(parts[1], 10) * 60000) + 
                                 (parseInt(parts[2], 10) * 1000);
                        if (ms > 0) dynamicStart = new Date(Date.now() - ms);
                    }
                }
            } catch(e) { console.warn("Tracker sync failed:", e); }

            const activity = { startTimestamp: dynamicStart, largeImageKey: this.adobeApp.appImg, largeImageText: this.adobeApp.appName };
            
            let projectStr = (this.stateManager.customProject && this.stateManager.customProjectStr) ? this.stateManager.customProjectStr : (this.stateManager.showDetails ? this.stateManager.rpcDetails : "");
            
            let compStr = "";
            if (this.stateManager.customState && this.stateManager.customStateStr) {
                compStr = this.stateManager.customStateStr;
            } else if (this.stateManager.rpcState && this.stateManager.showState) {
                compStr = this.stateManager.rpcState.split(" | ")[0]; 
            }

            // BAKE THE LAYERS INFO DIRECTLY INTO A STRING
            let partyStr = "";
            if (this.stateManager.customParty && this.stateManager.customPartyStr) {
                let rawVal = this.stateManager.customPartyStr.trim();
                let parts = rawVal.split(/[\/,]/);
                if (parts.length > 1 && !isNaN(parseInt(parts[0])) && !isNaN(parseInt(parts[1]))) {
                    partyStr = ` (${parseInt(parts[0])}/${parseInt(parts[1])} Layers)`;
                } else if (!isNaN(parseInt(rawVal))) {
                    partyStr = ` (${parseInt(rawVal)} Layers)`;
                } else if (rawVal !== "") {
                    partyStr = ` (${rawVal})`; 
                }
            } else if (this.stateManager.showParty) {
                let pS = parseInt(this.stateManager.rpcPartySize);
                let pM = parseInt(this.stateManager.rpcPartyMax);
                pS = isNaN(pS) ? 0 : pS;
                pM = isNaN(pM) ? 0 : pM;
                
                let totalLayers = Math.max(pS, pM);
                
                // Only show total layers
                if (totalLayers > 0) {
                    partyStr = ` (${totalLayers} Layers)`;
                }
            }

            let isIdling = (compStr === "Idling." || compStr === "No Composition" || compStr === "");
            let rawPrefix = (this.stateManager.customPrefix && this.stateManager.customPrefixStr) ? this.stateManager.customPrefixStr : "Working on";
            
            // Only add the prefix if the toggle is turned ON
            let prefix = this.stateManager.showPrefix ? (rawPrefix.trim() + " ") : ""; 
            
            // ATTACH IT TO THE COMP NAME
            let formattedComp = isIdling ? compStr : (prefix + compStr + partyStr);

            let finalDetails = "";
            let finalState = "";

            if (this.stateManager.showStreaks) {
                if (projectStr && compStr) {
                    finalDetails = projectStr + " | " + formattedComp;
                } else {
                    finalDetails = projectStr || formattedComp || "Untitled Project.aep"; 
                }
                finalState = (trackerStreak !== "") ? (trackerStreak + "x Streak") : "0x Streak";
            } else {
                finalDetails = projectStr || "Untitled Project.aep"; 
                finalState = formattedComp || "Active";
            }

            let safeD = this.safeStr(finalDetails);
            if (safeD) activity.details = safeD;
            
            let safeS = this.safeStr(finalState);
            if (safeS) activity.state = safeS;
            
            if (this.stateManager.customToolImage && this.stateManager.customToolImageURL) {
                activity.smallImageKey = this.stateManager.customToolImageURL;
                if (this.stateManager.customToolName && this.stateManager.customToolNameStr) {
                    activity.smallImageText = this.stateManager.customToolNameStr.trim();
                } else {
                    activity.smallImageText = "Custom Tool";
                }
            }
            else if (this.stateManager.rpcSmallImageKey && this.stateManager.showTool) {
                activity.smallImageKey = this.stateManager.rpcSmallImageKey;
                try {
                    let urlStr = this.stateManager.rpcSmallImageKey;
                    let filename = urlStr.substring(urlStr.lastIndexOf('/') + 1).split('.')[0];
                    let cleanName = decodeURIComponent(filename).replace(/_/g, ' ').replace(/["']/g, '').trim();
                    if (cleanName && cleanName !== "YOUR LINK") activity.smallImageText = cleanName;
                } catch(e) {}
            }
            
            if (this.stateManager.customMainImage && this.stateManager.customMainImageURL) activity.largeImageKey = this.stateManager.customMainImageURL;

            // ==========================================
            // DISCORD BUTTON IPC BYPASS
            // ==========================================
            let buttons = [];
            
            function cleanUrl(rawUrl) {
                let u = rawUrl.trim();
                if (!u) return "";
                if (!u.startsWith('http://') && !u.startsWith('https://')) {
                    return 'https://' + u;
                }
                return u;
            }
            
            if (this.stateManager.btn1Enabled && this.stateManager.btn1Label && this.stateManager.btn1Url) {
                let safeUrl1 = cleanUrl(this.stateManager.btn1Url);
                if (safeUrl1) buttons.push({ label: this.stateManager.btn1Label.substring(0, 32).trim(), url: safeUrl1 });
            }

            if (this.stateManager.btn2Enabled && this.stateManager.btn2Label && this.stateManager.btn2Url) {
                let safeUrl2 = cleanUrl(this.stateManager.btn2Url);
                if (safeUrl2) buttons.push({ label: this.stateManager.btn2Label.substring(0, 32).trim(), url: safeUrl2 });
            }

            let rawActivity = {
                details: activity.details,
                state: activity.state,
                assets: {
                    large_image: activity.largeImageKey,
                    large_text: activity.largeImageText,
                    small_image: activity.smallImageKey,
                    small_text: activity.smallImageText
                },
                timestamps: activity.startTimestamp ? { 
                    start: Math.round(new Date(activity.startTimestamp).getTime()) 
                } : undefined,
                party: undefined,
                instance: false
            };

            if (buttons.length > 0) {
                rawActivity.buttons = buttons;
            }

            for (let key in rawActivity) {
                if (rawActivity[key] === undefined) delete rawActivity[key];
            }
            if (rawActivity.assets) {
                for (let key in rawActivity.assets) {
                    if (rawActivity.assets[key] === undefined) delete rawActivity.assets[key];
                }
                if (Object.keys(rawActivity.assets).length === 0) delete rawActivity.assets;
            }

            const currentPid = (process && process.pid) ? process.pid : 9999;
            
            if (this.client && typeof this.client.request === 'function') {
                this.client.request('SET_ACTIVITY', {
                    pid: currentPid,
                    activity: rawActivity
                }).catch(()=>{});
            } else {
                this.client.setActivity(activity).catch(()=>{});
            }
        }
        
        startPolling() {
            this.updateActivity();
            if (this.interval) clearInterval(this.interval);

            let intervalSec = 15;
            // FIX: Now relies directly on the input value instead of checking for a toggle
            if (this.stateManager.customIntervalVal) {
                let parsed = parseInt(this.stateManager.customIntervalVal);
                if (!isNaN(parsed)) { 
                    intervalSec = parsed; 
                    if (intervalSec < 15) intervalSec = 15; 
                    if (intervalSec > 4000) intervalSec = 4000; 
                }
            }

            this.interval = setInterval(()=>{
                if (this.stateManager.rpcConnection !== "connected") return;
                this.executeScript('rpcDetails', 'getDetails()');
                this.executeScript('rpcState', 'getState()');
                this.executeScript('rpcSmallImageKey', 'getSmallImageKey()');
                this.executeScript('rpcPartySize', 'getPartySize()');
                this.executeScript('rpcPartyMax', 'getPartyMax()');
            }, intervalSec * 1000); 
        }

        reload() {
            if (!this.stateManager.power && this.stateManager.rpcConnection === "connected") { this.logout(); return; }
            if (this.stateManager.power && this.stateManager.rpcConnection === "disconnected") { this.login(); return; }
            if (this.stateManager.power) { if (this.stateManager.rpcConnection === "connected") this.startPolling(); else this.updateActivity(); }
        }
    }

    const versionInfo = document.getElementById('version');
    const powerSwitchButton = document.getElementById('button');
    const connectionInfo = document.getElementById('state');
    const statusIndicator = document.querySelector('.status-indicator') || document.getElementById('status-dot');

    const elements = {
        'toggle-details': 'showDetails', 'toggle-prefix': 'showPrefix', 'toggle-state': 'showState', 'toggle-tool': 'showTool', 'toggle-party': 'showParty', 'toggle-streaks': 'showStreaks',
        'toggle-custom-project': 'customProject', 'toggle-custom-state': 'customState', 'toggle-custom-party': 'customParty',
        'toggle-custom-main-image': 'customMainImage', 'toggle-custom-tool-image': 'customToolImage', 'toggle-custom-prefix': 'customPrefix',
        'toggle-custom-tool-name': 'customToolName',
        'toggle-btn1': 'btn1Enabled', 'toggle-btn2': 'btn2Enabled'
    };

    const inputs = {
        'custom-project-str': 'customProjectStr', 'custom-state-str': 'customStateStr', 'custom-party-str': 'customPartyStr',
        'custom-main-image-url': 'customMainImageURL', 'custom-tool-image-url': 'customToolImageURL', 'custom-prefix-str': 'customPrefixStr',
        'custom-tool-name-str': 'customToolNameStr',
        'btn1-label': 'btn1Label', 'btn1-url': 'btn1Url',
        'btn2-label': 'btn2Label', 'btn2-url': 'btn2Url'
    };

    let discordErrorTimeout;
    function showDiscordError(message) {
        const overlay = document.getElementById('discordNotificationOverlay');
        const text = document.getElementById('discordNotificationText');
        if (!overlay || !text) return;
        text.innerText = message;
        overlay.classList.add('show', 'active');
        if (discordErrorTimeout) clearTimeout(discordErrorTimeout);
        discordErrorTimeout = setTimeout(() => {
            overlay.classList.remove('show', 'active');
        }, 3500);
    }

    const closeBtn = document.getElementById('discordCloseNotifBtn');
    if (closeBtn) closeBtn.onclick = () => document.getElementById('discordNotificationOverlay').classList.remove('show', 'active');

    function main() {
        const stateManager = new StateManager(localStorage);
        const rpc = new AdobeRPC(stateManager, () => renderUI(stateManager));

        function dispatchUpdate() {
            stateManager.updateFromObj(stateManager);
            renderUI(stateManager);
            rpc.reload();
        }

        function renderUI(state) {
            if(connectionInfo) {
                if (state.rpcConnection === "connected") { connectionInfo.innerHTML = 'Connected'; if(statusIndicator) statusIndicator.className = 'discord-status-dot is-connected'; }
                else if (state.rpcConnection === "connecting") { connectionInfo.innerHTML = 'Connecting...'; if(statusIndicator) statusIndicator.className = 'discord-status-dot is-connecting'; }
                else { connectionInfo.innerHTML = 'Disconnected'; if(statusIndicator) statusIndicator.className = 'discord-status-dot is-off'; }
            }
            if(powerSwitchButton) {
                powerSwitchButton.innerHTML = state.power ? 'Turn Off Discord' : 'Turn On Discord';
                powerSwitchButton.className = state.power ? 'power-on btn-secondary' : 'power-off btn-primary';
                powerSwitchButton.onclick = () => { stateManager.power = !stateManager.power; dispatchUpdate(); };
            }
            if(versionInfo) versionInfo.innerHTML = state.versionInfo;

            for (let id in elements) {
                let el = document.getElementById(id);
                if (el) { el.checked = state[elements[id]]; el.onchange = (e) => { stateManager[elements[id]] = e.target.checked; dispatchUpdate(); }; }
            }
            for (let id in inputs) {
                let el = document.getElementById(id);
                if (el) { el.value = state[inputs[id]] || ""; el.onchange = (e) => { stateManager[inputs[id]] = e.target.value; dispatchUpdate(); }; }
            }

            let intEl = document.getElementById('custom-interval-val');
            if (intEl) {
                intEl.value = state.customIntervalVal || "";
                intEl.onchange = (e) => {
                    let raw = e.target.value.trim();
                    if (raw === "") { stateManager.customIntervalVal = ""; dispatchUpdate(); return; }
                    
                    let val = parseInt(raw);
                    if (isNaN(val) || val < 15) {
                        showDiscordError("Discord API minimum is 15 seconds.");
                        val = 15;
                    } else if (val > 4000) {
                        showDiscordError("Update interval cannot exceed 4000 seconds.");
                        val = 4000;
                    }
                    
                    stateManager.customIntervalVal = val; 
                    e.target.value = val; 
                    dispatchUpdate();
                };
            }
        }

        renderUI(stateManager);
        rpc.login();

        window.addEventListener("beforeunload", () => rpc.logout());
        try { new CSInterface().addEventListener("com.adobe.csxs.events.ApplicationBeforeQuit", () => rpc.logout()); } catch(e){}
    }

    setTimeout(main, 800);
})();