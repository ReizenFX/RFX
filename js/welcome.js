/* ============================================================================
   RFX WELCOME + DEPENDENCIES OVERVIEW  (js/welcome.js, not a tab)
   Shown on first launch, and any time from the Dependencies button in the tab bar.
   Explains what RFX is and which tabs need extra downloads (from Phase 1's audit),
   with size, status, "Download all", per-tab downloads and "Later". Installs run in
   the background through js/deps.js, so the panel stays usable; the Dependencies
   button shows their progress. Each tab registers its own dependencies; this file
   only reads them.
   ========================================================================== */
(function () {
    'use strict';

    const SEEN_KEY = 'rfxWelcomeSeen';

    // Tabs that need extra files, in the order shown. Sizes are refined from the
    // official sources once they answer.
    const TABS = [
        { tab: 'caption', name: 'Caption', needs: 'Speech engine (Faster-Whisper-XXL), speech model (large-v3), FFmpeg', size: 'about 4.4 GB',
          open: () => window.captionOpenSettings && window.captionOpenSettings() },
        { tab: 'download', name: 'Download', needs: 'yt-dlp, FFmpeg + FFprobe, Deno', size: 'about 245 MB',
          open: () => window.downloadOpenSettings && window.downloadOpenSettings() },
        { tab: 'assets', name: 'Assets', needs: 'FFmpeg, for GIF previews only', size: 'about 185 MB',
          open: () => window.assetsOpenSettings && window.assetsOpenSettings() }
    ];
    const NODE_MODULES = ['discord-rpc', 'node-fetch', 'ws'];   // package.json dependencies (Discord tab)

    const appName = () => (window.APP && window.APP.name) || 'RFX';
    const D = () => window.RFXDeps || null;
    const exactSizes = {};   // tab -> bytes, from the sources

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }
    function button(label, cls, onClick) {
        const b = el('button', 'rfxdep-btn ' + (cls || ''), label);
        b.addEventListener('click', ev => { ev.stopPropagation(); onClick(b); });
        return b;
    }

    // ------------------------------------------------------------------ status
    function visibleDeps(tab) {
        const t = D() && D().tabs().find(x => x.tab === tab);
        return t ? t.deps.filter(d => !d.hidden) : [];
    }
    function tabStatus(tab) {
        const deps = visibleDeps(tab);
        let ready = 0, legacy = 0, running = null, failed = null;
        deps.forEach(d => {
            const r = D().resolve(tab, d.id);
            if (r.state !== 'missing') ready++;
            if (r.state === 'legacy') legacy++;
            const j = D().job(tab, d.id);
            if (j && !j.finished) running = running || { dep: d, job: j };
            else if (j && j.finished && j.error && !j.cancelled && r.state === 'missing') failed = failed || { dep: d, error: j.error };
        });
        return { total: deps.length, ready: ready, legacy: legacy, running: running, failed: failed, missing: deps.length - ready };
    }
    function missingDeps(tab) { return visibleDeps(tab).filter(d => D().resolve(tab, d.id).state === 'missing'); }

    function nodeModulesMissing() {
        try {
            const fs = require('fs'), path = require('path');
            const ext = D() && D().extensionRoot();
            if (!ext) return null;
            return NODE_MODULES.filter(n => !fs.existsSync(path.join(ext, 'node_modules', n, 'package.json')));
        } catch (e) { return null; }
    }

    function downloadTab(tab) {
        missingDeps(tab).forEach(d => D().install(tab, d.id));
    }
    function downloadAll() { TABS.forEach(t => downloadTab(t.tab)); }

    /* Sum of the latest download sizes per tab (FFmpeg counted per tab; it is
       fetched once when several tabs install it together). */
    async function refineSizes(onDone) {
        for (const t of TABS) {
            let sum = 0, ok = true;
            for (const d of visibleDeps(t.tab)) {
                try { const info = await D().latest(t.tab, d.id); sum += info.files.reduce((n, f) => n + (f.size || 0), 0); }
                catch (e) { ok = false; }
            }
            if (ok && sum) exactSizes[t.tab] = sum;
        }
        onDone();
    }

    // ------------------------------------------------------------------ dialog
    function modal(title) {
        const old = document.getElementById('rfx-welcome');
        if (old) old.remove();
        const overlay = el('div', 'rfxdep-overlay');
        overlay.id = 'rfx-welcome';
        const card = el('div', 'rfxdep-card');
        card.style.width = '520px';
        const head = el('div', 'rfxdep-card-head');
        head.appendChild(el('div', 'rfxdep-card-title', title));
        const x = el('button', 'rfxdep-x');
        x.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        head.appendChild(x);
        const body = el('div', 'rfxdep-card-body');
        const foot = el('div', 'rfxdep-card-foot');
        card.appendChild(head);
        card.appendChild(body);
        card.appendChild(foot);
        overlay.appendChild(card);
        const close = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {} overlay.remove(); };
        x.onclick = close;
        overlay.addEventListener('mousedown', ev => { if (ev.target === overlay) close(); });
        document.body.appendChild(overlay);
        return { overlay: overlay, body: body, foot: foot, close: close };
    }

    const statusRefs = {};   // tab -> chip element, for in-place progress updates

    function jobChipText(j) {
        const pct = (j.stage === 'downloading' || j.stage === 'paused') && j.total ? ' ' + Math.floor(j.received / j.total * 100) + '%' : '';
        if (j.stage === 'paused') return 'Paused' + pct;
        if (j.stage === 'queued') return 'Waiting';
        return (j.stage === 'downloading' ? 'Downloading' : 'Installing') + pct;
    }

    function statusCell(t) {
        const cell = el('td');
        const s = tabStatus(t.tab);
        delete statusRefs[t.tab];
        if (s.running) {
            const j = s.running.job;
            const chip = el('span', 'rfxdep-chip ' + (j.stage === 'paused' ? 'is-legacy' : 'is-busy'), jobChipText(j));
            statusRefs[t.tab] = chip;
            cell.appendChild(chip);
            cell.appendChild(el('div', 'rfxdep-small', s.running.dep.label + (j.stage !== 'downloading' ? ' - ' + j.stage : '')));
        } else if (s.total && s.ready === s.total) {
            cell.appendChild(el('span', 'rfxdep-chip is-ok', 'Ready'));
            if (s.legacy) cell.appendChild(el('div', 'rfxdep-small', 'Using existing files' + (s.legacy < s.total ? ' for ' + s.legacy + ' of ' + s.total : '')));
        } else if (s.ready) {
            cell.appendChild(el('span', 'rfxdep-chip is-legacy', s.ready + ' of ' + s.total + ' ready'));
        } else {
            cell.appendChild(el('span', 'rfxdep-chip is-missing', 'Not installed'));
        }
        if (s.failed) cell.appendChild(el('div', 'rfxdep-small', 'Last attempt failed: ' + s.failed.error));
        return cell;
    }

    function render(m) {
        const body = m.body;
        body.innerHTML = '';
        const deps = D();

        const intro = el('div', 'rfxdep-section');
        intro.appendChild(el('div', 'rfxdep-text', appName() + ' is a toolkit panel for After Effects: transform and layer tools, effect stacks, colors, easing graphs, an asset library, paste, render presets, time tracking, Discord status, media downloads and automatic captions.'));
        intro.appendChild(el('div', 'rfxdep-text', 'Most tabs work right away. The tabs below need extra programs that are too large to ship with the panel. They download from their official sources (GitHub releases of yt-dlp, BtbN FFmpeg builds, Deno and Purfview\'s Faster-Whisper-XXL, and the large-v3 model on Hugging Face), are checked against the published checksum or exact size, and are kept in each tab\'s own folder:'));
        const where = el('div', 'rfxdep-path', deps ? deps.ui.ltr(deps.defaultRoot() + '\\<tab>') : '%APPDATA%\\RFX\\Dependencies\\<tab>');
        where.style.marginBottom = '6px';
        intro.appendChild(where);
        intro.appendChild(el('div', 'rfxdep-small', 'Each tab can use another folder in its settings. Downloads continue in the background while you use the panel; you can close this window.'));
        body.appendChild(intro);

        if (!deps) {
            body.appendChild(el('div', 'rfxdep-msg is-error', 'Node.js is not available in this panel, so the tabs that need downloads (Caption, Download, and GIF previews in Assets) cannot work. The manifest must enable Node.js (--enable-nodejs).'));
            return;
        }

        const table = el('table', 'rfxdep-table');
        const thead = el('tr');
        ['Tab', 'Needs', 'Status', ''].forEach(h => thead.appendChild(el('th', null, h)));
        table.appendChild(thead);
        TABS.forEach(t => {
            if (!visibleDeps(t.tab).length) return;   // tab not loaded
            const tr = el('tr');
            tr.appendChild(el('td', null, t.name));
            const needs = el('td');
            needs.appendChild(el('div', null, t.needs));
            needs.appendChild(el('div', 'rfxdep-small', 'Download ' + (exactSizes[t.tab] ? deps.formatBytes(exactSizes[t.tab]) : t.size)));
            tr.appendChild(needs);
            tr.appendChild(statusCell(t));
            const act = el('td');
            const s = tabStatus(t.tab);
            if (s.missing && !s.running) act.appendChild(button('Download', 'is-primary', () => downloadTab(t.tab)));
            const set = button('Settings', 'is-ghost', () => { m.close(); if (window.switchTab) window.switchTab('tab-' + t.tab); t.open(); });
            set.style.marginTop = '4px';
            act.appendChild(set);
            tr.appendChild(act);
            table.appendChild(tr);
        });

        body.appendChild(table);

        // The Discord tab downloads nothing; its Node modules ship with RFX. Only say
        // something if they are actually missing (e.g. node_modules was not restored).
        const nm = nodeModulesMissing();
        if (nm && nm.length) {
            const warn = el('div', 'rfxdep-msg is-error', 'The Discord tab cannot work: its bundled Node modules are missing (' + nm.join(', ') + '). Run "npm install" in the extension folder (see README), then reload the panel.');
            warn.style.marginTop = '10px';
            body.appendChild(warn);
        }

        // footer
        m.foot.innerHTML = '';
        const anyMissing = TABS.some(t => visibleDeps(t.tab).length && tabStatus(t.tab).missing);
        const anyRunning = TABS.some(t => tabStatus(t.tab).running);
        const later = el('button', 'rfxdep-done is-secondary', anyMissing ? 'Later' : 'Close');
        later.onclick = m.close;
        m.foot.appendChild(later);
        if (anyMissing) {
            const all = el('button', 'rfxdep-done', anyRunning ? 'Downloading...' : 'Download all');
            all.disabled = anyRunning;
            all.onclick = () => { downloadAll(); render(m); };
            m.foot.appendChild(all);
        }
    }

    function open() {
        const m = modal('Welcome to ' + appName());
        render(m);
        if (!D()) return m;
        let timer = null;
        const off = D().on(evt => {
            if (!m.overlay.isConnected) { off(); return; }
            // Progress ticks only change the percentage: update it in place so the dialog's
            // buttons are not rebuilt while you click them.
            if (evt.progress && evt.job && statusRefs[evt.tab] && evt.job.stage === 'downloading') {
                statusRefs[evt.tab].textContent = jobChipText(evt.job);
                return;
            }
            if (!timer) timer = setTimeout(() => { timer = null; render(m); }, 200);
        });
        refineSizes(() => { if (m.overlay.isConnected) render(m); }).catch(() => {});
        return m;
    }
    window.rfxOpenWelcome = open;

    // ------------------------------------------------------------------ tab-bar button
    function updateButton() {
        const btn = document.getElementById('rfx-deps-btn');
        if (!btn || !D()) return;
        let received = 0, total = 0, running = 0, paused = 0, missing = 0;
        TABS.forEach(t => {
            visibleDeps(t.tab).forEach(d => {
                const j = D().job(t.tab, d.id);
                if (j && !j.finished) { running++; if (j.stage === 'paused') paused++; received += j.received || 0; total += j.total || 0; }
                else if (D().resolve(t.tab, d.id).state === 'missing') missing++;
            });
        });
        const badge = btn.querySelector('.rfx-deps-badge');
        btn.classList.toggle('is-busy', running > 0);
        btn.classList.toggle('is-missing', !running && missing > 0);
        if (running) {
            badge.textContent = total ? Math.floor(received / total * 100) + '%' : '...';
            btn.setAttribute('data-tooltip', paused === running
                ? paused + ' download' + (paused > 1 ? 's are' : ' is') + ' paused. Click to resume or cancel.'
                : 'Downloading ' + (running - paused) + ' item' + (running - paused > 1 ? 's' : '') + ' in the background' + (paused ? ' (' + paused + ' paused)' : '') + '. Click for details.');
        } else {
            badge.textContent = '';
            btn.setAttribute('data-tooltip', missing ? 'Dependencies: ' + missing + ' download' + (missing > 1 ? 's' : '') + ' still needed by some tabs' : 'Dependencies: everything is installed');
        }
    }

    function init() {
        const btn = document.getElementById('rfx-deps-btn');
        if (btn) btn.addEventListener('click', open);
        if (D()) {
            let t = null;
            D().on(() => { if (!t) t = setTimeout(() => { t = null; updateButton(); }, 300); });
        }
        // Tabs register their dependencies on DOMContentLoaded; look after that.
        setTimeout(() => {
            updateButton();
            let seen = null;
            try { seen = localStorage.getItem(SEEN_KEY); } catch (e) {}
            if (!seen) open();
        }, 800);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
