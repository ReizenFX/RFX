/* GRAPH TAB: curve types (Bezier / Elastic / Bounce / Steps)
   The type row at the top of the Graph tab picks what the graph edits. Bezier is the
   classic two-handle ease in js/tab-graph.js. The other types are drawn and edited here,
   each with two handles and no number fields:
     Elastic  peak handle   = time and height of the first overshoot
              dip handle    = the next swing back (sets the frequency and how fast it settles)
     Bounce   impact handle = when it first hits the target (slides along the target line)
              rebound handle= width and height of the first rebound; later bounces shrink
                              in proportion until they settle before the end
     Steps    step handle   = number of steps (drag sideways)
              smooth handle = how soft each step is (0 = hold keys, full = S-ramps)
   Every type is built as a short list of keyframes ("knots": time, value, speeds,
   influences, hold) in the 0..1 space. The graph draws exactly what After Effects will
   interpolate between those keys, and Apply bakes them between each pair of selected
   keyframes (jsx/graph.jsx graphApplyCurveKnots): ordinary keys that stay editable in
   the AE graph editor, only as many as the shape needs. Re-applying replaces the keys
   it added before. The mirror button plays the effect at the start instead of the end.
   State: rfxGraphCurve = { mode, rev, elastic: {...}, bounce: {...}, steps: {...} }. */
