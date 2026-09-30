/* GRAPH TAB: curve types
   The type row at the top of the Graph tab picks what the graph edits. Bezier is the
   classic two-handle ease in js/tab-graph.js; the others are drawn and edited here.
   Their controls sit on the edges of the graph (sliders) or hang from the curve, and are
   dragged along one axis:
     Elastic        top slider      overshoot (right = bigger snap past the target)
                    trough handle   frequency (left = tighter, faster wobble)
     Bounce         left slider     rebound height + how slowly they die out (up = bouncier)
                    bottom slider   number of bounces (right = more)
     Cyclic         left slider     where the first wave peaks (start of the upper line)
                    bottom slider   number of waves (right = more)
                    right slider    where the lower line ends (tilts the waves)
     Steps          bottom slider   number of steps (right = more)
                    top handle      softness of each step (left = smoother, above the riser = hard)
     Elastic Steps  bottom slider   number of steps (right = more)
                    right slider    how much each step overshoots and wobbles
     Random         left slider     noise amount
                    bottom slider   noise density (right = faster jitter)
                    right slider    where the middle line heads (tilts the noise)
   Every type is a short list of keyframes ("knots": time, value, speeds, influences,
   hold) in 0..1 space (0 = first key's value, 1 = second key's value). The graph draws
   exactly what After Effects interpolates between those keys, and Apply bakes them between
   each pair of keyframes (jsx/graph.jsx graphApplyCurveKnots): ordinary keys, editable in
   the AE graph editor, only as many as the shape needs. Keys it added are replaced on the
   next apply and removed again when you go back to Bezier. Reverse (next to Save) plays a
   shape backwards: time and value mirrored.
   State: rfxGraphCurve = { mode, rev, elastic: {...}, bounce: {...}, ... }. */
