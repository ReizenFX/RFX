/* GRAPH TAB: curve types
   The type row at the top of the Graph tab picks what the graph edits. Bezier is the
   classic two-handle ease in js/tab-graph.js; the others are drawn and edited here.

   Controls: every handle sits on the curve, on the feature it changes, and that feature
   follows the pointer (grab the overshoot and pull it higher, grab a bounce and make it
   deeper). The short arm on a peak is its hang (how long the curve lingers there), like
   an AE influence handle. Hovering a handle names what it changes, with the values.
   Right-click the graph for every setting as a slider; each one can also be reached with
   the handles alone.
     Elastic        peak = Amplitude + Duration, first dip = Decay Y (+ Duration),
                    second swing = Decay X (+ Decay Y), arm = Hang
     Bounce         first landing = Gravity, first rebound = Amplitude (+ Gravity),
                    second rebound = Decay Y + Decay X, last landing = Bounciness, arm = Hang
     Cyclic         first peak = Cycles + Start, last low = Cycles + End, arm = Hang
     Steps          top of the last riser = Steps, foot of the first riser = Smoothness
     Elastic Steps  last overshoot = Steps + Amplitude, the dip after it = Decay, arm = Hang
     Random         top of the band = Amount, dot on the middle line = Density,
                    end of the middle line = Trajectory (right-click: New pattern)

   Every type is a short list of keyframes ("knots": time, value, speeds, influences,
   segment type) in 0..1 space (0 = first key's value, 1 = second key's value). The graph
   draws exactly what After Effects interpolates between those keys, and Apply bakes them
   between each pair of keyframes (jsx/graph.jsx graphApplyCurveKnots): ordinary keys,
   editable in the AE graph editor, only as many as the shape needs. Keys it added are
   replaced on the next apply and removed again by a Bezier apply. Reverse (next to Save)
   plays a shape backwards: time and value mirrored.
   State: rfxGraphCurve = { mode, rev, elastic: {...}, bounce: {...}, ... } (slider units). */