(function () {
    'use strict';
    const KEY = 'rfxGraphCurve', BAR_KEY = 'rfxGraphTypeBarCollapsed', ORDER_KEY = 'rfxGraphTypeOrder';
    const DEF = {
        mode: 'bezier', rev: false,
        elastic: { tp: 0.22, a: 0.32, half: 0.16, r: 0.42 },
        bounce: { t1: 0.42, q: 0.5, h: 0.32 },
        steps: { n: 5, s: 0 }
    };
    const NAMES = { bezier: 'Bezier', elastic: 'Elastic', bounce: 'Bounce', steps: 'Steps' };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    let st = load();
    function load() {
        const s = JSON.parse(JSON.stringify(DEF));
        try {
            const o = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (o && typeof o === 'object') {
                if (NAMES[o.mode]) s.mode = o.mode;
                s.rev = !!o.rev;
                ['elastic', 'bounce', 'steps'].forEach(k => { if (o[k]) Object.keys(s[k]).forEach(p => { if (typeof o[k][p] === 'number' && isFinite(o[k][p])) s[k][p] = o[k][p]; }); });
            }
        } catch (e) {}
        return s;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

    // ------------------------------------------------------------------ shapes -> knots
    // knot: { u, v, si, so, ii, io, hold }  u/v in 0..1 space, si/so = slope in / out,
    // ii/io = influence in / out (0..1 of the neighbouring segment), hold = hold after this key
    const K = (u, v, si, so, ii, io, hold) => ({ u: u, v: v, si: si, so: so, ii: ii, io: io, hold: !!hold });
    const SINE = 0.364;   // bezier handle length that best matches a half sine between two extremes
    const QUAD = 1 / 3;   // exact for parabolas / cubic Hermite

    function elasticKnots(p) {
        const tp = p.tp, a = p.a, half = p.half, r = p.r;
        const out = [K(0, 0, 0, (1 + a) * Math.PI / 2 / tp, 0, QUAD), K(tp, 1 + a, 0, 0, QUAD, SINE)];
        let u = tp, amp = a, sign = 1;
        for (let i = 0; i < 60; i++) {
            u += half; amp *= r; sign = -sign;
            if (u > 1 - half * 0.35 || amp < 0.004) break;
            out.push(K(u, 1 + sign * amp, 0, 0, SINE, SINE));
        }
        out.push(K(1, 1, 0, 0, SINE, 0));
        return out;
    }
    function bounceKnots(p) {
        const t1 = p.t1, R = 1 - t1, d = p.q * R, s = 1 - p.q;
        const out = [K(0, 0, 0, 0, 0, QUAD)];
        let imp = K(t1, 1, 2 / t1, 0, QUAD, QUAD);
        out.push(imp);
        let u = t1;
        for (let k = 0; k < 40; k++) {
            const hk = p.h * Math.pow(s, 2 * k), dk = d * Math.pow(s, k);
            if (hk < 0.004 || dk < 0.012 || u + dk > 1 - 0.004) break;
            imp.so = -4 * hk / dk;
            out.push(K(u + dk / 2, 1 - hk, 0, 0, QUAD, QUAD));
            u += dk;
            imp = K(u, 1, 4 * hk / dk, 0, QUAD, QUAD);
            out.push(imp);
        }
        if (u < 1 - 1e-6) out.push(K(1, 1, 0, 0, QUAD, 0));
        return out;
    }
    function stepsKnots(p) {
        const n = Math.round(p.n), s = p.s, out = [];
        if (s < 0.02) {
            out.push(K(0, 0, 0, 0, 0, 0, true));
            for (let j = 1; j < n; j++) out.push(K(j / n, j / (n - 1), 0, 0, 0, 0, j < n - 1));
            out.push(K(1, 1, 0, 0, 0, 0));
            return out;
        }
        const w = s / (2 * n), RAMP = 0.45;
        out.push(K(0, 0, 0, 0, 0, QUAD));
        for (let j = 1; j < n; j++) {
            out.push(K(j / n - w, (j - 1) / (n - 1), 0, 0, QUAD, RAMP));
            out.push(K(j / n + w, j / (n - 1), 0, 0, RAMP, QUAD));
        }
        out.push(K(1, 1, 0, 0, QUAD, 0));
        return out;
    }
    function knots() {
        let k = st.mode === 'elastic' ? elasticKnots(st.elastic) : st.mode === 'bounce' ? bounceKnots(st.bounce) : st.mode === 'steps' ? stepsKnots(st.steps) : null;
        if (k && st.rev && st.mode !== 'steps') k = k.slice().reverse().map(q => K(1 - q.u, 1 - q.v, q.so, q.si, q.io, q.ii, false));
        return k;
    }

    // handle positions in 0..1 space, and how dragging one changes the shape
    function handles() {
        let h;
        if (st.mode === 'elastic') { const p = st.elastic; h = [{ x: p.tp, y: 1 + p.a }, { x: p.tp + p.half, y: 1 - p.a * p.r }]; }
        else if (st.mode === 'bounce') { const p = st.bounce; h = [{ x: p.t1, y: 1 }, { x: p.t1 + p.q * (1 - p.t1) / 2, y: 1 - p.h }]; }
        else if (st.mode === 'steps') { const p = st.steps, n = Math.round(p.n), w = p.s / (2 * n); h = [{ x: 1 / n + w, y: 1 / (n - 1) }, { x: (n - 1) / n - w, y: (n - 2) / (n - 1) }]; }
        else return [];
        if (st.rev && st.mode !== 'steps') h = h.map(q => ({ x: 1 - q.x, y: 1 - q.y }));
        return h;
    }
    function dragTo(i, x, y) {
        if (st.rev && st.mode !== 'steps') { x = 1 - x; y = 1 - y; }
        if (st.mode === 'elastic') {
            const p = st.elastic;
            if (i === 0) { p.tp = clamp(x, 0.04, 0.8); p.a = clamp(y - 1, 0.02, 1.5); p.half = Math.min(p.half, Math.max(0.02, 1 - p.tp)); }
            else { p.half = clamp(x - p.tp, 0.02, Math.max(0.02, 1 - p.tp)); p.r = clamp((1 - y) / p.a, 0.02, 0.95); }
        } else if (st.mode === 'bounce') {
            const p = st.bounce;
            if (i === 0) p.t1 = clamp(x, 0.12, 0.9);
            else { p.q = clamp(2 * (x - p.t1) / (1 - p.t1), 0.05, 0.9); p.h = clamp(1 - y, 0.01, 1.2); }
        } else if (st.mode === 'steps') {
            const p = st.steps;
            if (i === 0) p.n = clamp(Math.round(1 / Math.max(0.02, x)), 2, 24);
            else { const n = Math.round(p.n); p.s = clamp(2 * n * ((n - 1) / n - x), 0, 1); if (p.s < 0.04) p.s = 0; }
        }
    }
    function valueRange(k, hs) {
        let lo = 0, hi = 1;
        k.forEach(q => { lo = Math.min(lo, q.v); hi = Math.max(hi, q.v); });
        hs.forEach(q => { lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); });
        return [lo, hi];
    }

    // ------------------------------------------------------------------ public API for tab-graph.js
    let frozen = null, camAnim = null, drag = null;
    const api = {
        active: () => st.mode !== 'bezier',
        mode: () => st.mode,
        // vertical range the graph should show (kept steady while dragging, eased after)
        range: () => frozen || valueRange(knots(), handles()),
        draw: draw,
        apply: apply,
        summary: summary,
        snapshot: () => ({ mode: st.mode, rev: st.rev, p: JSON.parse(JSON.stringify(st[st.mode] || {})) }),
        load: shape => { if (!shape || !NAMES[shape.mode]) return; st.rev = !!shape.rev; if (shape.p && st[shape.mode]) Object.assign(st[shape.mode], shape.p); setMode(shape.mode); autoApply(); },
        setMode: m => setMode(m),
        reset: () => { if (st.mode === 'bezier') return; st[st.mode] = JSON.parse(JSON.stringify(DEF[st.mode])); st.rev = false; setMode(st.mode); save(); autoApply(); },
        miniSVG: miniSVG
    };
    window.RFXGraphCurves = api;

    function summary() {
        const k = knots(); if (!k) return '';
        const extra = Math.max(0, k.length - 2);
        return NAMES[st.mode] + (st.rev && st.mode !== 'steps' ? ' (start)' : '') + '  ·  ' + (extra ? extra + ' key' + (extra === 1 ? '' : 's') + ' added' : 'no extra keys');
    }

    // ------------------------------------------------------------------ drawing
    function pathD(k, toPx) {
        let d = '';
        k.forEach((q, i) => {
            const P = toPx(q.u, q.v);
            if (!i) { d = 'M ' + P.x + ',' + P.y; return; }
            const a = k[i - 1], du = q.u - a.u;
            if (a.hold) { const H = toPx(q.u, a.v); d += ' L ' + H.x + ',' + H.y + ' L ' + P.x + ',' + P.y; return; }
            const c1 = toPx(a.u + a.io * du, a.v + a.so * a.io * du), c2 = toPx(q.u - q.ii * du, q.v - q.si * q.ii * du);
            d += ' C ' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + P.x + ',' + P.y;
        });
        return d;
    }
    function ensureLayer(svg) {
        let g = document.getElementById('gx-shape');
        if (g && g.ownerSVGElement === svg) return g;
        const NS = 'http://www.w3.org/2000/svg';
        g = document.createElementNS(NS, 'g'); g.id = 'gx-shape';
        g.innerHTML = '<path class="gx-shape-guide" fill="none" stroke-width="1.5" stroke-dasharray="3 4"/><path class="gx-curve gx-shape-curve" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><g class="gx-shape-knots"></g>' +
            '<circle class="gx-handle gx-shape-h" data-h="0" r="6" stroke-width="2.5"/><circle class="gx-handle gx-shape-h" data-h="1" r="6" stroke-width="2.5"/>';
        svg.appendChild(g);
        g.querySelectorAll('.gx-shape-h').forEach(c => c.addEventListener('pointerdown', e => startDrag(e, +c.getAttribute('data-h'))));
        svg.addEventListener('pointerdown', e => {          // click anywhere: nearest handle jumps there
            if (!api.active() || e.button !== 0 || drag || e.target.classList.contains('gx-shape-h')) return;
            const m = lastM; if (!m) return;
            const pos = local(e), hs = handles();
            let best = 0, bd = Infinity;
            hs.forEach((h, i) => { const P = toPxFn(m)(h.x, h.y), dd = Math.hypot(P.x - pos.x, P.y - pos.y); if (dd < bd) { bd = dd; best = i; } });
            startDrag(e, best, true);
        });
        svg.addEventListener('pointermove', moveDrag);
        svg.addEventListener('pointerup', endDrag);
        svg.addEventListener('pointercancel', endDrag);
        return g;
    }
    let lastM = null;
    const toPxFn = m => (u, v) => ({ x: m.offsetX + u * m.drawW, y: m.offsetY + m.drawH * m.rangeY - (v - m.minValY) * m.drawH });
    function local(e) { const r = lastM.svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    function draw(m, valueDisplay) {
        lastM = m;
        const g = ensureLayer(m.svg), toPx = toPxFn(m), k = knots(), hs = handles();
        g.querySelector('.gx-shape-curve').setAttribute('d', pathD(k, toPx));
        // faint line from the curve's start to the first handle and between the handles
        const g0 = toPx(hs[0].x, hs[0].y), g1 = toPx(hs[1].x, hs[1].y);
        g.querySelector('.gx-shape-guide').setAttribute('d', 'M ' + g0.x + ',' + g0.y + ' L ' + g1.x + ',' + g1.y);
        // the keyframes Apply will add (small dots)
        g.querySelector('.gx-shape-knots').innerHTML = k.slice(1, -1).map(q => { const P = toPx(q.u, q.v); return '<circle class="gx-knot" cx="' + P.x + '" cy="' + P.y + '" r="2.4"/>'; }).join('');
        g.querySelectorAll('.gx-shape-h').forEach((c, i) => { const P = toPx(hs[i].x, hs[i].y); c.setAttribute('cx', P.x); c.setAttribute('cy', P.y); });
        if (valueDisplay) valueDisplay.textContent = summary();
    }

    function startDrag(e, i, jump) {
        if (!api.active() || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        frozen = valueRange(knots(), handles());
        drag = { i: i, id: e.pointerId };
        try { lastM.svg.setPointerCapture(e.pointerId); } catch (err) {}
        if (jump) moveDrag(e, true);
    }
    function moveDrag(e, force) {
        if (!drag || (!force && e.pointerId !== drag.id)) return;
        const m = lastM, pos = local(e);
        const x = (pos.x - m.offsetX) / m.drawW, y = m.minValY + (m.offsetY + m.drawH * m.rangeY - pos.y) / m.drawH;
        dragTo(drag.i, x, y);
        const r = valueRange(knots(), handles());           // grow the view if the shape needs it
        frozen = [Math.min(frozen[0], r[0]), Math.max(frozen[1], r[1])];
        redraw();
    }
    function endDrag(e) {
        if (!drag) return;
        try { lastM.svg.releasePointerCapture(drag.id); } catch (err) {}
        drag = null; save();
        easeRangeTo(valueRange(knots(), handles()));
        autoApply();
    }
    function easeRangeTo(target) {
        if (camAnim) cancelAnimationFrame(camAnim);
        const from = (frozen || target).slice(), t0 = performance.now();
        const step = now => {
            const p = Math.min(1, (now - t0) / 300), e = 1 - Math.pow(1 - p, 3);
            frozen = [from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e];
            redraw();
            if (p < 1) camAnim = requestAnimationFrame(step); else { frozen = null; camAnim = null; redraw(); }
        };
        camAnim = requestAnimationFrame(step);
    }
    const redraw = () => { if (window._graphRedraw) window._graphRedraw(); };
    const autoApply = () => { if (window.isAutoGraph && api.active()) apply(true); };

    // ------------------------------------------------------------------ apply to After Effects
    function apply(quiet) {
        const k = knots(); if (!k) return;
        const spec = k.map(q => [q.u, q.v, q.si, q.so, q.ii * 100, q.io * 100, q.hold ? 1 : 0].map(n => +(+n).toFixed(6)).join(',')).join(';');
        graphJsx('graphApplyCurveKnots("' + spec + '", "' + NAMES[st.mode] + '")', res => {
            if (!res || res.indexOf('ERROR') === 0) { if (!quiet || (res && res.indexOf('ERROR') === 0)) window.showToast && showToast(res ? res.replace('ERROR: ', '') : 'Could not apply the curve'); return; }
            const parts = String(res).split(' ');
            if (parts[0] === 'OK' && parts[1] === '0' && window.showToast) showToast('Select a property with two keyframes (or two keyframes)');
        });
    }

    // ------------------------------------------------------------------ preset thumbnails
    function miniSVG(shape) {
        const keep = st, mode = shape && NAMES[shape.mode] ? shape.mode : 'elastic';
        st = JSON.parse(JSON.stringify(DEF));
        st.mode = mode; st.rev = !!(shape && shape.rev);
        if (shape && shape.p && st[mode]) Object.assign(st[mode], shape.p);
        const k = knots(), r = valueRange(k, []);
        st = keep;
        const w = 35, h = 35, p = 5, toPx = (u, v) => ({ x: p + u * w, y: (h + p) - v * h });
        const top = 40 - r[1] * 35 - 5, bottom = 40 - r[0] * 35 + 5;
        return '<svg viewBox="0 ' + top + ' 45 ' + (bottom - top) + '" width="100%" height="100%" style="overflow:visible; display:block;"><path class="gx-curve" d="' + pathD(k, toPx) + '" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    // ------------------------------------------------------------------ type row
    function setMode(m) {
        if (!NAMES[m]) return;
        st.mode = m; save();
        const tg = document.getElementById('tab-graph');
        if (tg) tg.classList.toggle('graph-shape-mode', m !== 'bezier');
        document.querySelectorAll('#graph-type-header .graph-type-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-type') === m));
        const mirror = document.getElementById('graph-mirror-btn');
        if (mirror) { mirror.classList.toggle('is-hidden', m === 'bezier' || m === 'steps'); mirror.classList.toggle('active', st.rev); }
        frozen = null;
        redraw();
    }
    function setBarCollapsed(v) {
        const tg = document.getElementById('tab-graph'); if (!tg) return;
        tg.classList.toggle('graph-type-collapsed', !!v);
        try { if (v) localStorage.setItem(BAR_KEY, '1'); else localStorage.removeItem(BAR_KEY); } catch (e) {}
    }
    const barCollapsed = () => { const tg = document.getElementById('tab-graph'); return !!(tg && tg.classList.contains('graph-type-collapsed')); };

    function init() {
        const header = document.getElementById('graph-type-header');
        if (!header) return;
        try { const order = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'); if (order) order.forEach(id => { const b = document.getElementById(id); if (b && b.parentNode === header) header.appendChild(b); }); } catch (e) {}
        makeSubTabsDraggable(header, '.graph-type-btn', 'isDraggingGraphType', () => {
            try { localStorage.setItem(ORDER_KEY, JSON.stringify(Array.from(header.querySelectorAll('.graph-type-btn')).map(b => b.id))); } catch (e) {}
        });
        header.addEventListener('click', e => {
            const b = e.target.closest('.graph-type-btn');
            if (!b || window.isDraggingGraphType) return;
            setMode(b.getAttribute('data-type'));
            autoApply();
        });
        const mirror = document.getElementById('graph-mirror-btn');
        if (mirror) mirror.addEventListener('click', () => { st.rev = !st.rev; save(); setMode(st.mode); autoApply(); });

        // the thin handle under the row: drag up / click to hide the row, drag down / click to show it
        const handle = document.getElementById('graph-type-handle');
        if (handle) {
            let y0 = 0, moved = false, down = false;
            handle.addEventListener('pointerdown', e => { down = true; moved = false; y0 = e.clientY; try { handle.setPointerCapture(e.pointerId); } catch (err) {} e.preventDefault(); });
            handle.addEventListener('pointermove', e => {
                if (!down) return;
                const dy = e.clientY - y0;
                if (dy < -12 && !barCollapsed()) { setBarCollapsed(true); moved = true; y0 = e.clientY; }
                else if (dy > 12 && barCollapsed()) { setBarCollapsed(false); moved = true; y0 = e.clientY; }
                else if (Math.abs(dy) > 4) moved = true;
            });
            handle.addEventListener('pointerup', e => {
                if (!down) return; down = false;
                try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
                if (!moved) setBarCollapsed(!barCollapsed());
            });
        }
        try { if (localStorage.getItem(BAR_KEY) === '1') setBarCollapsed(true); } catch (e) {}
        setMode(st.mode);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