(function () {
    'use strict';
    const KEY = 'rfxGraphCurve', BAR_KEY = 'rfxGraphTypeBarCollapsed', ORDER_KEY = 'rfxGraphTypeOrder';
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const K = (u, v, si, so, ii, io, hold) => ({ u: u, v: v, si: si, so: so, ii: ii, io: io, hold: !!hold });
    const SINE = 0.364;   // bezier handle length that best matches a half sine between two extremes
    const QUAD = 1 / 3;   // exact for parabolas, lines and cubic Hermite
    const EDGE = 0.07;    // side sliders sit this far outside the 0..1 box
    const BOT = 0.1;      // bottom sliders sit this far below the lowest point

    // ------------------------------------------------------------------ the models
    // knots(p, rev) -> knots; handles(p, box) -> [{ x, y, axis, alt, track, stem }]; drag(p, i, x, y)
    // box = { lo, hi } value range of the curve, so edge sliders stay clear of it.
    const MODELS = {
        elastic: {
            name: 'Elastic', def: { a: 0.3, h: 0.27 },
            knots(p) {
                const h = p.h, tp = 0.85 * h, a = p.a, R = 0.3;
                const out = [K(0, 0, 0, (1 + a) / tp, 0, QUAD), K(tp, 1 + a, 0, 0, 0.42, SINE)];
                let u = tp, amp = a, sign = 1;
                for (let i = 0; i < 80; i++) {
                    u += h; amp *= R; sign = -sign;
                    if (u > 1 - 0.35 * h || amp < 0.004) break;
                    out.push(K(u, 1 + sign * amp, 0, 0, SINE, SINE));
                }
                out.push(K(1, 1, 0, 0, SINE, 0));
                return out;
            },
            handles(p) {
                const TOP = 2.05, tp = 0.85 * p.h;
                return [
                    { x: (p.a - 0.05) / 0.85, y: TOP, axis: 'x', track: [[0, TOP], [1, TOP]] },
                    { x: tp + p.h, y: 0.45, axis: 'x', stem: [tp + p.h, 1 - p.a * 0.3] }
                ];
            },
            drag(p, i, x) {
                if (i === 0) p.a = 0.05 + clamp(x, 0, 1) * 0.85;
                else p.h = clamp(x / 1.85, 0.05, 0.54);
            }
        },
        bounce: {
            name: 'Bounce', def: { a: 0.7, n: 5 },
            knots(p) {
                const n = Math.round(p.n), rho = 0.3 + 0.6 * p.a, hs = [];
                let sum = 0;
                for (let k = 0; k < n; k++) { hs.push(p.a * Math.pow(rho, k)); sum += Math.sqrt(hs[k]); }
                const c = 1 / (1 + 2 * sum);           // fall time; each arc lasts 2c * sqrt(height)
                const out = [K(0, 0, 0, 0, 0, QUAD)];
                let u = c, imp = K(c, 1, 2 / c, 0, QUAD, QUAD);
                out.push(imp);
                hs.forEach(h => {
                    const d = 2 * c * Math.sqrt(h);
                    imp.so = -4 * h / d;
                    out.push(K(u + d / 2, 1 - h, 0, 0, QUAD, QUAD));
                    u += d;
                    imp = K(u, 1, 4 * h / d, 0, QUAD, QUAD);
                    out.push(imp);
                });
                imp.u = 1; imp.io = 0;                  // the last landing is the second keyframe
                return out;
            },
            handles(p, box) {
                return [
                    { x: -EDGE, y: p.a, axis: 'y', track: [[-EDGE, 0], [-EDGE, 1]] },
                    { x: (Math.round(p.n) - 1) / 11, y: box.lo - BOT, axis: 'x', track: [[0, box.lo - BOT], [1, box.lo - BOT]] }
                ];
            },
            drag(p, i, x, y) {
                if (i === 0) p.a = clamp(y, 0.05, 0.95);
                else p.n = clamp(Math.round(1 + x * 11), 1, 12);
            }
        },
        cyclic: {
            name: 'Cyclic', def: { k: 3, hs: 1, le: 0 },
            knots(p) {
                const N = 2 * Math.round(p.k) + 1, out = [];
                for (let i = 0; i <= N; i++) {
                    const u = i / N, v = i % 2 === 0 ? p.le * u : p.hs + (1 - p.hs) * u;
                    out.push(K(u, v, 0, 0, i ? SINE : 0, i < N ? SINE : 0));
                }
                return out;
            },
            handles(p, box) {
                return [
                    { x: -EDGE, y: p.hs, axis: 'y', track: [[-EDGE, 0], [-EDGE, 1.5]] },
                    { x: Math.round(p.k) / 15, y: box.lo - BOT, axis: 'x', track: [[0, box.lo - BOT], [1, box.lo - BOT]] },
                    { x: 1 + EDGE, y: p.le, axis: 'y', alt: true, track: [[1 + EDGE, -0.5], [1 + EDGE, 1]] }
                ];
            },
            drag(p, i, x, y) {
                if (i === 0) p.hs = clamp(y, 0, 1.5);
                else if (i === 1) p.k = clamp(Math.round(x * 15), 0, 15);
                else p.le = clamp(y, -0.5, 1);
            }
        },
        steps: {
            name: 'Steps', def: { n: 4, s: 0 },
            knots(p, rev) {
                const n = Math.round(p.n), s = p.s, out = [];
                if (s < 0.02) {
                    if (rev) {
                        // held steps can't be mirrored key for key: reversed, the last level is reached early instead
                        out.push(K(0, 0, 0, 0, 0, 0, true));
                        for (let j = 1; j < n; j++) out.push(K(j / n, j / (n - 1), 0, 0, 0, 0, j < n - 1));
                        out.push(K(1, 1, 0, 0, 0, 0));
                        out.noMirror = true;
                        return out;
                    }
                    // n held levels 0, 1/n ... (n-1)/n; the jump to the last value lands on the second key
                    out.push(K(0, 0, 0, 0, 0, 0, true));
                    for (let j = 1; j < n; j++) out.push(K(j / n, j / n, 0, 0, 0, 0, true));
                    out.push(K(1, 1, 0, 0, 0, 0));
                    return out;
                }
                // soft steps: each jump is an eased ramp ending on the step boundary
                const RAMP = 0.45;
                out.push(K(0, 0, 0, 0, 0, QUAD));
                for (let j = 1; j <= n; j++) {
                    const a = j / n - s / n, b = j / n;
                    const last = out[out.length - 1];
                    if (a - last.u > 1e-6) out.push(K(a, (j - 1) / n, 0, 0, QUAD, RAMP));
                    else last.io = RAMP;
                    out.push(K(b, j / n, 0, 0, RAMP, j < n ? QUAD : 0));
                }
                return out;
            },
            handles(p, box) {
                const n = Math.round(p.n);
                return [
                    { x: (n - 2) / 22, y: box.lo - BOT, axis: 'x', track: [[0, box.lo - BOT], [1, box.lo - BOT]] },
                    { x: 1 / n - p.s / n, y: 1.12, axis: 'x', alt: true, stem: [1 / n, 1 / n] }
                ];
            },
            drag(p, i, x) {
                if (i === 0) p.n = clamp(Math.round(2 + x * 22), 2, 24);
                else { const n = Math.round(p.n); p.s = clamp((1 / n - x) * n, 0, 1); if (p.s < 0.04) p.s = 0; }
            }
        },
        elasticsteps: {
            name: 'Elastic Steps', def: { n: 3, w: 0.5 },
            knots(p) {
                const n = Math.round(p.n), A = 0.8 * p.w, D = 1 / (n - 1), L = k => k / (n - 1);
                const rise = 0.2 / n, hp = 0.13 / n;
                const out = [K(0, 0, 0, 0, 0, QUAD)];
                for (let k = 1; k < n; k++) {
                    const tj = k / n, next = k < n - 1 ? (k + 1) / n : 1;
                    out.push(K(tj, L(k - 1), 0, 0, QUAD, 0.42));
                    if (A < 0.01) { out.push(K(tj + rise, L(k), 0, 0, 0.42, QUAD)); continue; }
                    let u = tj + rise, amp = A, sign = 1;
                    out.push(K(u, L(k) + A * D, 0, 0, 0.42, SINE));
                    for (let i = 0; i < 40; i++) {
                        u += hp; amp *= 0.35; sign = -sign;
                        if (amp * D < 0.002 || u > next - hp * 0.6) break;
                        out.push(K(u, L(k) + sign * amp * D, 0, 0, SINE, SINE));
                    }
                }
                out.push(K(1, 1, 0, 0, SINE, 0));
                return out;
            },
            handles(p, box) {
                const n = Math.round(p.n);
                return [
                    { x: (n - 2) / 10, y: box.lo - BOT, axis: 'x', track: [[0, box.lo - BOT], [1, box.lo - BOT]] },
                    { x: 1 + EDGE, y: 1 + 0.6 * p.w, axis: 'y', alt: true, track: [[1 + EDGE, 1], [1 + EDGE, 1.6]], stem: [(n - 1) / n, (n - 2) / (n - 1)] }
                ];
            },
            drag(p, i, x, y) {
                if (i === 0) p.n = clamp(Math.round(2 + x * 10), 2, 12);
                else p.w = clamp((y - 1) / 0.6, 0, 1);
            }
        },
        random: {
            name: 'Random', def: { amp: 0.35, f: 0.4, e: 1 },
            knots(p) {
                const m = Math.round(6 + p.f * 74), rnd = rng(1234), pts = [{ u: 0, v: 0 }];
                for (let i = 1; i <= m; i++) {
                    const u = i / (m + 1) + (rnd() - 0.5) * 0.6 / (m + 1);
                    const env = 0.35 + 0.65 * u;
                    pts.push({ u: u, v: p.e * u + (rnd() * 2 - 1) * p.amp * env });
                }
                pts.push({ u: 1, v: 1 });
                // straight segments: each key's speeds are the slopes towards its neighbours
                return pts.map((q, i) => {
                    const si = i ? (q.v - pts[i - 1].v) / (q.u - pts[i - 1].u) : 0;
                    const so = i < pts.length - 1 ? (pts[i + 1].v - q.v) / (pts[i + 1].u - q.u) : 0;
                    return K(q.u, q.v, si, so, i ? QUAD : 0, i < pts.length - 1 ? QUAD : 0);
                });
            },
            handles(p, box) {
                return [
                    { x: -EDGE, y: p.amp, axis: 'y', track: [[-EDGE, 0], [-EDGE, 1]] },
                    { x: p.f, y: box.lo - BOT, axis: 'x', track: [[0, box.lo - BOT], [1, box.lo - BOT]] },
                    { x: 1 + EDGE, y: p.e, axis: 'y', alt: true, track: [[1 + EDGE, -0.5], [1 + EDGE, 1.5]] }
                ];
            },
            drag(p, i, x, y) {
                if (i === 0) p.amp = clamp(y, 0, 1);
                else if (i === 1) p.f = clamp(x, 0, 1);
                else p.e = clamp(y, -0.5, 1.5);
            }
        }
    };
    function rng(seed) {   // small deterministic generator, so the preview and the baked keys match
        let a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    // ------------------------------------------------------------------ state
    function defaults() {
        const s = { mode: 'bezier', rev: false };
        Object.keys(MODELS).forEach(m => { s[m] = Object.assign({}, MODELS[m].def); });
        return s;
    }
    function assignKnown(target, src) {
        if (!src) return;
        Object.keys(target).forEach(k => { if (typeof src[k] === 'number' && isFinite(src[k])) target[k] = src[k]; });
    }
    let st = load();
    function load() {
        const s = defaults();
        try {
            const o = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (o && typeof o === 'object') {
                if (o.mode === 'bezier' || MODELS[o.mode]) s.mode = o.mode;
                s.rev = !!o.rev;
                Object.keys(MODELS).forEach(m => assignKnown(s[m], o[m]));
            }
        } catch (e) {}
        return s;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

    const model = () => MODELS[st.mode] || null;
    function mirrorKnots(k) { return k.slice().reverse().map(q => K(1 - q.u, 1 - q.v, q.so, q.si, q.io, q.ii, false)); }
    function knotsFor(s) {
        const M = MODELS[s.mode]; if (!M) return null;
        const k = M.knots(s[s.mode], s.rev);
        return s.rev && !k.noMirror ? mirrorKnots(k) : k;
    }
    const knots = () => knotsFor(st);
    function valueRange(k) {
        let lo = 0, hi = 1;
        k.forEach(q => { lo = Math.min(lo, q.v); hi = Math.max(hi, q.v); });
        return { lo: lo, hi: hi };
    }
    // handles in the drawing's space (mirrored with the curve when reversed)
    function handles() {
        const M = model(); if (!M) return [];
        const p = st[st.mode];
        // edge sliders keep clear of the un-mirrored curve
        const raw = M.knots(p, false), box = valueRange(raw);
        let hs = M.handles(p, box);
        if (st.rev) {
            const f = pt => [1 - pt[0], 1 - pt[1]];
            hs = hs.map(h => Object.assign({}, h, { x: 1 - h.x, y: 1 - h.y, track: h.track && h.track.map(f), stem: h.stem && f(h.stem) }));
        }
        return hs;
    }
    function viewRange() {
        const r = valueRange(knots());
        handles().forEach(h => {
            r.lo = Math.min(r.lo, h.y); r.hi = Math.max(r.hi, h.y);
            (h.track || []).forEach(t => { r.lo = Math.min(r.lo, t[1]); r.hi = Math.max(r.hi, t[1]); });
        });
        return [r.lo, r.hi];
    }

    // ------------------------------------------------------------------ public API for tab-graph.js
    let frozen = null, camAnim = null, drag = null, lastM = null;
    const api = {
        active: () => !!model(),
        mode: () => st.mode,
        name: () => (model() ? model().name : 'Bezier'),
        reversed: () => st.rev,
        range: () => frozen || viewRange(),
        draw: draw,
        apply: apply,
        summary: summary,
        snapshot: () => ({ mode: st.mode, rev: st.rev, p: Object.assign({}, st[st.mode] || {}) }),
        load: shape => { if (!shape || !MODELS[shape.mode]) return; st.rev = !!shape.rev; assignKnown(st[shape.mode], shape.p); setMode(shape.mode); autoApply(); },
        setMode: m => setMode(m),
        reverse: () => { if (!model()) return; st.rev = !st.rev; save(); setMode(st.mode); autoApply(); },
        reset: () => { const M = model(); if (!M) return; st[st.mode] = Object.assign({}, M.def); st.rev = false; setMode(st.mode); save(); autoApply(); },
        miniSVG: miniSVG
    };
    window.RFXGraphCurves = api;

    function summary() {
        const k = knots(); if (!k) return '';
        const extra = Math.max(0, k.length - 2);
        return model().name + (st.rev ? ' (reversed)' : '') + '  ·  ' + (extra ? extra + ' key' + (extra === 1 ? '' : 's') + ' added' : 'no extra keys');
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
    const toPxFn = m => (u, v) => ({ x: m.offsetX + u * m.drawW, y: m.offsetY + m.drawH * m.rangeY - (v - m.minValY) * m.drawH });
    function local(e) { const r = lastM.svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    function ensureLayer(svg) {
        let g = document.getElementById('gx-shape');
        if (g && g.ownerSVGElement === svg) return g;
        const NS = 'http://www.w3.org/2000/svg';
        g = document.createElementNS(NS, 'g'); g.id = 'gx-shape';
        g.innerHTML = '<g class="gx-shape-tracks"></g><path class="gx-curve gx-shape-curve" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><g class="gx-shape-knots"></g><g class="gx-shape-handles"></g>';
        svg.appendChild(g);
        g.addEventListener('pointerdown', e => {
            const hit = e.target.closest && e.target.closest('[data-h]');
            if (hit) startDrag(e, +hit.getAttribute('data-h'));
        });
        svg.addEventListener('pointerdown', e => {          // click in the graph: the nearest control jumps there
            if (!api.active() || e.button !== 0 || drag || (e.target.closest && e.target.closest('[data-h]'))) return;
            const m = lastM; if (!m) return;
            const pos = local(e), hs = handles(), toPx = toPxFn(m);
            let best = 0, bd = Infinity;
            hs.forEach((h, i) => { const P = toPx(h.x, h.y), dd = Math.hypot(P.x - pos.x, P.y - pos.y); if (dd < bd) { bd = dd; best = i; } });
            startDrag(e, best, true);
        });
        svg.addEventListener('pointermove', moveDrag);
        svg.addEventListener('pointerup', endDrag);
        svg.addEventListener('pointercancel', endDrag);
        return g;
    }

    function draw(m, valueDisplay) {
        lastM = m;
        const g = ensureLayer(m.svg), toPx = toPxFn(m), k = knots(), hs = handles();
        g.querySelector('.gx-shape-curve').setAttribute('d', pathD(k, toPx));
        // slider tracks and the stems joining a control to the curve
        let tracks = '';
        hs.forEach(h => {
            const cls = 'gx-track' + (h.alt ? ' gx-track-alt' : '');
            if (h.track) { const a = toPx(h.track[0][0], h.track[0][1]), b = toPx(h.track[1][0], h.track[1][1]); tracks += '<line class="' + cls + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke-width="2" stroke-linecap="round"/>'; }
            if (h.stem) { const a = toPx(h.x, h.y), b = toPx(h.stem[0], h.stem[1]); tracks += '<line class="' + cls + ' gx-stem" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke-width="2" stroke-linecap="round"/>'; }
        });
        g.querySelector('.gx-shape-tracks').innerHTML = tracks;
        // the keyframes Apply will add
        g.querySelector('.gx-shape-knots').innerHTML = k.slice(1, -1).map(q => { const P = toPx(q.u, q.v); return '<circle class="gx-knot" cx="' + P.x + '" cy="' + P.y + '" r="2.2"/>'; }).join('');
        g.querySelector('.gx-shape-handles').innerHTML = hs.map((h, i) => {
            const P = toPx(h.x, h.y), cur = h.axis === 'x' ? 'ew-resize' : 'ns-resize';
            return '<circle class="gx-handle' + (h.alt ? ' gx-handle-alt' : '') + (drag && drag.i === i ? ' is-dragging' : '') + '" cx="' + P.x + '" cy="' + P.y + '" r="6.5" stroke-width="2.5" style="pointer-events:none"/>' +
                '<circle class="gx-hit" data-h="' + i + '" cx="' + P.x + '" cy="' + P.y + '" r="13" style="cursor:' + cur + '"/>';
        }).join('');
        if (valueDisplay) valueDisplay.textContent = summary();
    }

    function startDrag(e, i, jump) {
        if (!api.active() || e.button !== 0 || !lastM) return;
        e.preventDefault(); e.stopPropagation();
        frozen = viewRange();
        drag = { i: i, id: e.pointerId };
        try { lastM.svg.setPointerCapture(e.pointerId); } catch (err) {}
        if (jump) moveDrag(e, true); else redraw();
    }
    function moveDrag(e, force) {
        if (!drag || (!force && e.pointerId !== drag.id)) return;
        const m = lastM, pos = local(e);
        let x = (pos.x - m.offsetX) / m.drawW, y = m.minValY + (m.offsetY + m.drawH * m.rangeY - pos.y) / m.drawH;
        if (st.rev) { x = 1 - x; y = 1 - y; }
        model().drag(st[st.mode], drag.i, x, y);
        const r = viewRange();                              // grow the view if the shape needs it
        frozen = [Math.min(frozen[0], r[0]), Math.max(frozen[1], r[1])];
        redraw();
    }
    function endDrag() {
        if (!drag) return;
        try { lastM.svg.releasePointerCapture(drag.id); } catch (err) {}
        drag = null; save();
        easeRangeTo(viewRange());
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
        graphJsx('graphApplyCurveKnots("' + spec + '", "' + model().name + '")', res => {
            if (!res || res.indexOf('ERROR') === 0) { if (!quiet || (res && res.indexOf('ERROR') === 0)) window.showToast && showToast(res ? res.replace('ERROR: ', '') : 'Could not apply the curve'); return; }
            const parts = String(res).split(' ');
            if (parts[0] === 'OK' && parts[1] === '0' && !quiet && window.showToast) showToast('Select two keyframes, or a property with keyframes');
        });
    }

    // ------------------------------------------------------------------ preset thumbnails
    function miniSVG(shape) {
        const s = defaults();
        s.mode = shape && MODELS[shape.mode] ? shape.mode : 'elastic';
        s.rev = !!(shape && shape.rev);
        assignKnown(s[s.mode], shape && shape.p);
        const k = knotsFor(s), r = valueRange(k);
        const w = 35, h = 35, p = 5, toPx = (u, v) => ({ x: p + u * w, y: (h + p) - v * h });
        const top = 40 - r.hi * 35 - 5, bottom = 40 - r.lo * 35 + 5;
        return '<svg viewBox="0 ' + top + ' 45 ' + (bottom - top) + '" width="100%" height="100%" style="overflow:visible; display:block;"><path class="gx-curve" d="' + pathD(k, toPx) + '" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    // ------------------------------------------------------------------ type row + reverse button
    function syncReverse() {
        const b = document.getElementById('graph-reverse-btn');
        if (b) b.classList.toggle('active', !!model() && st.rev);
    }
    function setMode(m) {
        if (m !== 'bezier' && !MODELS[m]) return;
        st.mode = m; save();
        const tg = document.getElementById('tab-graph');
        if (tg) tg.classList.toggle('graph-shape-mode', m !== 'bezier');
        document.querySelectorAll('#graph-type-header .graph-type-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-type') === m));
        syncReverse();
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
            const m = b.getAttribute('data-type');
            setMode(m);
            b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            // AUTO: the new type goes straight onto the keys (Bezier also removes the keys a type added)
            if (window.isAutoGraph) { if (m === 'bezier') window.applyGraphToKeyframesWithCheck(window._activeEaseType); else apply(true); }
        });
        // the row scrolls sideways with the mouse wheel when the types don't fit
        header.addEventListener('wheel', e => {
            if (header.scrollWidth <= header.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            header.scrollLeft += e.deltaY; e.preventDefault();
        }, { passive: false });

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