(function () {
    'use strict';
    const KEY = 'rfxGraphCurve', BAR_KEY = 'rfxGraphTypeBarCollapsed', ORDER_KEY = 'rfxGraphTypeOrder', HINT_KEY = 'rfxGraphCurveHint';
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const R = Math.round;
    // seg: 0 = bezier to the next knot, 1 = hold, 2 = linear
    const K = (u, v, si, so, ii, io, seg) => ({ u: u, v: v, si: si, so: so, ii: ii, io: io, seg: seg || 0 });
    const SINE = 0.364, QUAD = 1 / 3;
    const infE = h => 0.06 + h * 0.0061;   // hang 50 = a natural sine swing
    const infB = h => 0.06 + h * 0.0036;   // hang 75 = a true parabola (ball flight)
    const ARM0 = 16, ARMK = 0.5;           // hang arm: 16 px + hang / 2 px
    const HIT = 16;                        // grab radius in px

    // ------------------------------------------------------------------ Elastic
    function elBase(p) {
        const A = Math.max(0.01, p.amp / 100), r = clamp(1 - p.dy / 100, 0.02, 0.99), q = clamp(1 - p.dx / 100, 0.1, 1);
        let n = Math.ceil(Math.log(0.005 / A) / Math.log(r));
        n = clamp(isFinite(n) ? n : 3, 3, 30);     // at least peak, dip and a second swing (each has a handle)
        let S = 0;
        for (let k = 0; k < n; k++) S += Math.pow(q, k);
        return { A: A, r: r, q: q, n: n, S: S };
    }
    function buildElastic(p) {
        // Duration = when the wobble settles; past 100 it is still wobbling at the second key (cut there)
        const b = elBase(p), D = clamp(p.dur / 100, 0.05, 3), h0 = D / (0.85 + b.S), tp = 0.85 * h0, I = infE(p.hang);
        const k = [K(0, 0, 0, (1 + b.A) / tp, 0, QUAD), K(tp, 1 + b.A, 0, 0, I, I)];
        let u = tp;
        let settled = false;
        for (let j = 1; j <= b.n; j++) {
            const step = h0 * Math.pow(b.q, j - 1);
            if (u + step > 1 - 0.3 * step) break;
            u += step;
            settled = j === b.n;
            k.push(K(u, settled ? 1 : 1 + (j % 2 ? -1 : 1) * b.A * Math.pow(b.r, j), 0, 0, I, I));
        }
        k[k.length - 1].io = settled ? QUAD : I;
        k.push(K(1, 1, 0, 0, settled ? QUAD : I, 0));
        const tempo = h => { const b2 = elBase(p); p.dur = clamp(R(h * (0.85 + b2.S) * 100), 5, 300); };
        const hs = [
            { id: 'peak', x: tp, y: 1 + b.A, label: 'Amplitude ' + p.amp + '  ·  Duration ' + p.dur,
              drag: (x, y) => { p.amp = clamp(R((y - 1) * 100), 1, 100); tempo(clamp(x, 0.01, 1) / 0.85); } },
            { id: 'dip', x: tp + h0, y: 1 - b.A * b.r, label: 'Decay Y ' + p.dy + '  ·  Duration ' + p.dur,
              drag: (x, y) => { const r = clamp((1 - y) / b.A, 0.02, 0.99); p.dy = clamp(R((1 - r) * 100), 1, 98); tempo(clamp(x, 0.02, 1) / 1.85); } }
        ];
        if (b.n >= 3) hs.push({ id: 'swing', x: tp + h0 + h0 * b.q, y: 1 + b.A * b.r * b.r, label: 'Decay X ' + p.dx + '  ·  Decay Y ' + p.dy,
            drag: (x, y) => {
                const q = clamp((x - tp - h0) / h0, 0.1, 1); p.dx = clamp(R((1 - q) * 100), 0, 90);
                const r = clamp(Math.sqrt(Math.max(0.0001, y - 1) / b.A), 0.02, 0.99); p.dy = clamp(R((1 - r) * 100), 1, 98);
                const b2 = elBase(p); p.dur = clamp(R(h0 * (0.85 + b2.S) * 100), 5, 300);   // keeps the first swing where it is
            } });
        hs.push({ id: 'hang', arm: true, x: tp, y: 1 + b.A, label: 'Hang ' + p.hang });
        return { knots: k, handles: hs };
    }

    // ------------------------------------------------------------------ Bounce
    const bN = p => 1 + R(p.bnc / 100 * 11);
    function bFit(p, n) {
        const A = clamp(p.amp / 100 * 0.95, 0.01, 0.95), qy = 1 - p.dy / 100, qx = 1 - p.dx / 100, t1 = 0.08 + (1 - p.grav / 100) * 0.42;
        const L = [];
        let u = t1;
        for (let k = 0; k < n; k++) {
            const h = A * Math.pow(qy, k), d = t1 * Math.sqrt(h) * Math.pow(qx, k);
            if (u + d > 1 + 1e-9) break;                       // only bounces that fit before the second key
            L.push({ s: u, d: d, h: h }); u += d;
        }
        return { A: A, t1: t1, L: L };
    }
    function buildBounce(p) {
        const f = bFit(p, bN(p)), B = infB(p.hang), t1 = f.t1;
        const k = [K(0, 0, 0, 0, 0, QUAD)];
        let imp = K(t1, 1, 2 / t1, 0, QUAD, QUAD);
        k.push(imp);
        f.L.forEach(b => {
            imp.so = -4 * b.h / b.d;
            k.push(K(b.s + b.d / 2, 1 - b.h, 0, 0, B, B));
            imp = K(b.s + b.d, 1, 4 * b.h / b.d, 0, QUAD, QUAD);
            k.push(imp);
        });
        if (imp.u > 1 - 1e-6) { imp.u = 1; imp.io = 0; } else { imp.so = 0; k.push(K(1, 1, 0, 0, QUAD, 0)); }
        const setT1 = t => { p.grav = clamp(R((1 - (clamp(t, 0.08, 0.5) - 0.08) / 0.42) * 100), 1, 100); };
        const hs = [{ id: 'land', x: t1, y: 1, label: 'Gravity ' + p.grav, drag: x => setT1(x) }];
        const b0 = f.L[0], b1 = f.L[1];
        if (b0) {
            hs.push({ id: 'apex', x: b0.s + b0.d / 2, y: 1 - b0.h, label: 'Amplitude ' + p.amp + '  ·  Gravity ' + p.grav,
                drag: (x, y) => { p.amp = clamp(R((1 - y) / 0.95 * 100), 1, 100); const A = clamp(p.amp / 100 * 0.95, 0.01, 0.95); setT1(x / (1 + Math.sqrt(A) / 2)); } });
        }
        if (b1) {
            hs.push({ id: 'apex2', x: b1.s + b1.d / 2, y: 1 - b1.h, label: 'Decay Y ' + p.dy + '  ·  Decay X ' + p.dx,
                drag: (x, y) => {
                    const qy = clamp((1 - y) / f.A, 0.05, 1); p.dy = clamp(R((1 - qy) * 100), 0, 95);
                    const qx = clamp(2 * (x - t1 - b0.d) / (t1 * Math.sqrt(f.A * qy)), 0.05, 1.6); p.dx = clamp(R((1 - qx) * 100), -60, 95);
                } });
        }
        if (b0) {
            const last = f.L[f.L.length - 1];
            hs.push({ id: 'rest', x: last.s + last.d, y: 1, label: 'Bounciness ' + p.bnc,
                drag: x => {
                    let best = 1, bd = Infinity;
                    for (let n = 1; n <= 12; n++) {
                        const g = bFit(p, n), e = g.L.length ? g.L[g.L.length - 1].s + g.L[g.L.length - 1].d : g.t1;
                        if (Math.abs(e - x) < bd - 1e-9) { bd = Math.abs(e - x); best = n; }
                    }
                    p.bnc = clamp(R((best - 1) / 11 * 100), 1, 100);
                } });
            hs.push({ id: 'hang', arm: true, x: b0.s + b0.d / 2, y: 1 - b0.h, label: 'Hang ' + p.hang });
        }
        return { knots: k, handles: hs };
    }

    // ------------------------------------------------------------------ Cyclic
    function buildCyclic(p) {
        const N = 2 * p.cyc + 1, hs = p.start / 100, le = p.end / 100, I = infE(p.hang), k = [];
        for (let i = 0; i <= N; i++) k.push(K(i / N, i % 2 === 0 ? le * i / N : hs + (1 - hs) * i / N, 0, 0, i ? I : 0, i < N ? I : 0));
        const cyc = Nf => clamp(R((Nf - 1) / 2), 1, 15);
        return { knots: k, handles: [
            { id: 'first', x: 1 / N, y: hs + (1 - hs) / N, label: 'Cycles ' + p.cyc + '  ·  Start ' + p.start,
              drag: (x, y) => { p.cyc = cyc(1 / clamp(x, 0.02, 1)); const u = 1 / (2 * p.cyc + 1); p.start = clamp(R((y - u) / (1 - u) * 100), 0, 150); } },
            { id: 'last', x: (N - 1) / N, y: le * (N - 1) / N, label: 'Cycles ' + p.cyc + '  ·  End ' + p.end,
              drag: (x, y) => { p.cyc = cyc(1 / clamp(1 - x, 0.02, 1)); const u = 1 - 1 / (2 * p.cyc + 1); p.end = clamp(R(y / u * 100), -50, 100); } },
            { id: 'hang', arm: true, x: 1 / N, y: hs + (1 - hs) / N, label: 'Hang ' + p.hang }
        ] };
    }

    // ------------------------------------------------------------------ Steps
    function buildSteps(p, rev) {
        const n = p.steps, s = p.smooth / 100, k = [];
        if (s < 0.02) {
            if (!rev) {
                // held levels 0, 1/n ... (n-1)/n; the jump to the last value lands on the second key
                k.push(K(0, 0, 0, 0, 0, 0, 1));
                for (let j = 1; j < n; j++) k.push(K(j / n, j / n, 0, 0, 0, 0, 1));
                k.push(K(1, 1, 0, 0, 0, 0));
            } else {
                // reversed: the first jump happens right away (one frame after the first key)
                k.push(K(0, 0, 0, 0, 0, 0, 2));
                const f = K(0.012, 1 / n, 0, 0, 0, 0, 1); f.frame = true; k.push(f);
                for (let j = 1; j < n; j++) k.push(K(j / n, (j + 1) / n, 0, 0, 0, j < n - 1 ? 0 : QUAD, j < n - 1 ? 1 : 0));
                k.push(K(1, 1, 0, 0, QUAD, 0));
                k.noMirror = true;
            }
        } else {
            const RAMP = 0.45;
            k.push(K(0, 0, 0, 0, 0, QUAD));
            for (let j = 1; j <= n; j++) {
                const a = j / n - s / n, last = k[k.length - 1];
                if (a - last.u > 1e-6) k.push(K(a, (j - 1) / n, 0, 0, QUAD, RAMP)); else last.io = RAMP;
                k.push(K(j / n, j / n, 0, 0, RAMP, j < n ? QUAD : 0));
            }
        }
        return { knots: k, handles: [
            { id: 'count', x: (n - 1) / n, y: (n - 1) / n, label: 'Steps ' + n, drag: x => { p.steps = clamp(R(1 / Math.max(0.02, 1 - x)), 2, 24); } },
            { id: 'smooth', x: 1 / n - s / n, y: 0, label: 'Smoothness ' + p.smooth, drag: x => { p.smooth = clamp(R((1 / n - x) * n * 100), 0, 100); if (p.smooth < 4) p.smooth = 0; } }
        ] };
    }

    // ------------------------------------------------------------------ Elastic Steps
    function buildElasticSteps(p) {
        const n = p.steps, A = 0.8 * p.amp / 100, r = clamp(1 - p.decay / 100, 0.02, 0.99), I = infE(p.hang);
        const D = 1 / (n - 1), L = j => j / (n - 1), rise = 0.2 / n, hp = 0.13 / n;
        const k = [K(0, 0, 0, 0, 0, QUAD)];
        for (let j = 1; j < n; j++) {
            const tj = j / n, next = j < n - 1 ? (j + 1) / n : 1;
            k.push(K(tj, L(j - 1), 0, 0, QUAD, 0.42));
            if (A < 0.01) { k.push(K(tj + rise, L(j), 0, 0, 0.42, QUAD)); continue; }
            let u = tj + rise, amp = A, sign = 1;
            k.push(K(u, L(j) + A * D, 0, 0, 0.42, I));
            for (let i = 0; i < 40; i++) {
                u += hp; amp *= r; sign = -sign;
                if (amp * D < 0.002 || u > next - hp * 0.6) break;
                k.push(K(u, L(j) + sign * amp * D, 0, 0, I, I));
            }
        }
        k.push(K(1, 1, 0, 0, SINE, 0));
        const tl = (n - 1) / n + rise;
        const hs = [{ id: 'peak', x: tl, y: 1 + A * D, label: 'Steps ' + n + '  ·  Amplitude ' + p.amp,
            drag: (x, y) => { p.steps = clamp(R(0.8 / Math.max(0.02, 1 - x)), 2, 12); const D2 = 1 / (p.steps - 1); p.amp = clamp(R((y - 1) / D2 / 0.8 * 100), 0, 100); } }];
        if (A >= 0.01) {
            hs.push({ id: 'dip', x: tl + hp, y: 1 - A * r * D, label: 'Decay ' + p.decay,
                drag: (x, y) => { const rr = clamp((1 - y) / (A * D), 0.02, 0.99); p.decay = clamp(R((1 - rr) * 100), 0, 95); } });
            hs.push({ id: 'hang', arm: true, x: tl, y: 1 + A * D, label: 'Hang ' + p.hang });
        }
        return { knots: k, handles: hs };
    }

    // ------------------------------------------------------------------ Random
    function rng(seed) {   // small deterministic generator, so the preview and the baked keys match
        let a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    const env = u => 0.35 + 0.65 * u;
    function buildRandom(p) {
        const m = R(6 + p.density / 100 * 74), e = p.traj / 100, amp = p.amount / 100, rnd = rng(1234 + p.seed), pts = [{ u: 0, v: 0 }];
        for (let i = 1; i <= m; i++) {
            const j = rnd() - 0.5, u = i / (m + 1) + j * 0.6 / (m + 1);
            pts.push({ u: u, v: e * u + (rnd() * 2 - 1) * amp * env(u) });
        }
        pts.push({ u: 1, v: 1 });
        // straight segments: each key's speeds are the slopes towards its neighbours
        const k = pts.map((q, i) => {
            const si = i ? (q.v - pts[i - 1].v) / (q.u - pts[i - 1].u) : 0;
            const so = i < pts.length - 1 ? (pts[i + 1].v - q.v) / (pts[i + 1].u - q.u) : 0;
            return K(q.u, q.v, si, so, i ? QUAD : 0, i < pts.length - 1 ? QUAD : 0);
        });
        const band = [];
        for (let i = 0; i <= 24; i++) { const u = i / 24; band.push([u, e * u + amp * env(u), e * u - amp * env(u)]); }
        const ud = 5 / (m + 1);
        return { knots: k, band: band, handles: [
            { id: 'amount', x: 0.5, y: 0.5 * e + amp * env(0.5), label: 'Amount ' + p.amount, drag: (x, y) => { p.amount = clamp(R((y - 0.5 * e) / env(0.5) * 100), 0, 100); } },
            { id: 'density', x: ud, y: e * ud, label: 'Density ' + p.density, drag: x => { const mm = clamp(R(5 / Math.max(0.01, x) - 1), 6, 80); p.density = clamp(R((mm - 6) / 74 * 100), 0, 100); } },
            { id: 'traj', x: 1, y: e, label: 'Trajectory ' + p.traj, drag: (x, y) => { p.traj = clamp(R(y * 100), -50, 150); } }
        ] };
    }

    // ------------------------------------------------------------------ registry
    const P = (k, label, min, max, def, hidden) => ({ k: k, label: label, min: min, max: max, def: def, hidden: !!hidden });
    const MODELS = {
        elastic: { name: 'Elastic', build: buildElastic, params: [P('amp', 'Amplitude', 1, 100, 26), P('dur', 'Duration', 5, 300, 60), P('dx', 'Decay X', 0, 90, 25), P('dy', 'Decay Y', 1, 98, 50), P('hang', 'Hang', 0, 100, 50)] },
        bounce: { name: 'Bounce', build: buildBounce, params: [P('bnc', 'Bounciness', 1, 100, 50), P('amp', 'Amplitude', 1, 100, 50), P('grav', 'Gravity', 1, 100, 50), P('dy', 'Decay Y', 0, 95, 50), P('dx', 'Decay X', -60, 95, 1), P('hang', 'Hang', 0, 100, 75)] },
        cyclic: { name: 'Cyclic', build: buildCyclic, params: [P('cyc', 'Cycles', 1, 15, 3), P('start', 'Start', 0, 150, 100), P('end', 'End', -50, 100, 0), P('hang', 'Hang', 0, 100, 50)] },
        steps: { name: 'Steps', build: buildSteps, params: [P('steps', 'Steps', 2, 24, 4), P('smooth', 'Smoothness', 0, 100, 0)] },
        elasticsteps: { name: 'Elastic Steps', build: buildElasticSteps, params: [P('steps', 'Steps', 2, 12, 3), P('amp', 'Amplitude', 0, 100, 50), P('decay', 'Decay', 0, 95, 65), P('hang', 'Hang', 0, 100, 50)] },
        random: { name: 'Random', build: buildRandom, params: [P('amount', 'Amount', 0, 100, 35), P('density', 'Density', 0, 100, 40), P('traj', 'Trajectory', -50, 150, 100), P('seed', 'Seed', 0, 999999, 0, true)] }
    };
    const defParams = m => { const o = {}; MODELS[m].params.forEach(q => { o[q.k] = q.def; }); return o; };
    function assignKnown(m, target, src) {
        if (!src) return;
        MODELS[m].params.forEach(q => { if (typeof src[q.k] === 'number' && isFinite(src[q.k])) target[q.k] = clamp(R(src[q.k]), q.min, q.max); });
    }

    // ------------------------------------------------------------------ state
    function defaults() { const s = { mode: 'bezier', rev: false }; Object.keys(MODELS).forEach(m => { s[m] = defParams(m); }); return s; }
    let st = load();
    function load() {
        const s = defaults();
        try {
            const o = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (o && typeof o === 'object') {
                if (o.mode === 'bezier' || MODELS[o.mode]) s.mode = o.mode;
                s.rev = !!o.rev;
                Object.keys(MODELS).forEach(m => assignKnown(m, s[m], o[m]));
            }
        } catch (e) {}
        return s;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
    const model = () => MODELS[st.mode] || null;

    function mirrorKnots(k) { return k.slice().reverse().map(q => K(1 - q.u, 1 - q.v, q.so, q.si, q.io, q.ii, 0)); }
    // the shape as drawn: knots, handles and band (mirrored when reversed)
    function shapeFor(s) {
        const M = MODELS[s.mode]; if (!M) return null;
        const b = M.build(s[s.mode], s.rev);
        if (!s.rev) return b;
        const f = (x, y) => ({ x: 1 - x, y: 1 - y });
        return {
            knots: b.knots.noMirror ? b.knots : mirrorKnots(b.knots),
            band: b.band && b.band.map(r => [1 - r[0], 1 - r[2], 1 - r[1]]),
            handles: b.handles.map(h => Object.assign({}, h, f(h.x, h.y)))
        };
    }
    const shape = () => shapeFor(st);
    function viewRange(sh, noPad) {
        sh = sh || shape();
        let lo = 0, hi = 1;
        sh.knots.forEach(q => { lo = Math.min(lo, q.v); hi = Math.max(hi, q.v); });
        sh.handles.forEach(h => { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); });
        (sh.band || []).forEach(r => { lo = Math.min(lo, r[2]); hi = Math.max(hi, r[1]); });
        if (noPad) return [lo, hi];
        const pad = 0.07 * (hi - lo) + 0.03;   // room for the handles and their labels
        return [lo - pad, hi + pad];
    }

    // ------------------------------------------------------------------ public API for tab-graph.js
    let frozen = null, camAnim = null, drag = null, hover = null, lastM = null, lastPx = [];
    const api = {
        active: () => !!model(),
        mode: () => st.mode,
        name: () => (model() ? model().name : 'Bezier'),
        reversed: () => st.rev,
        range: () => frozen || viewRange(),
        draw: draw,
        apply: apply,
        summary: summary,
        openMenu: openMenu,
        snapshot: () => ({ mode: st.mode, rev: st.rev, p: Object.assign({}, st[st.mode] || {}) }),
        load: sh => { if (!sh || !MODELS[sh.mode]) return; st.rev = !!sh.rev; st[sh.mode] = defParams(sh.mode); assignKnown(sh.mode, st[sh.mode], sh.p); setMode(sh.mode); autoApply(); },
        setMode: m => setMode(m),
        reverse: () => { if (!model()) return; st.rev = !st.rev; save(); setMode(st.mode); autoApply(); },
        reset: () => { if (!model()) return; st[st.mode] = defParams(st.mode); st.rev = false; setMode(st.mode); save(); autoApply(); },
        miniSVG: miniSVG
    };
    window.RFXGraphCurves = api;

    function summary() {
        const sh = shape(); if (!sh) return '';
        const extra = Math.max(0, sh.knots.length - 2);
        return model().name + (st.rev ? ' (reversed)' : '') + '  ·  ' + (extra ? extra + ' key' + (extra === 1 ? '' : 's') + ' added' : 'no extra keys');
    }

    // ------------------------------------------------------------------ drawing
    function pathD(k, toPx) {
        let d = '';
        k.forEach((q, i) => {
            const P0 = toPx(q.u, q.v);
            if (!i) { d = 'M ' + P0.x + ',' + P0.y; return; }
            const a = k[i - 1], du = q.u - a.u;
            if (a.seg === 1) { const H = toPx(q.u, a.v); d += ' L ' + H.x + ',' + H.y + ' L ' + P0.x + ',' + P0.y; return; }
            if (a.seg === 2) { d += ' L ' + P0.x + ',' + P0.y; return; }
            const c1 = toPx(a.u + a.io * du, a.v + a.so * a.io * du), c2 = toPx(q.u - q.ii * du, q.v - q.si * q.ii * du);
            d += ' C ' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + P0.x + ',' + P0.y;
        });
        return d;
    }
    const toPxFn = m => (u, v) => ({ x: m.offsetX + u * m.drawW, y: m.offsetY + m.drawH * m.rangeY - (v - m.minValY) * m.drawH });
    function local(e) { const r = lastM.svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    const armDir = () => (st.rev ? -1 : 1);

    function ensureLayer(svg) {
        let g = document.getElementById('gx-shape');
        if (g && g.ownerSVGElement === svg) return g;
        const NS = 'http://www.w3.org/2000/svg';
        g = document.createElementNS(NS, 'g'); g.id = 'gx-shape';
        g.innerHTML = '<path class="gx-band"/><path class="gx-baseline" fill="none" stroke-width="1.5" stroke-dasharray="4 4"/>' +
            '<path class="gx-curve gx-shape-curve" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<g class="gx-shape-knots"></g><g class="gx-shape-handles"></g><g class="gx-tip"><rect rx="6" ry="6"/><text/></g>' +
            '<text class="gx-hint"></text>';
        svg.appendChild(g);
        svg.addEventListener('pointerdown', e => {
            if (!api.active() || e.button !== 0 || !lastM) return;
            const i = hitTest(local(e));
            if (i === null) return;
            e.preventDefault(); e.stopPropagation();
            closeMenu();
            frozen = viewRange();
            drag = { id: lastPx[i].id, pid: e.pointerId };
            hover = drag.id;
            try { svg.setPointerCapture(e.pointerId); } catch (err) {}
            svg.style.cursor = 'grabbing';
            redraw();
        });
        svg.addEventListener('pointermove', e => {
            if (!api.active() || !lastM) return;
            if (drag) { moveDrag(e); return; }
            const i = hitTest(local(e)), id = i === null ? null : lastPx[i].id;
            svg.style.cursor = id ? 'grab' : '';
            if (id !== hover) { hover = id; redraw(); }
        });
        svg.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; redraw(); } });
        svg.addEventListener('pointerup', endDrag);
        svg.addEventListener('pointercancel', endDrag);
        return g;
    }
    function hitTest(pos) {
        let best = null, bd = HIT;
        lastPx.forEach((h, i) => { const d = Math.hypot(h.px - pos.x, h.py - pos.y) - (h.arm ? 2 : 0); if (d < bd) { bd = d; best = i; } });
        return best;
    }

    function draw(m, valueDisplay) {
        lastM = m;
        const g = ensureLayer(m.svg), toPx = toPxFn(m), sh = shape(), p = st[st.mode];
        g.querySelector('.gx-shape-curve').setAttribute('d', pathD(sh.knots, toPx));
        // Random: the band the noise stays in, and its middle line
        const band = g.querySelector('.gx-band'), base = g.querySelector('.gx-baseline');
        if (sh.band) {
            const top = sh.band.map(r => toPx(r[0], r[1])), bot = sh.band.map(r => toPx(r[0], r[2])).reverse();
            band.setAttribute('d', 'M ' + top.concat(bot).map(q => q.x + ',' + q.y).join(' L ') + ' Z');
            base.setAttribute('d', 'M ' + sh.band.map(r => { const q = toPx(r[0], (r[1] + r[2]) / 2); return q.x + ',' + q.y; }).join(' L '));
        } else { band.setAttribute('d', ''); base.setAttribute('d', ''); }
        // the keyframes Apply will add
        g.querySelector('.gx-shape-knots').innerHTML = sh.knots.slice(1, -1).map(q => { const P0 = toPx(q.u, q.v); return '<circle class="gx-knot" cx="' + P0.x + '" cy="' + P0.y + '" r="2"/>'; }).join('');
        // handles (arms after the main handles so they stay on top of them)
        lastPx = [];
        let html = '';
        sh.handles.slice().sort((a, b) => (a.arm ? 1 : 0) - (b.arm ? 1 : 0)).forEach(h => {
            const base0 = toPx(h.x, h.y), on = hover === h.id || (drag && drag.id === h.id);
            if (h.arm) {
                const L = ARM0 + p.hang * ARMK, x2 = base0.x + armDir() * L;
                html += '<line class="gx-arm-line" x1="' + base0.x + '" y1="' + base0.y + '" x2="' + x2 + '" y2="' + base0.y + '" stroke-width="1.5" stroke-linecap="round"/>' +
                    '<circle data-id="' + h.id + '" class="gx-handle gx-handle-sm' + (on ? ' is-on' : '') + '" cx="' + x2 + '" cy="' + base0.y + '" r="' + (on ? 5.5 : 4.5) + '" stroke-width="2"/>';
                lastPx.push({ id: h.id, arm: true, px: x2, py: base0.y, bx: base0.x, h: h });
            } else {
                html += '<circle data-id="' + h.id + '" class="gx-handle' + (on ? ' is-on' : '') + '" cx="' + base0.x + '" cy="' + base0.y + '" r="' + (on ? 8 : 6.5) + '" stroke-width="2.5"/>';
                lastPx.push({ id: h.id, px: base0.x, py: base0.y, h: h });
            }
        });
        g.querySelector('.gx-shape-handles').innerHTML = html;
        drawTip(g, m);
        const hint = g.querySelector('.gx-hint');
        let seen = false; try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (e) {}
        hint.textContent = seen ? '' : 'Drag the handles  ·  right-click for all settings';
        hint.setAttribute('x', 10); hint.setAttribute('y', m.rawH - 10);
        if (valueDisplay) valueDisplay.textContent = summary();
    }
    // what the hovered / dragged handle changes, with the values
    function drawTip(g, m) {
        const tip = g.querySelector('.gx-tip'), id = drag ? drag.id : hover, h = lastPx.find(q => q.id === id);
        if (!h) { tip.style.display = 'none'; return; }
        tip.style.display = '';
        const text = tip.querySelector('text'), rect = tip.querySelector('rect');
        text.textContent = h.h.label;
        const w = text.getComputedTextLength() + 16, H = 22;
        let x = clamp(h.px - w / 2, 4, m.rawW - w - 4), y = h.py - H - 14;
        if (y < 4) y = h.py + 14;
        rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', w); rect.setAttribute('height', H);
        text.setAttribute('x', x + 8); text.setAttribute('y', y + 15);
    }

    function moveDrag(e) {
        if (!drag || e.pointerId !== drag.pid) return;
        const m = lastM, pos = local(e), h = lastPx.find(q => q.id === drag.id);
        if (!h) return;
        const p = st[st.mode];
        if (h.arm) {
            p.hang = clamp(R(((pos.x - h.bx) * armDir() - ARM0) / ARMK), 0, 100);
        } else {
            let x = (pos.x - m.offsetX) / m.drawW, y = m.minValY + (m.offsetY + m.drawH * m.rangeY - pos.y) / m.drawH;
            if (st.rev) { x = 1 - x; y = 1 - y; }
            h.h.drag(x, y);
        }
        // grow the view only past its edge (no margin here: a margin would rescale the view under
        // the pointer on every move and send the handle running away)
        const r = viewRange(null, true);
        frozen = [Math.min(frozen[0], r[0]), Math.max(frozen[1], r[1])];
        redraw();
    }
    function endDrag() {
        if (!drag) return;
        try { lastM.svg.releasePointerCapture(drag.pid); } catch (err) {}
        drag = null; save();
        try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
        if (lastM) lastM.svg.style.cursor = hover ? 'grab' : '';
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

    // ------------------------------------------------------------------ right-click settings
    let menuEl = null;
    function closeMenu() {
        if (!menuEl) return;
        menuEl.remove(); menuEl = null;
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onEsc, true);
    }
    const onOutside = e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
    const onEsc = e => { if (e.key === 'Escape') closeMenu(); };
    function openMenu(x, y) {
        closeMenu();
        const M = model(); if (!M) return;
        const p = st[st.mode];
        const menu = document.createElement('div');
        menu.className = 'ctx-menu gx-curve-menu'; menu.id = 'gx-curve-menu';
        const title = document.createElement('div'); title.className = 'gx-cm-title'; title.textContent = M.name + (st.rev ? '  (reversed)' : '');
        menu.appendChild(title);
        const grid = document.createElement('div'); grid.className = 'gx-cm-grid';
        M.params.filter(q => !q.hidden).forEach(q => {
            const cell = document.createElement('label'); cell.className = 'gx-cm-cell';
            const head = document.createElement('div'); head.className = 'gx-cm-head';
            const name = document.createElement('span'); name.textContent = q.label;
            const val = document.createElement('span'); val.className = 'gx-cm-val'; val.textContent = p[q.k];
            head.appendChild(name); head.appendChild(val);
            const input = document.createElement('input');
            input.type = 'range'; input.className = 'main-slider'; input.min = q.min; input.max = q.max; input.step = 1; input.value = p[q.k];
            input.addEventListener('input', () => { p[q.k] = +input.value; val.textContent = input.value; redraw(); });
            input.addEventListener('change', () => { save(); autoApply(); });
            cell.appendChild(head); cell.appendChild(input);
            grid.appendChild(cell);
        });
        menu.appendChild(grid);
        const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep);
        const item = (label, fn) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.textContent = label; it.addEventListener('click', () => { closeMenu(); fn(); }); menu.appendChild(it); };
        item('Reverse value', () => api.reverse());
        if (st.mode === 'random') item('New pattern', () => { p.seed = (p.seed + 1) % 1000000; save(); redraw(); autoApply(); });
        item('Reset ' + M.name, () => api.reset());
        item('Apply', () => apply(false));
        document.body.appendChild(menu);
        menuEl = menu;
        if (window.repositionMenu) window.repositionMenu(menu, x, y);
        else { menu.style.left = x + 'px'; menu.style.top = y + 'px'; }
        setTimeout(() => { document.addEventListener('pointerdown', onOutside, true); document.addEventListener('keydown', onEsc, true); }, 0);
    }

    // ------------------------------------------------------------------ apply to After Effects
    function apply(quiet) {
        const sh = shape(); if (!sh) return;
        const spec = sh.knots.map(q => [q.u, q.v, q.si, q.so, q.ii * 100, q.io * 100].map(n => +(+n).toFixed(6)).concat([q.seg, q.frame ? 1 : 0]).join(',')).join(';');
        graphJsx('graphApplyCurveKnots("' + spec + '", "' + model().name + '")', res => {
            if (!res || res.indexOf('ERROR') === 0) { if (!quiet || (res && res.indexOf('ERROR') === 0)) window.showToast && showToast(res ? res.replace('ERROR: ', '') : 'Could not apply the curve'); return; }
            const parts = String(res).split(' ');
            if (parts[0] === 'OK' && parts[1] === '0' && !quiet && window.showToast) showToast('Select two keyframes, or a property with keyframes');
        });
    }

    // ------------------------------------------------------------------ preset thumbnails
    function miniSVG(shp) {
        const s = defaults();
        s.mode = shp && MODELS[shp.mode] ? shp.mode : 'elastic';
        s.rev = !!(shp && shp.rev);
        assignKnown(s.mode, s[s.mode], shp && shp.p);
        const sh = shapeFor(s);
        let lo = 0, hi = 1;
        sh.knots.forEach(q => { lo = Math.min(lo, q.v); hi = Math.max(hi, q.v); });
        const w = 35, h = 35, p = 5, toPx = (u, v) => ({ x: p + u * w, y: (h + p) - v * h });
        const top = 40 - hi * 35 - 5, bottom = 40 - lo * 35 + 5;
        return '<svg viewBox="0 ' + top + ' 45 ' + (bottom - top) + '" width="100%" height="100%" style="overflow:visible; display:block;"><path class="gx-curve" d="' + pathD(sh.knots, toPx) + '" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    // ------------------------------------------------------------------ type row + reverse button
    function syncReverse() {
        const b = document.getElementById('graph-reverse-btn');
        if (b) b.classList.toggle('active', !!model() && st.rev);
    }
    function setMode(m) {
        if (m !== 'bezier' && !MODELS[m]) return;
        closeMenu();
        st.mode = m; save();
        hover = null;
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
