/* GRAPH TAB: curve types
   The type row at the top of the Graph tab picks what the graph edits. Bezier is the
   classic two-handle ease in js/tab-graph.js; the others are drawn and edited here.

   Controls: every handle sits on the curve, on the feature it changes, and that feature
   follows the pointer (grab the overshoot and pull it higher, grab a bounce and make it
   deeper). The short arm on a peak is its hang (how long the curve lingers there), like
   an AE influence handle. Hovering a handle names what it changes, with the values.
   Right-click the graph for every setting as a slider; each one can also be reached with
   the handles alone.
     Elastic        (Alight Motion model) top handle on the left edge, up / down = Amplitude;
                    bottom handle on the zero line, left / right = the first dip (Frequency)
     Bounce         (Alight Motion model) one handle anywhere = the bottom of the first rebound:
                    up / down = Bounciness, left / right = Gravity (timing)
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
    /* Same model as Alight Motion's elastic: it swings past the target every T (a half
       swing), and each swing's distance from the target is Amplitude x (1 - time), so the
       wobble dies out in a straight line exactly at the second key.
         top handle     on the left edge, up / down: Amplitude (its height above the target)
         bottom handle  on the zero line, left / right: the first dip, so T (Frequency = 1 / T)
       Right-click extras (defaults give exactly the curve above): Duration = where the
       wobble dies (100 = at the second key), Decay X = later swings get quicker, Decay Y =
       the wobble fades faster than a straight line, Hang = how round the peaks are. */
    function elCore(p) {
        const K0 = p.amp / 100, T = 1 / p.freq, q = clamp(1 - p.dx / 100, 0.1, 1), Dn = clamp(p.dur / 100, 0.1, 1), pw = 1 + p.dy / 20;
        return { K0: K0, T: T, q: q, E: t => K0 * Math.pow(Math.max(0, 1 - t / Dn), pw) };
    }
    function buildElastic(p) {
        const c = elCore(p), I = infE(p.hang);
        const k = [K(0, 0, 0, (1 + c.E(c.T)) / c.T, 0, QUAD)];
        let t = 0, h = c.T;
        for (let n = 1; n < 400; n++) {
            const tn = t + h;
            if (tn > 1 - 0.3 * h) break;
            const e = c.E(tn);
            if (n > 1 && e < 0.002) break;                 // settled: flat to the second key
            k.push(K(tn, 1 + (n % 2 ? 1 : -1) * e, 0, 0, n === 1 ? 0.42 : I, I));
            t = tn; h *= c.q;
        }
        k.push(K(1, 1, 0, 0, I, 0));
        const dipT = c.T * (1 + c.q), dipV = dipT <= 1 ? 1 - c.E(dipT) : 1;
        return { knots: k, handles: [
            { id: 'amp', x: 0, y: 1 + c.K0, lines: [[0, 1 + c.K0, 1, 1 + c.K0]], label: 'Amplitude ' + p.amp,
              drag: (x, y) => { p.amp = clamp(R((y - 1) * 100), 0, 120); } },
            { id: 'freq', x: dipT, y: 0, lines: [[dipT, 0, dipT, dipV]], label: 'Frequency ' + p.freq.toFixed(1),
              drag: x => { p.freq = clamp(R((1 + c.q) / Math.max(0.01, x) * 10) / 10, 1 + c.q, 50); } }
        ] };
    }

    // ------------------------------------------------------------------ Bounce
    /* Same model as Alight Motion's bounce, one handle that goes anywhere: it is the bottom of
       the first rebound. Its height sets how deep that rebound drops (d = Bounciness), its
       place in time sets the timing (the first landing is at x / (1 + d); Gravity).
       Every rebound is a parabola, d times as deep and d times as long as the one before (the
       first lasts 2 x landing time x d), up to 10 rebounds. When time runs out near or
       after a rebound's top, the curve is cut there and snaps to the second key's value on that key
       (it holds until one frame before it); otherwise it rests on the target.
       Right-click extras (defaults give exactly that): Decay X / Decay Y = rebounds get
       shorter / shallower faster, Hang = how round their tops are, Bounces = the limit. */
    function bnCore(p) {
        const d1 = clamp(p.bnc / 100, 0, 1), hx = clamp((101 - p.grav) / 100, 0.01, 1);
        return { d1: d1, hx: hx, t1: hx / (1 + d1), ry: d1 * (1 - p.dy / 100), rx: d1 * (1 - p.dx / 100) };
    }
    function buildBounce(p) {
        const c = bnCore(p), B = infB(p.hang), t1 = c.t1;
        const k = [K(0, 0, 0, 0, 0, QUAD)];
        let imp = K(t1, 1, 2 / t1, 0, QUAD, QUAD);
        k.push(imp);
        let s = t1, D = c.d1, d = 2 * t1 * c.d1, cut = false;
        for (let n = 0; n < p.maxb && s < 1 - 1e-6; n++) {
            if (D < 0.002 || d < 1e-4) break;                        // settled
            if (s + d <= 1 + 1e-9) {                                 // a whole rebound
                imp.so = -4 * D / d;
                k.push(K(s + d / 2, 1 - D, 0, 0, B, B));
                s += d;
                imp = K(s, 1, 4 * D / d, 0, QUAD, QUAD);
                k.push(imp);
            } else {
                if (s + d / 2 <= 1.03) {                              // near or past its top: cut at the end
                    const e = 0.012, w = (1 - e - s) / d;   // ~ one frame; in AE the key sits exactly one frame before
                    imp.so = -4 * D / d;
                    if (s + d / 2 < 1 - e - 0.005) k.push(K(s + d / 2, 1 - D, 0, 0, B, QUAD));
                    else imp.io = QUAD;
                    const cutK = K(1 - e, 1 - 4 * D * w * (1 - w), -4 * D * (1 - 2 * w) / d, 0, QUAD, 0, 1);
                    cutK.frame = 2;                                  // one frame before the second key
                    k.push(cutK);
                    cut = true;
                }
                break;
            }
            D *= c.ry; d *= c.rx;
        }
        if (!cut) {
            if (imp.u > 1 - 1e-6) { imp.u = 1; imp.io = 0; }
            else { imp.so = 0; k.push(K(1, 1, 0, 0, QUAD, 0)); }
        } else k.push(K(1, 1, 0, 0, 0, 0));
        const hy = 1 - c.d1;
        return { knots: k, handles: [
            { id: 'bounce', x: t1 * (1 + c.d1), y: hy, label: 'Bounciness ' + p.bnc.toFixed(1) + '  ·  Gravity ' + p.grav.toFixed(1),
              drag: (x, y) => { p.bnc = clamp(R((1 - clamp(y, 0, 1)) * 1000) / 10, 0, 100); p.grav = clamp(R((101 - clamp(x, 0.01, 1) * 100) * 10) / 10, 1, 100); } }
        ] };
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
                const f = K(0.012, 1 / n, 0, 0, 0, 0, 1); f.frame = 1; k.push(f);
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
    const P = (k, label, min, max, def, hidden, step) => ({ k: k, label: label, min: min, max: max, def: def, hidden: !!hidden, step: step || 1 });
    const MODELS = {
        elastic: { name: 'Elastic', build: buildElastic, view: [-0.15, 2.35],
            params: [P('amp', 'Amplitude', 0, 120, 60), P('freq', 'Frequency', 2, 50, 5, false, 0.1), P('dur', 'Duration', 10, 100, 100), P('dx', 'Decay X', 0, 90, 0), P('dy', 'Decay Y', 0, 100, 0), P('hang', 'Hang', 0, 100, 50)] },
        bounce: { name: 'Bounce', build: buildBounce, view: [-0.1, 1.25],
            params: [P('bnc', 'Bounciness', 0, 100, 80, false, 0.1), P('grav', 'Gravity', 1, 100, 74, false, 0.1), P('dx', 'Decay X', 0, 90, 0), P('dy', 'Decay Y', 0, 90, 0), P('hang', 'Hang', 0, 100, 75), P('maxb', 'Bounces', 1, 20, 10)] },
        cyclic: { name: 'Cyclic', build: buildCyclic, params: [P('cyc', 'Cycles', 1, 15, 3), P('start', 'Start', 0, 150, 100), P('end', 'End', -50, 100, 0), P('hang', 'Hang', 0, 100, 50)] },
        steps: { name: 'Steps', build: buildSteps, params: [P('steps', 'Steps', 2, 24, 4), P('smooth', 'Smoothness', 0, 100, 0)] },
        elasticsteps: { name: 'Elastic Steps', build: buildElasticSteps, params: [P('steps', 'Steps', 2, 12, 3), P('amp', 'Amplitude', 0, 100, 50), P('decay', 'Decay', 0, 95, 65), P('hang', 'Hang', 0, 100, 50)] },
        random: { name: 'Random', build: buildRandom, params: [P('amount', 'Amount', 0, 100, 35), P('density', 'Density', 0, 100, 40), P('traj', 'Trajectory', -50, 150, 100), P('seed', 'Seed', 0, 999999, 0, true)] }
    };
    const defParams = m => { const o = {}; MODELS[m].params.forEach(q => { o[q.k] = q.def; }); return o; };
    function assignKnown(m, target, src) {
        if (!src) return;
        MODELS[m].params.forEach(q => { if (typeof src[q.k] === 'number' && isFinite(src[q.k])) target[q.k] = clamp(R(src[q.k] / q.step) * q.step, q.min, q.max); });
    }

    // ------------------------------------------------------------------ state
    const VERSION = 3, MODEL_VERSION = { elastic: 2, bounce: 3 };
    function defaults() { const s = { v: VERSION, vm: Object.assign({}, MODEL_VERSION), mode: 'bezier', rev: false }; Object.keys(MODELS).forEach(m => { s[m] = defParams(m); }); return s; }
    let st = load();
    function load() {
        const s = defaults();
        try {
            const o = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (o && typeof o === 'object') {
                if (o.mode === 'bezier' || MODELS[o.mode]) s.mode = o.mode;
                s.rev = !!o.rev;
                const vm = Object.assign({}, o.vm || {});
                if (o.v === 2 && !o.vm) vm.elastic = 2;
                Object.keys(MODELS).forEach(m => { if (!MODEL_VERSION[m] || vm[m] === MODEL_VERSION[m]) assignKnown(m, s[m], o[m]); });
            }
        } catch (e) {}
        return s;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
    const model = () => MODELS[st.mode] || null;

    function mirrorKnots(k) {
        const N = k.length;
        return k.slice().reverse().map((q, j) => {
            const src = k[N - 2 - j], m = K(1 - q.u, 1 - q.v, q.so, q.si, q.io, q.ii, src ? (src.seg === 1 ? 2 : src.seg) : 0);
            if (q.frame) m.frame = q.frame === 2 ? 1 : 2;
            return m;
        });
    }
    // the shape as drawn: knots, handles and band (mirrored when reversed)
    function shapeFor(s) {
        const M = MODELS[s.mode]; if (!M) return null;
        const b = M.build(s[s.mode], s.rev);
        if (!s.rev) return b;
        const f = (x, y) => ({ x: 1 - x, y: 1 - y });
        return {
            knots: b.knots.noMirror ? b.knots : mirrorKnots(b.knots),
            band: b.band && b.band.map(r => [1 - r[0], 1 - r[2], 1 - r[1]]),
            handles: b.handles.map(h => Object.assign({}, h, f(h.x, h.y), { lines: h.lines && h.lines.map(l => [1 - l[0], 1 - l[1], 1 - l[2], 1 - l[3]]) }))
        };
    }
    const shape = () => shapeFor(st);
    function viewRange(sh, noPad) {
        const M = model();
        if (M && M.view) return st.rev ? [1 - M.view[1], 1 - M.view[0]] : M.view.slice();   // a fixed view: nothing rescales while dragging
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
    // a jump onto a key (a cut bounce snapping to the second key's value) is not part of the curve
    const snapEnd = k => k.length > 2 && k[k.length - 2].seg === 1 && k[k.length - 2].frame === 2;
    const snapStart = k => k.length > 2 && k[0].seg === 2 && k[1].frame === 1;
    function snapD(k, toPx) {
        let d = '';
        if (snapEnd(k)) { const a = toPx(1, k[k.length - 2].v), b = toPx(1, 1); d += 'M ' + a.x + ',' + a.y + ' L ' + b.x + ',' + b.y; }
        if (snapStart(k)) { const a = toPx(0, 0), b = toPx(0, k[1].v); d += ' M ' + a.x + ',' + a.y + ' L ' + b.x + ',' + b.y; }
        return d;
    }
    function pathD(k, toPx) {
        let d = '';
        const skipLast = snapEnd(k), skipFirst = snapStart(k);
        k.forEach((q, i) => {
            if (skipFirst && i === 0) return;
            if (skipLast && i === k.length - 1) return;
            const P0 = toPx(skipFirst && i === 1 ? 0 : (skipLast && i === k.length - 2 ? 1 : q.u), q.v);
            if (!d) { d = 'M ' + P0.x + ',' + P0.y; return; }
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
            '<path class="gx-snap" fill="none" stroke-width="1.5" stroke-dasharray="3 4"/><path class="gx-curve gx-shape-curve" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
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
        g.querySelector('.gx-snap').setAttribute('d', snapD(sh.knots, toPx));
        // Random: the band the noise stays in, and its middle line
        const band = g.querySelector('.gx-band'), base = g.querySelector('.gx-baseline');
        if (sh.band) {
            const top = sh.band.map(r => toPx(r[0], r[1])), bot = sh.band.map(r => toPx(r[0], r[2])).reverse();
            band.setAttribute('d', 'M ' + top.concat(bot).map(q => q.x + ',' + q.y).join(' L ') + ' Z');
            base.setAttribute('d', 'M ' + sh.band.map(r => { const q = toPx(r[0], (r[1] + r[2]) / 2); return q.x + ',' + q.y; }).join(' L '));
        } else { band.setAttribute('d', ''); base.setAttribute('d', ''); }
        // the keyframes Apply will add
        // the handles' guide lines (slider track, stem to the curve)
        g.querySelector('.gx-shape-knots').innerHTML = sh.handles.map(h => (h.lines || []).map(l => { const A = toPx(l[0], l[1]), B = toPx(l[2], l[3]); return '<line class="gx-ctl-line" x1="' + A.x + '" y1="' + A.y + '" x2="' + B.x + '" y2="' + B.y + '" stroke-width="2" stroke-linecap="round"/>'; }).join('')).join('');
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
            const fmt = v => (q.step < 1 ? (+v).toFixed(1) : String(v));
            const val = document.createElement('span'); val.className = 'gx-cm-val'; val.textContent = fmt(p[q.k]);
            head.appendChild(name); head.appendChild(val);
            const input = document.createElement('input');
            input.type = 'range'; input.className = 'main-slider'; input.min = q.min; input.max = q.max; input.step = q.step; input.value = p[q.k];
            input.addEventListener('input', () => { p[q.k] = +input.value; val.textContent = fmt(input.value); redraw(); });
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
        const spec = sh.knots.map(q => [q.u, q.v, q.si, q.so, q.ii * 100, q.io * 100].map(n => +(+n).toFixed(6)).concat([q.seg, q.frame || 0]).join(',')).join(';');
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
