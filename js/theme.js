/* ============================================================================
   RFX THEME + LAYOUT (runs in <head>, before first paint)
   Reads the saved appearance from localStorage and applies it to <html>:
     rfxTheme            'mono' (default) | 'color'
     rfxAccent           '#rrggbb' or '' (theme default)
     rfxDensity          'compact' | 'standard' (default) | 'comfortable'
     rfxRadius           'sharp' | 'standard' (default) | 'round'
     rfxReduceMotion     '1' when on
     rfxUiBrightness     -100..100 (0)    page and surface lightness; text follows
     rfxSurfaceContrast  40..250  (100)  separation of page, cards, inputs, buttons
     rfxTextColor        '#rrggbb' or '' (theme default)  base UI text colour
     rfxTextContrast     40..160  (100)  separation of primary / secondary / muted text
     rfxDarkText         '' theme default | '1' | '0'  dark text + icons on light accent buttons
     rfxDarkKnob         '' | '1' | '0'  dark knob on switches that are on (light accent)
     rfxDarkMarks        '' | '1' | '0'  dark ticks / dots / day-circle icons on the accent
     rfxNavPos           'left' (default) | 'top' | 'bottom' | 'right'
     rfxNavIcons         '1' when main tabs are icon-only at top/bottom (sides always are)
     rfxSubTabPos        'bottom' (default) | 'top'  sub-tab bars when the nav is on a side
   The surface and text ramps are generated here from those numbers and written
   as --rfx-* variables on <html>; css/theme.css keeps the defaults and every
   other token. Layout is exposed as attributes that css/global.css reads:
     data-rfx-nav, data-rfx-navicons, data-rfx-subpos.
   window.RFXTheme is the API used by the Settings page, js/nav.js and canvas drawing.
   ========================================================================== */
