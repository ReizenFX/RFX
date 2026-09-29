/* ============================================================================
   RFX THEME (runs in <head>, before first paint)
   Reads the saved appearance from localStorage and applies it to <html>:
     rfxTheme        'mono' (default) | 'color'
     rfxAccent       '#rrggbb' or '' (theme default)
     rfxDensity      'compact' | 'standard' (default) | 'comfortable'
     rfxRadius       'sharp' | 'standard' (default) | 'round'
     rfxReduceMotion '1' when on
   Colours themselves live in css/theme.css; this file only switches them and
   derives the accent helpers (hover, soft fill, readable text on the accent).
   window.RFXTheme is the API used by the Settings page and by canvas drawing.
   ========================================================================== */
(function () {
    var root = document.documentElement;
    var KEYS = { theme: 'rfxTheme', accent: 'rfxAccent', density: 'rfxDensity', radius: 'rfxRadius', reduceMotion: 'rfxReduceMotion' };

    var THEMES = [
        { id: 'mono', label: 'Monochrome', hint: 'Black, white and greys', accentDefault: '#e8e8e8' },
        { id: 'color', label: 'Color', hint: 'Graphite with soft colour', accentDefault: '#7d9cc7' }
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
    var DEFAULTS = { theme: 'mono', accent: '', density: 'standard', radius: 'standard', reduceMotion: false };

    function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function write(k, v) { try { if (v === null || v === '' || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
    function oneOf(list, v, d) { for (var i = 0; i < list.length; i++) if (list[i].id === v) return v; return d; }

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
    /* Dark or light text, whichever reads better on the accent. */
    function contrastText(hex) { return contrast(hex, '#111111') >= contrast(hex, '#ffffff') ? '#111111' : '#ffffff'; }
    function mix(hex, withHex, t) { var a = rgb(hex), b = rgb(withHex); return toHex([0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; })); }

    function get() {
        return {
            theme: oneOf(THEMES, read(KEYS.theme), DEFAULTS.theme),
            accent: normalizeHex(read(KEYS.accent)),
            density: oneOf(DENSITIES, read(KEYS.density), DEFAULTS.density),
            radius: oneOf(RADII, read(KEYS.radius), DEFAULTS.radius),
            reduceMotion: read(KEYS.reduceMotion) === '1'
        };
    }

    function apply(s) {
        root.setAttribute('data-rfx-theme', s.theme);
        if (s.density === 'standard') root.removeAttribute('data-rfx-density'); else root.setAttribute('data-rfx-density', s.density);
        if (s.radius === 'standard') root.removeAttribute('data-rfx-radius'); else root.setAttribute('data-rfx-radius', s.radius);
        if (s.reduceMotion) root.setAttribute('data-rfx-motion', 'reduce'); else root.removeAttribute('data-rfx-motion');
        var st = root.style;
        if (s.accent) {
            var c = rgb(s.accent), light = luminance(s.accent) > 0.45;
            st.setProperty('--rfx-accent', s.accent);
            st.setProperty('--rfx-accent-hover', light ? mix(s.accent, '#ffffff', 0.35) : mix(s.accent, '#ffffff', 0.14));
            st.setProperty('--rfx-accent-soft', 'rgba(' + c.join(', ') + ', 0.16)');
            st.setProperty('--rfx-on-accent', contrastText(s.accent));
        } else {
            ['--rfx-accent', '--rfx-accent-hover', '--rfx-accent-soft', '--rfx-on-accent'].forEach(function (p) { st.removeProperty(p); });
        }
    }

    var listeners = [];
    function set(partial) {
        var s = get();
        for (var k in partial) if (Object.prototype.hasOwnProperty.call(partial, k) && k in DEFAULTS) s[k] = partial[k];
        s.theme = oneOf(THEMES, s.theme, DEFAULTS.theme);
        s.accent = normalizeHex(s.accent);
        s.density = oneOf(DENSITIES, s.density, DEFAULTS.density);
        s.radius = oneOf(RADII, s.radius, DEFAULTS.radius);
        write(KEYS.theme, s.theme === DEFAULTS.theme ? '' : s.theme);
        write(KEYS.accent, s.accent);
        write(KEYS.density, s.density === DEFAULTS.density ? '' : s.density);
        write(KEYS.radius, s.radius === DEFAULTS.radius ? '' : s.radius);
        write(KEYS.reduceMotion, s.reduceMotion ? '1' : '');
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

    window.RFXTheme = {
        THEMES: THEMES, ACCENTS: ACCENTS, DENSITIES: DENSITIES, RADII: RADII, DEFAULTS: DEFAULTS,
        get: get,
        set: set,
        reset: function () { return set({ theme: DEFAULTS.theme, accent: '', density: DEFAULTS.density, radius: DEFAULTS.radius, reduceMotion: false }); },
        onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
        cssVar: cssVar,
        accent: function () { return cssVar('--rfx-accent'); },
        contrastText: contrastText,
        contrast: contrast,
        normalizeHex: normalizeHex
    };

    apply(get());
})();
