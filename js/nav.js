/* ============================================================================
   RFX NAVIGATION: hover names + sub-tab flyouts for icon-only main tabs
   (not a tab). The navigation itself is the one tab bar in index.html; its
   position and icon mode come from js/theme.js (data-rfx-nav / data-rfx-navicons
   on <html>) and css/global.css. When the main tabs show icons only, hovering a
   tab shows its name in a floating panel, and for tabs with sub-tabs (Caption,
   Tracker) the same panel lists them. The panel floats above the content
   (position: fixed), so nothing underneath moves, and it slides in from the
   bar's side: right of a left bar, left of a right bar, below a top bar, above
   a bottom bar. Timing and easing are the shared --rfx-dur tokens.
   ========================================================================== */
(function () {
    'use strict';

    // main tab -> its sub-tab buttons (order and state are read from the page each time)
    const SUBS = {
        'tab-caption': '#caption-tabs-header .tab-btn',
        'tab-tracker': '#tracker-tabs-header .tracker-tab-btn'
    };
    const DIR = { left: 'right', right: 'left', top: 'down', bottom: 'up' };
    // sub-tab bars whose buttons turn icon-only with data-rfx-subicons
    const SUB_BARS = ['caption-tabs-header', 'tracker-tabs-header', 'timer-mode-header', 'graph-type-header'];
    const GAP = 8, EDGE = 6, SHOW_DELAY = 50, HIDE_DELAY = 140;

    const html = document.documentElement;
    const iconMode = () => html.hasAttribute('data-rfx-navicons');
    const navPos = () => html.getAttribute('data-rfx-nav') || 'top';
    const subIconMode = () => html.hasAttribute('data-rfx-subicons');
    const subsAtBottom = () => html.getAttribute('data-rfx-subpos') === 'bottom';
    const isSubBtn = btn => !!btn && SUB_BARS.indexOf(btn.parentElement && btn.parentElement.id) !== -1;
    // a sub bar that always sits at the top of its tab (data-fly="down") drops its names below
    const nameUp = btn => subsAtBottom() && btn.parentElement.getAttribute('data-fly') !== 'down';

    let header = null, fly = null, current = null, showT = null, hideT = null;

    function subButtons(tabId) {
        const sel = SUBS[tabId];
        return sel ? Array.prototype.filter.call(document.querySelectorAll(sel), b => b.style.display !== 'none') : [];
    }
    /* a sub-tab is current when its content is the open one (the global switchTab
       clears .active on every .tab-btn, so the button class alone is not reliable) */
    function subIsActive(b) {
        const content = document.getElementById(b.id.replace(/^btn-/, ''));
        return content ? content.classList.contains('active') : b.classList.contains('active');
    }
    function tabName(btn) {
        const l = btn.querySelector('.tab-lbl');
        return (l ? l.textContent : btn.textContent).trim();
    }

    function render(btn) {
        const tabId = btn.id.replace(/^btn-/, '');
        const subs = isSubBtn(btn) ? [] : subButtons(tabId);
        fly.innerHTML = '';
        fly.classList.toggle('has-subs', subs.length > 0);
        // a tab without sub-tabs shows its name; with sub-tabs the list itself is enough
        if (!subs.length) {
            const title = document.createElement('div');
            title.className = 'rfx-fly-title';
            title.textContent = tabName(btn);
            fly.appendChild(title);
        }
        subs.forEach(b => {
            const item = document.createElement('div');
            item.className = 'rfx-fly-item' + (subIsActive(b) ? ' active' : '');
            item.textContent = b.textContent.trim();
            item.addEventListener('click', ev => {
                ev.stopPropagation();
                window.switchTab(tabId);
                b.click();                       // the sub-tab's own handler (switchCaptionTab / switchTrackerTab)
                render(btn);
                place(btn);
            });
            fly.appendChild(item);
        });
    }

    function place(btn) {
        const r = btn.getBoundingClientRect();
        const w = fly.offsetWidth, h = fly.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        const p = navPos(), subs = fly.classList.contains('has-subs');
        let x, y;
        if (isSubBtn(btn)) {
            // a sub tab's name: centred above a bottom sub bar, below a top one
            x = r.left + r.width / 2 - w / 2;
            y = nameUp(btn) ? r.top - GAP - h : r.bottom + GAP;
        } else if (p === 'left' || p === 'right') {
            x = p === 'left' ? r.right + GAP : r.left - GAP - w;
            y = subs ? r.top - 5 : r.top + r.height / 2 - h / 2;
        } else {
            x = subs ? r.left - 4 : r.left + r.width / 2 - w / 2;
            y = p === 'bottom' ? r.top - GAP - h : r.bottom + GAP;
        }
        x = Math.max(EDGE, Math.min(vw - w - EDGE, x));
        y = Math.max(EDGE, Math.min(vh - h - EDGE, y));
        fly.style.left = Math.round(x) + 'px';
        fly.style.top = Math.round(y) + 'px';
    }

    function show(btn) {
        clearTimeout(hideT);
        const wasOpen = fly.classList.contains('open');
        current = btn;
        fly.setAttribute('data-dir', isSubBtn(btn) ? (nameUp(btn) ? 'up' : 'down') : (DIR[navPos()] || 'down'));
        render(btn);
        place(btn);
        if (!wasOpen) {
            void fly.offsetWidth;              // start from the closed state so the slide runs
            fly.classList.add('open');
        }
    }
    function hide() {
        clearTimeout(showT);
        clearTimeout(hideT);
        current = null;
        if (fly) fly.classList.remove('open');
    }
    function scheduleHide() {
        clearTimeout(showT);
        clearTimeout(hideT);
        hideT = setTimeout(hide, HIDE_DELAY);
    }

    function init() {
        header = document.querySelector('.rfx-app-header .tabs-header');
        if (!header) return;
        fly = document.createElement('div');
        fly.id = 'rfx-nav-flyout';
        fly.setAttribute('role', 'menu');
        document.body.appendChild(fly);

        header.addEventListener('mouseover', e => {
            if (!iconMode() || window.isDraggingTab) return;
            const btn = e.target.closest('.tab-btn');
            if (!btn || !header.contains(btn)) return;
            clearTimeout(hideT);
            if (btn === current && fly.classList.contains('open')) return;
            clearTimeout(showT);
            // moving along the bar re-targets instantly; the first hover waits a moment
            showT = setTimeout(() => show(btn), fly.classList.contains('open') ? 0 : SHOW_DELAY);
        });
        header.addEventListener('mouseleave', scheduleHide);
        fly.addEventListener('mouseenter', () => clearTimeout(hideT));
        fly.addEventListener('mouseleave', scheduleHide);
        header.addEventListener('pointermove', () => { if (window.isDraggingTab) hide(); });   // dragging a tab
        // the bar scrolls (wheel, or a clicked tab scrolled into view): the panel follows its tab
        header.addEventListener('scroll', () => { if (current && fly.classList.contains('open')) place(current); }, { passive: true });
        // icon-only sub tabs: their name on hover (not while a button is held, e.g. dragging)
        SUB_BARS.forEach(id => {
            const bar = document.getElementById(id);
            if (!bar) return;
            bar.addEventListener('mouseover', e => {
                if (!subIconMode() || e.buttons) return;
                const btn = e.target.closest('button');
                if (!btn || btn.parentElement !== bar) return;
                clearTimeout(hideT);
                if (btn === current && fly.classList.contains('open')) return;
                clearTimeout(showT);
                showT = setTimeout(() => show(btn), fly.classList.contains('open') ? 0 : SHOW_DELAY);
            });
            bar.addEventListener('mouseleave', scheduleHide);
            bar.addEventListener('pointerdown', hide);
            bar.addEventListener('scroll', () => { if (current && fly.classList.contains('open')) place(current); }, { passive: true });
        });
        window.addEventListener('blur', hide);
        window.addEventListener('resize', hide);
        window.addEventListener('rfx-theme-change', hide);
        window.addEventListener('tabSwitched', () => { if (current && fly.classList.contains('open')) { render(current); place(current); } });
    }

    window.RFXNav = { hide: hide };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