(function () {
    var root = document.documentElement;
    var KEYS = {
        theme: 'rfxTheme', accent: 'rfxAccent', density: 'rfxDensity', radius: 'rfxRadius', reduceMotion: 'rfxReduceMotion',
        brightness: 'rfxUiBrightness', surfaceContrast: 'rfxSurfaceContrast', textColor: 'rfxTextColor', textContrast: 'rfxTextContrast',
        darkText: 'rfxDarkText', darkKnob: 'rfxDarkKnob', darkMarks: 'rfxDarkMarks', navPos: 'rfxNavPos', navIcons: 'rfxNavIcons', subTabPos: 'rfxSubTabPos'
    };

    /* tint: how much each RGB channel of a surface differs from neutral grey, as a
       fraction of its lightness (Color = cool graphite). */
    var THEMES = [
        { id: 'mono', label: 'Monochrome', hint: 'Black, white and greys', accentDefault: '#e8e8e8', textDefault: '#ffffff', tint: [0, 0, 0],
          dark: { text: true, knob: true, marks: true } },
        { id: 'color', label: 'Color', hint: 'Graphite with soft colour', accentDefault: '#7d9cc7', textDefault: '#ffffff', tint: [-0.10, 0, 0.18],
          dark: { text: false, knob: true, marks: false } }
    ];
    /* accent presets per theme: greys for Monochrome, soft colours for Color */
    var MONO_ACCENTS = [
        { id: 'snow', label: 'Snow', hex: '#e8e8e8' },
        { id: 'white', label: 'White', hex: '#ffffff' },
        { id: 'pearl', label: 'Pearl', hex: '#d2d2d2' },
        { id: 'silver', label: 'Silver', hex: '#b4b4b4' },
        { id: 'stone', label: 'Stone', hex: '#8f8f8f' },
        { id: 'graphite', label: 'Graphite', hex: '#6c6c6c' }
    ];
    var ACCENTS = [
        { id: 'snow', label: 'Snow', hex: '#e8e8e8' },
        { id: 'silver', label: 'Silver', hex: '#a8b3c2' },
        { id: 'steel', label: 'Steel', hex: '#7d9cc7' },
        { id: 'sky', label: 'Sky', hex: '#5ba4ff' },
        { id: 'sage', label: 'Sage', hex: '#8fb39a' },
        { id: 'sand', label: 'Sand', hex: '#c8b089' },
        { id: 'rose', label: 'Rose', hex: '#c98f9f' },
        { id: 'lilac', label: 'Lilac', hex: '#a79bd0' }
    ];
    var DENSITIES = [{ id: 'compact', label: 'Compact' }, { id: 'standard', label: 'Standard' }, { id: 'comfortable', label: 'Comfortable' }];
    var RADII = [{ id: 'sharp', label: 'Sharp' }, { id: 'standard', label: 'Standard' }, { id: 'round', label: 'Round' }];
    var NAV_POSITIONS = [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }, { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }];
    var SUB_POSITIONS = [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }];
    var RANGES = { brightness: [-100, 100], surfaceContrast: [40, 250], textContrast: [40, 160] };
    var DEFAULTS = {
        theme: 'mono', accent: '', density: 'comfortable', radius: 'round', reduceMotion: false,
        brightness: 0, surfaceContrast: 100, textColor: '', textContrast: 100, darkText: '', darkKnob: '', darkMarks: '',
        navPos: 'left', navIcons: false, subTabPos: 'bottom'
    };

    function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function write(k, v) { try { if (v === null || v === '' || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
    function oneOf(list, v, d) { for (var i = 0; i < list.length; i++) if (list[i].id === v) return v; return d; }
    function num(v, key) {
        var n = parseFloat(v), r = RANGES[key];
        if (isNaN(n)) return DEFAULTS[key];
        return Math.max(r[0], Math.min(r[1], Math.round(n)));
    }

    function tri(v) { return v === '1' || v === true ? '1' : v === '0' || v === false ? '0' : ''; }
    function normalizeHex(v) {
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v || '').trim());
        if (!m) return '';
        var h = m[1].toLowerCase();
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return '#' + h;
    }
    function rgb(hex) { var h = normalizeHex(hex).slice(1); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    function toHex(c) { return '#' + c.map(function (x) { x = Math.max(0, Math.min(255, Math.round(x))); return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
    function luminance(hex) {
        var c = rgb(hex).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrast(a, b) { var la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
    /* Dark or light text, whichever reads better on the accent. black: allow pure #000. */
    function contrastText(hex, black) {
        var dark = black ? '#000000' : '#111111';
        return contrast(hex, dark) >= contrast(hex, '#ffffff') ? dark : '#ffffff';
    }
    /* Is the accent light enough for dark content on it? */
    function isLight(hex) { return contrast(hex, '#000000') >= contrast(hex, '#ffffff'); }
    /* Resolved dark-on-accent choices: explicit setting, else the theme default. */
    function darkOn(s) {
        var th = THEMES.filter(function (t) { return t.id === s.theme; })[0] || THEMES[0];
        var r = function (v, d) { return v === '1' ? true : v === '0' ? false : d; };
        return { text: r(s.darkText, th.dark.text), knob: r(s.darkKnob, th.dark.knob), marks: r(s.darkMarks, th.dark.marks) };
    }
    function mix(hex, withHex, t) { var a = rgb(hex), b = rgb(withHex); return toHex([0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; })); }

    function get() {
        return {
            theme: oneOf(THEMES, read(KEYS.theme), DEFAULTS.theme),
            accent: normalizeHex(read(KEYS.accent)),
            density: oneOf(DENSITIES, read(KEYS.density), DEFAULTS.density),
            radius: oneOf(RADII, read(KEYS.radius), DEFAULTS.radius),
            reduceMotion: read(KEYS.reduceMotion) === '1',
            brightness: num(read(KEYS.brightness), 'brightness'),
            surfaceContrast: num(read(KEYS.surfaceContrast), 'surfaceContrast'),
            textColor: normalizeHex(read(KEYS.textColor)),
            textContrast: num(read(KEYS.textContrast), 'textContrast'),
            darkText: tri(read(KEYS.darkText)),
            darkKnob: tri(read(KEYS.darkKnob)),
            darkMarks: tri(read(KEYS.darkMarks)),
            navPos: oneOf(NAV_POSITIONS, read(KEYS.navPos), DEFAULTS.navPos),
            navIcons: read(KEYS.navIcons) === '1',
            subTabPos: oneOf(SUB_POSITIONS, read(KEYS.subTabPos), DEFAULTS.subTabPos)
        };
    }

    /* The surface and text ramps. At the defaults they reproduce css/theme.css with
       a little more separation between the page, cards and controls. */
    function palette(s) {
        var th = THEMES.filter(function (t) { return t.id === s.theme; })[0] || THEMES[0];
        var b = s.brightness / 100, c = s.surfaceContrast / 100, k = s.textContrast / 100;
        var base = 22 + (b > 0 ? b * 30 : b * 12);                 // page lightness, 10..52 (0-255)
        var surf = function (steps) {
            var L = Math.max(0, base + steps * c);
            return toHex([0, 1, 2].map(function (i) { return L * (1 + th.tint[i]); }));
        };
        var bg = surf(0);
        var v = {
            '--rfx-bg': bg,
            '--rfx-input': surf(-6),
            '--rfx-surface-1': surf(8),
            '--rfx-surface-2': surf(18),
            '--rfx-surface-3': surf(28),
            '--rfx-menu': surf(12),
            '--rfx-dialog': surf(8),
            '--rfx-line': surf(20),
            '--rfx-line-2': surf(32),
            '--rfx-scrollbar': surf(44),
            '--rfx-scrollbar-hover': surf(62)
        };
        var a = Math.pow(c, 0.6);
        v['--rfx-fill-hover'] = 'rgba(255, 255, 255, ' + (0.06 * a).toFixed(3) + ')';
        v['--rfx-fill-active'] = 'rgba(255, 255, 255, ' + (0.10 * a).toFixed(3) + ')';
        v['--rfx-fill-selected'] = 'rgba(255, 255, 255, ' + (0.14 * a).toFixed(3) + ')';
        v['--rfx-fill-track'] = 'rgba(255, 255, 255, ' + (0.10 * a).toFixed(3) + ')';

        // text: the chosen colour, lifted or dimmed with the UI brightness, then stepped toward the page
        var t1 = s.textColor || th.textDefault;
        t1 = b > 0 ? mix(t1, '#ffffff', b * 0.35) : mix(t1, bg, -b * 0.18);
        v['--rfx-text-1'] = t1;
        v['--rfx-text-2'] = mix(t1, bg, Math.min(0.85, 0.36 * k));
        v['--rfx-text-3'] = mix(t1, bg, Math.min(0.88, 0.50 * k));
        v['--rfx-text-4'] = mix(t1, bg, Math.min(0.92, 0.72 * Math.max(k, 0.8)));

        // accent (user colour or theme default) and readable text on it
        var ac = s.accent || th.accentDefault, rc = rgb(ac), light = luminance(ac) > 0.45;
        v['--rfx-accent'] = ac;
        v['--rfx-accent-hover'] = light ? mix(ac, '#ffffff', 0.35) : mix(ac, '#ffffff', 0.14);
        v['--rfx-accent-soft'] = 'rgba(' + rc.join(', ') + ', 0.16)';
        // text, icons, knobs and marks on the accent: white by default, pure black when
        // chosen and the accent is light enough to carry it
        var dk = darkOn(s), lightAc = isLight(ac);
        v['--rfx-on-accent'] = dk.text && lightAc ? '#000000' : '#ffffff';
        v['--rfx-on-accent-knob'] = dk.knob && lightAc ? '#000000' : '#ffffff';
        v['--rfx-on-accent-mark'] = dk.marks && lightAc ? '#000000' : '#ffffff';
        return v;
    }

    function apply(s) {
        root.setAttribute('data-rfx-theme', s.theme);
        if (s.density === 'standard') root.removeAttribute('data-rfx-density'); else root.setAttribute('data-rfx-density', s.density);
        if (s.radius === 'standard') root.removeAttribute('data-rfx-radius'); else root.setAttribute('data-rfx-radius', s.radius);
        if (s.reduceMotion) root.setAttribute('data-rfx-motion', 'reduce'); else root.removeAttribute('data-rfx-motion');
        var v = palette(s), st = root.style;
        for (var p in v) st.setProperty(p, v[p]);
        applyLayout(s);
    }

    /* One navigation, four positions: only attributes change; the markup, order and
       behaviour stay the same (css/global.css + js/nav.js read these). */
    function applyLayout(s) {
        var side = s.navPos === 'left' || s.navPos === 'right';
        root.setAttribute('data-rfx-nav', s.navPos);
        if (side || s.navIcons) root.setAttribute('data-rfx-navicons', '1'); else root.removeAttribute('data-rfx-navicons');
        root.setAttribute('data-rfx-subpos', s.navPos === 'bottom' ? 'bottom' : side ? s.subTabPos : 'top');
    }

    var listeners = [];
    function set(partial) {
        var s = get();
        for (var k in partial) if (Object.prototype.hasOwnProperty.call(partial, k) && k in DEFAULTS) s[k] = partial[k];
        s.theme = oneOf(THEMES, s.theme, DEFAULTS.theme);
        s.accent = normalizeHex(s.accent);
        s.density = oneOf(DENSITIES, s.density, DEFAULTS.density);
        s.radius = oneOf(RADII, s.radius, DEFAULTS.radius);
        s.brightness = num(s.brightness, 'brightness');
        s.surfaceContrast = num(s.surfaceContrast, 'surfaceContrast');
        s.textColor = normalizeHex(s.textColor);
        s.textContrast = num(s.textContrast, 'textContrast');
        s.navPos = oneOf(NAV_POSITIONS, s.navPos, DEFAULTS.navPos);
        s.subTabPos = oneOf(SUB_POSITIONS, s.subTabPos, DEFAULTS.subTabPos);
        var store = function (key, val, def) { write(KEYS[key], val === def ? '' : String(val)); };
        store('theme', s.theme, DEFAULTS.theme);
        write(KEYS.accent, s.accent);
        store('density', s.density, DEFAULTS.density);
        store('radius', s.radius, DEFAULTS.radius);
        write(KEYS.reduceMotion, s.reduceMotion ? '1' : '');
        store('brightness', s.brightness, DEFAULTS.brightness);
        store('surfaceContrast', s.surfaceContrast, DEFAULTS.surfaceContrast);
        write(KEYS.textColor, s.textColor);
        store('textContrast', s.textContrast, DEFAULTS.textContrast);
        write(KEYS.darkText, tri(s.darkText));
        write(KEYS.darkKnob, tri(s.darkKnob));
        write(KEYS.darkMarks, tri(s.darkMarks));
        store('navPos', s.navPos, DEFAULTS.navPos);
        write(KEYS.navIcons, s.navIcons ? '1' : '');
        store('subTabPos', s.subTabPos, DEFAULTS.subTabPos);
        apply(s);
        listeners.slice().forEach(function (fn) { try { fn(s); } catch (e) {} });
        try { window.dispatchEvent(new CustomEvent('rfx-theme-change', { detail: s })); } catch (e) {}
        return s;
    }

    /* Current value of a theme variable, for canvas / SVG drawing. */
    function cssVar(name, fallback) {
        var v = '';
        try { v = getComputedStyle(root).getPropertyValue(name).trim(); } catch (e) {}
        return v || fallback || '';
    }

    var APPEARANCE_KEYS = ['theme', 'accent', 'density', 'radius', 'reduceMotion', 'brightness', 'surfaceContrast', 'textColor', 'textContrast', 'darkText', 'darkKnob', 'darkMarks'];
    window.RFXTheme = {
        THEMES: THEMES, ACCENTS: ACCENTS, MONO_ACCENTS: MONO_ACCENTS,
        accentsFor: function (theme) { return theme === 'mono' ? MONO_ACCENTS : ACCENTS; },
        darkOn: function () { return darkOn(get()); },
        isLight: isLight, DENSITIES: DENSITIES, RADII: RADII, DEFAULTS: DEFAULTS,
        NAV_POSITIONS: NAV_POSITIONS, SUB_POSITIONS: SUB_POSITIONS, RANGES: RANGES,
        get: get,
        set: set,
        /* Appearance only; the navigation layout has its own reset. */
        reset: function () { var d = {}; APPEARANCE_KEYS.forEach(function (k) { d[k] = DEFAULTS[k]; }); return set(d); },
        resetLayout: function () { return set({ navPos: DEFAULTS.navPos, navIcons: false, subTabPos: DEFAULTS.subTabPos }); },
        onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
        cssVar: cssVar,
        accent: function () { return cssVar('--rfx-accent'); },
        contrastText: contrastText,
        contrast: contrast,
        normalizeHex: normalizeHex,
        palette: palette
    };

    apply(get());
})();
