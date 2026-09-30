/* ============================================================================
   RFX SETTINGS + WELCOME  (js/welcome.js, not a tab)
   - Settings page: the gear button at the right of the tab bar. Sections:
     Appearance (theme, accent, density, roundness, motion, live preview),
     Dependencies (every tab's downloads, per tab and "Download all"), About.
   - Welcome: a full-panel page on first launch (rfxWelcomeSeen), then the
     "Downloads" step; Skip / Later go straight to the panel. Reopen it from
     Settings > About.
   Installs run in the background through js/deps.js, so the panel stays usable;
   the gear button shows their progress. Each tab registers its own dependencies;
   this file only reads them. Styles: css/settings.css, css/deps.css.
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

    const TOUR = [
        ['Transform', 'Anchor, align, order and new layers'],
        ['FX', 'Copy and paste effect stacks'],
        ['Color', 'Colour picker and presets'],
        ['Graph', 'Easing curves and presets'],
        ['Assets', 'Your library of comps, media and expressions'],
        ['Paste', 'Paste files and clipboard into AE'],
        ['Render', 'Render presets and queue'],
        ['Tracker', 'Time tracking per project'],
        ['Discord', 'Rich presence while you work'],
        ['Download', 'Download media from links'],
        ['Caption', 'Automatic captions and styles']
    ];

    const ICONS = {
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
    };

    const appName = () => (window.APP && window.APP.name) || 'RFX';
    const D = () => window.RFXDeps || null;
    const T = () => window.RFXTheme || null;
    const exactSizes = {};   // tab -> bytes, from the sources

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }
    function btn(label, cls, onClick, tooltip) {
        const b = el('button', 'rfx-btn ' + (cls || ''), label);
        if (tooltip) b.setAttribute('data-tooltip', tooltip);
        b.addEventListener('click', ev => { ev.stopPropagation(); onClick(b); });
        return b;
    }
    function label(text) { return el('div', 'rfxset-label', text); }
    function markSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {} }

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
    const shownTabs = () => TABS.filter(t => D() && visibleDeps(t.tab).length);
    const anyMissing = () => shownTabs().some(t => tabStatus(t.tab).missing);
    const anyRunning = () => shownTabs().some(t => tabStatus(t.tab).running);

    function nodeModulesMissing() {
        try {
            const fs = require('fs'), path = require('path');
            const ext = D() && D().extensionRoot();
            if (!ext) return null;
            return NODE_MODULES.filter(n => !fs.existsSync(path.join(ext, 'node_modules', n, 'package.json')));
        } catch (e) { return null; }
    }

    function downloadTab(tab) { missingDeps(tab).forEach(d => D().install(tab, d.id)); }
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
    const sizeText = t => 'Download ' + (exactSizes[t.tab] ? D().formatBytes(exactSizes[t.tab]) : t.size);

    function jobChipText(j) {
        const pct = (j.stage === 'downloading' || j.stage === 'paused') && j.total ? ' ' + Math.floor(j.received / j.total * 100) + '%' : '';
        if (j.stage === 'paused') return 'Paused' + pct;
        if (j.stage === 'queued') return 'Waiting';
        return (j.stage === 'downloading' ? 'Downloading' : 'Installing') + pct;
    }

    // ------------------------------------------------------------------ page shell
    let current = null;   // the open page
    function page(title, opts) {
        opts = opts || {};
        if (current) current.close(true);
        const root = el('div', 'rfx-page is-entering');
        root.id = 'rfx-page';
        root.addEventListener('animationend', e => { if (e.target === root) root.classList.remove('is-entering'); });
        setTimeout(() => root.classList.remove('is-entering'), 600);   // no animation (reduce motion)
        const head = el('div', 'rfx-page-head');
        if (opts.onBack) {
            const b = el('button', 'rfx-page-iconbtn');
            b.innerHTML = ICONS.back;
            b.setAttribute('data-tooltip', 'Back');
            b.onclick = opts.onBack;
            head.appendChild(b);
        }
        const titleEl = el('div', 'rfx-page-title', title);
        head.appendChild(titleEl);
        const x = el('button', 'rfx-page-iconbtn');
        x.innerHTML = ICONS.close;
        x.setAttribute('data-tooltip', 'Close');
        head.appendChild(x);
        root.appendChild(head);
        const nav = el('div', 'rfx-page-nav');
        if (opts.nav) root.appendChild(nav);
        const body = el('div', 'rfx-page-body');
        const inner = el('div', 'rfx-page-inner');
        body.appendChild(inner);
        root.appendChild(body);
        const foot = el('div', 'rfx-page-foot');
        root.appendChild(foot);

        const onKey = ev => {
            if (ev.key !== 'Escape') return;
            // a tab's settings dialog opened from this page closes first
            if (document.querySelector('.rfxdep-overlay, .rfxset-overlay')) return;
            p.close();
        };
        const p = {
            root: root, head: head, nav: nav, body: body, inner: inner, foot: foot,
            setTitle: t => { titleEl.textContent = t; },
            cleanups: [],
            close: function (replacing) {
                document.removeEventListener('keydown', onKey);
                p.cleanups.forEach(fn => { try { fn(); } catch (e) {} });
                root.remove();
                if (current === p) current = null;
                if (!replacing && opts.onClose) opts.onClose();
            }
        };
        x.onclick = () => p.close();
        document.addEventListener('keydown', onKey);
        document.body.appendChild(root);
        current = p;
        return p;
    }

    // ------------------------------------------------------------------ dependencies overview
    /* One row per tab. Rows are built once and only their status parts are
       refreshed, so an expanded tab panel (with its own buttons and messages)
       is never rebuilt under the mouse. */
    function depsOverview(container, p, opts) {
        opts = opts || {};
        const rows = {};
        const deps = D();
        if (!deps) {
            container.appendChild(el('div', 'rfxdep-msg is-error', 'Node.js is not available in this panel, so the tabs that need downloads (Caption, Download, and GIF previews in Assets) cannot work. The manifest must enable Node.js (--enable-nodejs).'));
            return { refresh: () => {} };
        }

        shownTabs().forEach(t => {
            const row = el('div', 'rfx-deprow');
            const head = el('div', 'rfx-deprow-head');
            head.appendChild(el('div', 'rfx-deprow-name', t.name));
            const chipBox = el('div');
            head.appendChild(chipBox);
            row.appendChild(head);
            row.appendChild(el('div', 'rfx-deprow-needs', t.needs));
            const status = el('div', 'rfx-deprow-status');
            row.appendChild(status);
            const actions = el('div', 'rfx-deprow-actions');
            row.appendChild(actions);
            const detail = el('div', 'rfx-deprow-detail');
            detail.style.display = 'none';
            row.appendChild(detail);
            container.appendChild(row);
            rows[t.tab] = { t: t, chipBox: chipBox, status: status, actions: actions, detail: detail, panel: null, chip: null };
        });

        const nm = nodeModulesMissing();
        if (nm && nm.length) {
            const warn = el('div', 'rfxdep-msg is-error', 'The Discord tab cannot work: its bundled Node modules are missing (' + nm.join(', ') + '). Run "npm install" in the extension folder (see README), then reload the panel.');
            warn.style.marginTop = '10px';
            container.appendChild(warn);
        }

        function refreshRow(r) {
            const t = r.t, s = tabStatus(t.tab);
            r.chipBox.innerHTML = '';
            let chip;
            if (s.running) chip = el('span', 'rfxdep-chip ' + (s.running.job.stage === 'paused' ? 'is-legacy' : 'is-busy'), jobChipText(s.running.job));
            else if (s.total && s.ready === s.total) chip = el('span', 'rfxdep-chip is-ok', 'Ready');
            else if (s.ready) chip = el('span', 'rfxdep-chip is-legacy', s.ready + ' of ' + s.total + ' ready');
            else chip = el('span', 'rfxdep-chip is-missing', 'Not installed');
            r.chip = s.running ? chip : null;
            r.chipBox.appendChild(chip);

            let line = sizeText(t);
            if (s.running) line = s.running.dep.label + (s.running.job.stage !== 'downloading' ? ' - ' + s.running.job.stage : '');
            else if (s.failed) line = 'Last attempt failed: ' + s.failed.error;
            else if (s.total && s.ready === s.total) line = s.legacy ? 'Using existing files' + (s.legacy < s.total ? ' for ' + s.legacy + ' of ' + s.total : '') : 'Everything this tab needs is installed.';
            r.status.textContent = line;

            r.actions.innerHTML = '';
            if (s.missing && !s.running) r.actions.appendChild(btn('Download', 'is-primary', () => { downloadTab(t.tab); refresh(); }));
            const open = r.detail.style.display !== 'none';
            r.actions.appendChild(btn(open ? 'Hide details' : 'Details', '', () => {
                const show = r.detail.style.display === 'none';
                r.detail.style.display = show ? '' : 'none';
                if (show && !r.panel) r.panel = deps.ui.renderPanel(r.detail, t.tab, { showFolder: true });
                refreshRow(r);
            }, 'Versions, updates, folder and removal for each program'));
            if (opts.tabSettings !== false && t.open) r.actions.appendChild(btn('Tab settings', 'is-ghost', () => t.open()));
        }
        function refresh() { Object.keys(rows).forEach(k => refreshRow(rows[k])); if (opts.onChange) opts.onChange(); }
        refresh();

        let timer = null;
        const off = deps.on(evt => {
            if (!container.isConnected) { off(); return; }
            // progress ticks only change the percentage: update it in place
            if (evt.progress && evt.job && rows[evt.tab] && rows[evt.tab].chip && evt.job.stage === 'downloading') {
                rows[evt.tab].chip.textContent = jobChipText(evt.job);
                return;
            }
            if (!timer) timer = setTimeout(() => { timer = null; if (container.isConnected) refresh(); }, 200);
        });
        p.cleanups.push(off);
        refineSizes(() => { if (container.isConnected) refresh(); }).catch(() => {});
        return { refresh: refresh };
    }

    // ------------------------------------------------------------------ settings: appearance
    function appearanceSection(inner) {
        const theme = T();
        if (!theme) { inner.appendChild(el('div', 'rfx-note', 'Appearance settings are not available (js/theme.js did not load).')); return; }

        // theme
        const secTheme = el('div', 'rfxset-section');
        secTheme.appendChild(label('Theme'));
        const cards = el('div', 'rfx-themecards');
        const cardEls = {};
        theme.THEMES.forEach(th => {
            const c = el('button', 'rfx-themecard');
            const art = el('div', 'rfx-themecard-art');
            art.setAttribute('data-rfx-theme', th.id);
            art.innerHTML = '<i></i><i></i><i></i>';
            c.appendChild(art);
            const name = el('div', 'rfx-themecard-name', th.label);
            name.appendChild(el('small', null, th.id === 'mono' ? 'Default' : ''));
            c.appendChild(name);
            c.setAttribute('data-tooltip', th.hint);
            c.onclick = () => { theme.set({ theme: th.id }); sync(); };
            cards.appendChild(c);
            cardEls[th.id] = c;
        });
        secTheme.appendChild(cards);
        inner.appendChild(secTheme);

        // accent
        const secAccent = el('div', 'rfxset-section');
        secAccent.appendChild(label('Accent'));
        const sw = el('div', 'rfx-swatches');
        const swEls = [];
        const mkSwatch = (hex, tip, onPick, extraCls) => {
            const s = el('button', 'rfx-swatch' + (extraCls ? ' ' + extraCls : ''));
            s.innerHTML = ICONS.check;
            s.setAttribute('data-tooltip', tip);
            if (hex) { s.style.setProperty('--sw', hex); s.style.setProperty('--swt', theme.contrastText(hex)); }
            s.onclick = onPick;
            sw.appendChild(s);
            return s;
        };
        const autoSw = mkSwatch(null, 'Theme default', () => { theme.set({ accent: '' }); sync(); });
        // presets follow the theme: greys for Monochrome, soft colours for Color
        const presetBox = el('div', 'rfx-swatch-group');
        sw.appendChild(presetBox);
        let presetsFor = null;
        const buildPresets = th => {
            presetsFor = th;
            presetBox.innerHTML = '';
            swEls.length = 0;
            theme.accentsFor(th).forEach(a => {
                const s = mkSwatch(a.hex, a.label, () => { theme.set({ accent: a.hex }); sync(); });
                presetBox.appendChild(s);
                swEls.push({ hex: a.hex, el: s });
            });
        };
        const colorInput = el('input', 'rfx-colorinput');
        colorInput.type = 'color';
        const customSw = mkSwatch(null, 'Custom colour', () => colorInput.click(), 'is-custom');
        customSw.innerHTML = ICONS.plus;
        sw.appendChild(colorInput);
        secAccent.appendChild(sw);

        const customRow = el('div', 'rfx-accent-custom');
        const hex = el('input', 'rfx-hex');
        hex.type = 'text';
        hex.spellcheck = false;
        hex.maxLength = 7;
        hex.setAttribute('data-tooltip', 'Any colour as #rrggbb');
        const applyHex = () => { const v = theme.normalizeHex(hex.value); if (v) { theme.set({ accent: v }); sync(); } else sync(); };
        hex.addEventListener('change', applyHex);
        hex.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); applyHex(); hex.blur(); } });
        colorInput.addEventListener('input', () => { theme.set({ accent: colorInput.value }); sync(true); });
        colorInput.addEventListener('change', () => { theme.set({ accent: colorInput.value }); sync(); });
        customRow.appendChild(hex);
        customRow.appendChild(el('div', 'rfx-row-sub', 'Used for the main action, switches, sliders and progress.'));
        secAccent.appendChild(customRow);
        inner.appendChild(secAccent);

        // brightness, surface contrast, text
        const sliderRow = (group, title, sub, key, fmt) => {
            const row = el('div', 'rfx-row is-stack');
            const head = el('div', 'rfx-row-head');
            const txt = el('div', 'rfx-row-text');
            txt.appendChild(el('div', 'rfx-row-title', title));
            if (sub) txt.appendChild(el('div', 'rfx-row-sub', sub));
            head.appendChild(txt);
            const val = el('span', 'rfx-row-val');
            head.appendChild(val);
            row.appendChild(head);
            const input = el('input', 'main-slider rfx-range');
            input.type = 'range';
            input.min = theme.RANGES[key][0];
            input.max = theme.RANGES[key][1];
            input.step = 1;
            input.setAttribute('data-tooltip', 'Double-click to reset');
            const paint = () => {
                const v = +input.value, min = +input.min, max = +input.max;
                val.textContent = fmt(v);
                input.style.backgroundImage = 'linear-gradient(var(--rfx-accent), var(--rfx-accent))';
                input.style.backgroundRepeat = 'no-repeat';
                input.style.backgroundPosition = 'left center';
                input.style.backgroundSize = ((v - min) / (max - min) * 100) + '% 3px';
            };
            input.addEventListener('input', () => { const o = {}; o[key] = +input.value; theme.set(o); paint(); });
            input.addEventListener('dblclick', () => { const o = {}; o[key] = theme.DEFAULTS[key]; theme.set(o); sync(); });
            row.appendChild(input);
            group.appendChild(row);
            return { set: v => { if (document.activeElement !== input) input.value = v; paint(); } };
        };
        const signed = v => (v > 0 ? '+' : '') + v;
        const pct = v => v + '%';

        const secTone = el('div', 'rfxset-section');
        secTone.appendChild(label('Brightness and contrast'));
        const toneGroup = el('div', 'rfx-group');
        const brightRow = sliderRow(toneGroup, 'UI brightness', 'Lightness of the interface surfaces (text stays as set below)', 'brightness', signed);
        const surfRow = sliderRow(toneGroup, 'Surface contrast', 'Separation of page, cards, inputs and buttons', 'surfaceContrast', pct);
        const satRow = sliderRow(toneGroup, 'UI saturation', 'Colour in the surfaces, taken from the accent', 'uiSaturation', pct);
        secTone.appendChild(toneGroup);
        inner.appendChild(secTone);

        const secText = el('div', 'rfxset-section');
        secText.appendChild(label('Text'));
        const textGroup = el('div', 'rfx-group');
        const colorRow = el('div', 'rfx-row');
        const ct = el('div', 'rfx-row-text');
        ct.appendChild(el('div', 'rfx-row-title', 'Text colour'));
        ct.appendChild(el('div', 'rfx-row-sub', 'Base colour of all UI text'));
        colorRow.appendChild(ct);
        const colorEnd = el('div', 'rfx-row-end');
        const textSw = el('button', 'rfx-swatch is-text');
        textSw.setAttribute('data-tooltip', 'Pick a colour');
        const textInput = el('input', 'rfx-colorinput');
        textInput.type = 'color';
        textSw.onclick = () => textInput.click();
        const textHex = el('input', 'rfx-hex');
        textHex.type = 'text';
        textHex.spellcheck = false;
        textHex.maxLength = 7;
        const applyTextHex = () => { const v = theme.normalizeHex(textHex.value); if (v) theme.set({ textColor: v }); sync(); };
        textHex.addEventListener('change', applyTextHex);
        textHex.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); applyTextHex(); textHex.blur(); } });
        textInput.addEventListener('input', () => { theme.set({ textColor: textInput.value }); sync(true); });
        textInput.addEventListener('change', () => { theme.set({ textColor: textInput.value }); sync(); });
        const textDefault = btn('Default', 'is-ghost', () => { theme.set({ textColor: '' }); sync(); }, 'Use the theme\'s text colour');
        colorEnd.appendChild(textSw);
        colorEnd.appendChild(textInput);
        colorEnd.appendChild(textHex);
        colorEnd.appendChild(textDefault);
        colorRow.appendChild(colorEnd);
        textGroup.appendChild(colorRow);
        const textConRow = sliderRow(textGroup, 'Text contrast', 'Separation of primary, secondary and muted text', 'textContrast', pct);
        secText.appendChild(textGroup);
        inner.appendChild(secText);

        // what sits on the accent colour: white by default, black when chosen and the accent is light enough
        const secOn = el('div', 'rfxset-section');
        secOn.appendChild(label('On the accent colour'));
        const onGroup = el('div', 'rfx-group');
        const toggleRow = (title, sub, key) => {
            const row = el('div', 'rfx-row');
            const tx = el('div', 'rfx-row-text');
            tx.appendChild(el('div', 'rfx-row-title', title));
            tx.appendChild(el('div', 'rfx-row-sub', sub));
            row.appendChild(tx);
            const sl = el('label', 'switch');
            const input = el('input');
            input.type = 'checkbox';
            input.onchange = () => { const o = {}; o[key] = input.checked ? '1' : '0'; theme.set(o); sync(); };
            sl.appendChild(input);
            sl.appendChild(el('span', 'slider'));
            row.appendChild(sl);
            onGroup.appendChild(row);
            return input;
        };
        const darkTextT = toggleRow('Black text and icons on buttons', 'Apply, Paste, Download, Done and other accent buttons', 'darkText');
        const darkKnobT = toggleRow('Black switch knobs', 'The circle of switches that are on', 'darkKnob');
        const darkMarksT = toggleRow('Black checkmarks and dots', 'Checkboxes, radio buttons and Tracker day circles', 'darkMarks');
        secOn.appendChild(onGroup);
        const onNote = el('div', 'rfx-note', '');
        secOn.appendChild(onNote);
        inner.appendChild(secOn);

        // layout
        const secLayout = el('div', 'rfxset-section');
        secLayout.appendChild(label('Layout'));
        const group = el('div', 'rfx-group');
        const segRow = (title, sub, list, key) => {
            const row = el('div', 'rfx-row is-stack');
            const txt = el('div', 'rfx-row-text');
            txt.appendChild(el('div', 'rfx-row-title', title));
            if (sub) txt.appendChild(el('div', 'rfx-row-sub', sub));
            row.appendChild(txt);
            const seg = el('div', 'rfxset-seg');
            seg.style.minWidth = '0';
            const opts = {};
            list.forEach(o => {
                const b = el('button', 'rfxset-opt');
                b.appendChild(el('span', 't', o.label));
                b.style.padding = '6px 9px';
                b.onclick = () => { const v = {}; v[key] = o.id; theme.set(v); sync(); };
                seg.appendChild(b);
                opts[o.id] = b;
            });
            row.appendChild(seg);
            group.appendChild(row);
            return opts;
        };
        const densityEls = segRow('Density', 'Height of controls and spacing', theme.DENSITIES, 'density');
        const radiusEls = segRow('Roundness', null, theme.RADII, 'radius');
        const motionRow = el('div', 'rfx-row');
        const mt = el('div', 'rfx-row-text');
        mt.appendChild(el('div', 'rfx-row-title', 'Reduce motion'));
        mt.appendChild(el('div', 'rfx-row-sub', 'Turn off hover and open animations'));
        motionRow.appendChild(mt);
        const sw2 = el('label', 'switch');
        const motion = el('input');
        motion.type = 'checkbox';
        motion.onchange = () => { theme.set({ reduceMotion: motion.checked }); sync(); };
        sw2.appendChild(motion);
        sw2.appendChild(el('span', 'slider'));
        motionRow.appendChild(sw2);
        group.appendChild(motionRow);
        secLayout.appendChild(group);
        inner.appendChild(secLayout);

        // live preview (real components)
        const secPrev = el('div', 'rfxset-section');
        secPrev.appendChild(label('Preview'));
        const prev = el('div', 'rfx-preview');
        const r1 = el('div', 'rfx-preview-row');
        r1.appendChild(el('button', 'btn-primary', 'Apply'));
        r1.appendChild(el('button', 'btn-secondary', 'Delete'));
        const pSw = el('label', 'switch');
        const pIn = el('input');
        pIn.type = 'checkbox';
        pIn.checked = true;
        pSw.appendChild(pIn);
        pSw.appendChild(el('span', 'slider'));
        r1.appendChild(pSw);
        prev.appendChild(r1);
        const r2 = el('div', 'rfx-preview-row');
        const bar = el('div', 'rfx-preview-bar');
        bar.appendChild(el('i'));
        r2.appendChild(bar);
        r2.appendChild(el('span', 'rfxdep-chip is-ok', 'Installed'));
        prev.appendChild(r2);
        const menu = el('div', 'rfx-preview-menu');
        ['Preview', 'Import', 'Rename'].forEach((t, i) => menu.appendChild(el('div', i === 1 ? 'hl' : '', t)));
        prev.appendChild(menu);
        secPrev.appendChild(prev);
        inner.appendChild(secPrev);

        const reset = btn('Reset appearance', '', () => { theme.reset(); sync(); }, 'Monochrome theme, default accent and text, comfortable density, round corners');
        inner.appendChild(reset);

        function sync(fromPicker) {
            const s = theme.get();
            Object.keys(cardEls).forEach(k => cardEls[k].classList.toggle('on', k === s.theme));
            const thDef = theme.THEMES.find(x => x.id === s.theme);
            if (presetsFor !== s.theme) buildPresets(s.theme);
            const defHex = (thDef && thDef.accentDefault) || '';
            autoSw.style.setProperty('--sw', defHex);
            autoSw.style.setProperty('--swt', defHex ? theme.contrastText(defHex) : '');
            autoSw.classList.toggle('on', !s.accent);
            let matched = !s.accent;
            swEls.forEach(x => { const on = !!s.accent && x.hex === s.accent; x.el.classList.toggle('on', on); if (on) matched = true; });
            customSw.classList.toggle('on', !matched);
            if (!matched) { customSw.style.setProperty('--sw', s.accent); customSw.style.setProperty('--swt', theme.contrastText(s.accent)); }
            const shown = s.accent || defHex;
            if (document.activeElement !== hex) hex.value = shown;
            if (!fromPicker && shown) colorInput.value = shown;
            Object.keys(densityEls).forEach(k => densityEls[k].classList.toggle('on', k === s.density));
            Object.keys(radiusEls).forEach(k => radiusEls[k].classList.toggle('on', k === s.radius));
            motion.checked = s.reduceMotion;
            brightRow.set(s.brightness);
            surfRow.set(s.surfaceContrast);
            satRow.set(theme.saturation());
            textConRow.set(s.textContrast);
            const textShown = s.textColor || (thDef && thDef.textDefault) || '';
            textSw.style.setProperty('--sw', textShown);
            if (document.activeElement !== textHex) textHex.value = textShown;
            if (!fromPicker && textShown) textInput.value = textShown;
            textDefault.style.visibility = s.textColor ? '' : 'hidden';
            const dk = theme.darkOn();
            darkTextT.checked = dk.text;
            darkKnobT.checked = dk.knob;
            darkMarksT.checked = dk.marks;
            const acNow = s.accent || defHex;
            onNote.textContent = theme.isLight(acNow) ? 'Black is used only while the accent is light enough; otherwise these stay white.' : 'The current accent is dark, so these stay white.';
        }
        sync();
    }

    // ------------------------------------------------------------------ settings: navigation
    /* One navigation with four positions; changing it only moves and reorients
       the same tab bar (see js/theme.js applyLayout, css/global.css, js/nav.js). */
    function navigationSection(inner) {
        const theme = T();
        if (!theme) { inner.appendChild(el('div', 'rfx-note', 'Navigation settings are not available (js/theme.js did not load).')); return; }
        const sec = el('div', 'rfxset-section');
        sec.appendChild(label('Main tabs'));
        const group = el('div', 'rfx-group');
        const segRow = (title, sub, list, key) => {
            const row = el('div', 'rfx-row is-stack');
            const txt = el('div', 'rfx-row-text');
            txt.appendChild(el('div', 'rfx-row-title', title));
            const subEl = el('div', 'rfx-row-sub', sub || '');
            txt.appendChild(subEl);
            row.appendChild(txt);
            const seg = el('div', 'rfxset-seg');
            const opts = {};
            list.forEach(o => {
                const b = el('button', 'rfxset-opt');
                b.appendChild(el('span', 't', o.label));
                b.style.padding = '6px 9px';
                b.onclick = () => { const v = {}; v[key] = o.id; theme.set(v); sync(); };
                seg.appendChild(b);
                opts[o.id] = b;
            });
            row.appendChild(seg);
            group.appendChild(row);
            return { row: row, opts: opts, sub: subEl };
        };
        const pos = segRow('Position', 'Where the main tabs sit. Order and behaviour stay the same.', theme.NAV_POSITIONS, 'navPos');

        const iconRow = el('div', 'rfx-row');
        const it = el('div', 'rfx-row-text');
        it.appendChild(el('div', 'rfx-row-title', 'Icon-only tabs'));
        const iconSub = el('div', 'rfx-row-sub', '');
        it.appendChild(iconSub);
        iconRow.appendChild(it);
        const isw = el('label', 'switch');
        const icons = el('input');
        icons.type = 'checkbox';
        icons.onchange = () => { theme.set({ navIcons: icons.checked }); sync(); };
        isw.appendChild(icons);
        isw.appendChild(el('span', 'slider'));
        iconRow.appendChild(isw);
        group.appendChild(iconRow);

        const sub = segRow('Sub tabs', '', theme.SUB_POSITIONS, 'subTabPos');

        const arrowRow = el('div', 'rfx-row');
        const at = el('div', 'rfx-row-text');
        at.appendChild(el('div', 'rfx-row-title', 'Tab switching arrows'));
        at.appendChild(el('div', 'rfx-row-sub', 'Small previous / next tab buttons in the bottom corners'));
        arrowRow.appendChild(at);
        const asw = el('label', 'switch');
        const arrows = el('input');
        arrows.type = 'checkbox';
        arrows.onchange = () => { theme.set({ navArrows: arrows.checked }); sync(); };
        asw.appendChild(arrows);
        asw.appendChild(el('span', 'slider'));
        arrowRow.appendChild(asw);
        group.appendChild(arrowRow);
        sec.appendChild(group);
        inner.appendChild(sec);
        inner.appendChild(el('div', 'rfx-note', 'With icon-only tabs, hovering a tab shows its name, and for Caption and Tracker its sub tabs, in a small menu that floats over the content.'));
        const reset = btn('Reset navigation', '', () => { theme.resetLayout(); sync(); }, 'Tabs on the left as icons, sub tabs at the bottom, arrows off');
        reset.style.marginTop = '14px';
        inner.appendChild(reset);

        function sync() {
            const s = theme.get(), side = s.navPos === 'left' || s.navPos === 'right';
            Object.keys(pos.opts).forEach(k => pos.opts[k].classList.toggle('on', k === s.navPos));
            icons.checked = side || s.navIcons;
            arrows.checked = !!s.navArrows;
            iconRow.classList.toggle('is-disabled', side);
            iconSub.textContent = side ? 'Always on when the tabs are on a side' : 'Show the main tabs as icons at the top or bottom';
            Object.keys(sub.opts).forEach(k => sub.opts[k].classList.toggle('on', k === (s.navPos === 'bottom' ? 'bottom' : side ? s.subTabPos : 'top')));
            sub.row.classList.toggle('is-disabled', !side);
            sub.sub.textContent = side ? 'Where Caption and Tracker show their sub tabs' : 'Follows the main tabs (' + (s.navPos === 'bottom' ? 'directly above them' : 'below them') + ')';
        }
        sync();
    }

    // ------------------------------------------------------------------ settings: dependencies
    function dependenciesSection(inner, p) {
        inner.appendChild(el('div', 'rfxdep-text', 'Most tabs work right away. Caption, Download and Assets need programs that are too large to ship with the panel. They come from their official sources, are checked against the published checksum or exact size, and are kept in each tab\'s own folder. Downloads continue in the background while you work.'));
        if (D()) {
            const where = el('div', 'rfxdep-path', D().ui.ltr(D().defaultRoot() + '\\<tab>'));
            where.style.margin = '-4px 2px 14px';
            inner.appendChild(where);
        }
        const list = el('div');
        inner.appendChild(list);
        const all = btn('Download all', 'is-primary', () => { downloadAll(); ov.refresh(); });
        all.style.marginTop = '12px';
        inner.appendChild(all);
        const ov = depsOverview(list, p, {
            onChange: () => {
                all.style.display = anyMissing() ? '' : 'none';
                all.disabled = anyRunning();
                all.textContent = anyRunning() ? 'Downloading...' : 'Download all';
            }
        });
    }

    // ------------------------------------------------------------------ settings: about
    function aboutSection(inner) {
        const g = el('div', 'rfx-group');
        const row = (title, sub, end) => {
            const r = el('div', 'rfx-row');
            const txt = el('div', 'rfx-row-text');
            txt.appendChild(el('div', 'rfx-row-title', title));
            if (sub) txt.appendChild(el('div', 'rfx-row-sub', sub));
            r.appendChild(txt);
            if (end) { const e = el('div', 'rfx-row-end'); e.appendChild(end); r.appendChild(e); }
            g.appendChild(r);
        };
        const ver = (window.APP && window.APP.version) ? 'Version ' + window.APP.version : null;
        row(appName(), ver || 'Toolkit panel for After Effects');
        row('Welcome screen', 'The introduction and first downloads', btn('Show again', '', () => openWelcome()));
        if (D()) row('Dependencies folder', D().defaultRoot(), btn('Open', '', () => D().openFolder(D().defaultRoot())));
        row('Appearance', 'Back to the Monochrome theme and default sizes', btn('Reset', '', () => { if (T()) T().reset(); }));
        inner.appendChild(g);
    }

    // ------------------------------------------------------------------ settings page
    const SECTIONS = [
        { id: 'appearance', label: 'Appearance', render: appearanceSection },
        { id: 'nav', label: 'Navigation', render: navigationSection },
        { id: 'deps', label: 'Dependencies', render: dependenciesSection },
        { id: 'about', label: 'About', render: aboutSection }
    ];
    function openSettings(section) {
        const p = page('Settings', { nav: true });
        p.foot.style.display = 'none';
        const navBtns = {};
        const show = id => {
            p.inner.innerHTML = '';
            p.body.scrollTop = 0;
            Object.keys(navBtns).forEach(k => navBtns[k].classList.toggle('on', k === id));
            const s = SECTIONS.find(x => x.id === id) || SECTIONS[0];
            s.render(p.inner, p);
        };
        SECTIONS.forEach(s => {
            const b = el('button', 'rfx-page-navbtn', s.label);
            b.onclick = () => show(s.id);
            p.nav.appendChild(b);
            navBtns[s.id] = b;
        });
        show(section || 'appearance');
        return p;
    }

    // ------------------------------------------------------------------ welcome
    function openWelcome() {
        const p = page('Welcome', { onClose: markSeen });
        const steps = el('div', 'rfx-steps');
        steps.innerHTML = '<i></i><i></i>';
        const setStep = n => [].forEach.call(steps.children, (d, i) => d.classList.toggle('on', i === n));

        function stepIntro() {
            p.setTitle('Welcome');
            p.inner.innerHTML = '';
            const w = el('div', 'rfx-welcome');
            w.appendChild(el('div', 'rfx-welcome-mark', appName().slice(0, 3).toUpperCase()));
            w.appendChild(el('h1', null, 'Welcome to ' + appName()));
            w.appendChild(el('p', null, 'A toolkit panel for After Effects. Every tool sits in its own tab; drag tabs to reorder them.'));
            const list = el('div', 'rfx-welcome-list');
            TOUR.forEach(x => { const d = el('div'); d.appendChild(el('b', null, x[0])); d.appendChild(document.createTextNode(x[1])); list.appendChild(d); });
            w.appendChild(list);
            p.inner.appendChild(w);
            p.foot.innerHTML = '';
            setStep(0);
            p.foot.appendChild(steps);
            p.foot.appendChild(el('div', 'rfx-grow'));
            p.foot.appendChild(btn('Skip', 'is-ghost', () => p.close()));
            p.foot.appendChild(btn('Next', 'is-primary', stepDeps));
        }

        function stepDeps() {
            p.setTitle('Downloads');
            p.inner.innerHTML = '';
            p.body.scrollTop = 0;
            p.inner.appendChild(el('div', 'rfxdep-text', 'Caption, Download and Assets need extra programs that are too large to ship with the panel. Get them now or later from Settings. They download in the background from their official sources.'));
            const list = el('div');
            p.inner.appendChild(list);
            p.foot.innerHTML = '';
            setStep(1);
            p.foot.appendChild(steps);
            p.foot.appendChild(el('div', 'rfx-grow'));
            const later = btn('Later', 'is-ghost', () => p.close());
            const all = btn('Download all', 'is-primary', () => { downloadAll(); ov.refresh(); });
            p.foot.appendChild(later);
            p.foot.appendChild(all);
            const ov = depsOverview(list, p, {
                tabSettings: false,
                onChange: () => {
                    const missing = anyMissing(), running = anyRunning();
                    all.style.display = missing ? '' : 'none';
                    all.disabled = running;
                    all.textContent = running ? 'Downloading...' : 'Download all';
                    later.textContent = missing || running ? 'Later' : 'Done';
                    later.className = 'rfx-btn ' + (missing || running ? 'is-ghost' : 'is-primary');
                }
            });
        }
        stepIntro();
        return p;
    }

    window.rfxOpenWelcome = openWelcome;
    window.rfxOpenSettings = openSettings;
    window.rfxOpenDependencies = () => openSettings('deps');

    // ------------------------------------------------------------------ tab-bar button
    function updateButton() {
        const b = document.getElementById('rfx-deps-btn');
        if (!b || !D()) return;
        let received = 0, total = 0, running = 0, paused = 0;
        TABS.forEach(t => {
            visibleDeps(t.tab).forEach(d => {
                const j = D().job(t.tab, d.id);
                if (j && !j.finished) { running++; if (j.stage === 'paused') paused++; received += j.received || 0; total += j.total || 0; }
            });
        });
        const badge = b.querySelector('.rfx-deps-badge');
        b.classList.toggle('is-busy', running > 0);
        if (running) {
            badge.textContent = total ? Math.floor(received / total * 100) + '%' : '...';
            b.setAttribute('data-tooltip', paused === running
                ? 'Settings - ' + paused + ' download' + (paused > 1 ? 's are' : ' is') + ' paused'
                : 'Settings - downloading ' + (running - paused) + ' item' + (running - paused > 1 ? 's' : '') + (paused ? ' (' + paused + ' paused)' : ''));
        } else {
            badge.textContent = '';
            b.setAttribute('data-tooltip', 'Settings');
        }
    }

    function init() {
        const b = document.getElementById('rfx-deps-btn');
        if (b) b.addEventListener('click', () => openSettings(anyRunning() ? 'deps' : null));
        if (D()) {
            let t = null;
            D().on(() => { if (!t) t = setTimeout(() => { t = null; updateButton(); }, 300); });
        }
        // Tabs register their dependencies on DOMContentLoaded; look after that.
        setTimeout(() => {
            updateButton();
            let seen = null;
            try { seen = localStorage.getItem(SEEN_KEY); } catch (e) {}
            if (!seen) openWelcome();
        }, 800);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
