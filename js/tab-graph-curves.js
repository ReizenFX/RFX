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
     Cyclic         (Alight Motion model) bottom handle = Frequency, right edge = End (baseline),
                    top handle = Tilt, the knob above it = Smoothness
     Steps          (Alight Motion model) bottom handle, left / right = Frequency (step length);
                    top handle, left / right = Smoothness (right above the bottom one = hard steps)
     Elastic Steps  (Alight Motion model) bottom handle, left / right = Frequency (step length);
                    right-edge handle, up / down = smooth steps (bottom) to sharp, ringing ones (top)
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
       first lasts 2 x landing time x d); they settle only once they have shrunk to nothing.
       A rebound still in the air at the end keeps the handle's rule and is cut at the end, as in
       Alight Motion. A key has to reach its value, so in AE the last frame moves straight onto the
       second key (a normal key one frame before it; no hold).
       Right-click extras (defaults give exactly that): Decay X / Decay Y = rebounds get
       shorter / shallower faster, Hang = how round their tops are. */
    function bnCore(p) {
        const d1 = clamp(p.bnc / 100, 0, 1), hx = clamp((101 - p.grav) / 100, 0.01, 1);
        return { d1: d1, hx: hx, t1: hx / (1 + d1), ry: d1 * (1 - p.dy / 100), rx: d1 * (1 - p.dx / 100) };
    }
    /* Smooth end: the rebounds keep the handle's depths, but their timing is stretched or squeezed a
       little so a landing falls exactly on the second key - whichever (one rebound more or less)
       needs the smaller change. The first rebound, where the handle sits, keeps its place unless it
       is the only one that reaches the end. */
    function buildBounceSmooth(p, c, B) {
        const t1 = c.t1, seq = [];
        let s = t1, D = c.d1, d = 2 * t1 * c.d1;
        for (let n = 0; n < 1000; n++) {
            if (D < 0.002 || d < 1e-4) break;
            seq.push({ D: D, d: d });
            s += d;
            if (s > 1 + 1e-9) break;
            D *= c.ry; d *= c.rx;
        }
        const ends = []; let acc = t1;
        seq.forEach(r => { acc += r.d; ends.push(acc); });
        let use = seq, g = 1, j0 = 1;
        const L = ends.length - 1;
        if (L >= 0 && ends[L] > 1 + 1e-9) {
            // A: keep the rebound that crosses the end, squeezed; B: drop it, stretch the rest
            const fit = (last) => {
                const j = last >= 1 ? 1 : 0, base = j ? ends[0] : t1, span = ends[last] - base;
                return span > 1e-9 ? { last: last, j: j, g: (1 - base) / span } : null;
            };
            const A = fit(L), Bo = L >= 1 ? fit(L - 1) : null;
            let pick = A;
            if (Bo && (!A || Math.abs(Math.log(Bo.g)) < Math.abs(Math.log(A.g)))) pick = Bo;
            if (!pick || pick.g < 0.35) { use = seq.slice(0, L); pick = null; }   // the only rebound would be squeezed too far: rest
            if (pick) { use = seq.slice(0, pick.last + 1); g = pick.g; j0 = pick.j; }
        }
        const k = [K(0, 0, 0, 0, 0, QUAD)];
        let imp = K(t1, 1, 2 / t1, 0, QUAD, QUAD);
        k.push(imp);
        let u = t1, valleyX = null;
        use.forEach((r, i) => {
            const dd = r.d * (i >= j0 ? g : 1);
            imp.so = -4 * r.D / dd;
            k.push(K(u + dd / 2, 1 - r.D, 0, 0, B, B));
            if (i === 0) valleyX = u + dd / 2;
            u += dd;
            imp = K(u, 1, 4 * r.D / dd, 0, QUAD, QUAD);
            k.push(imp);
        });
        if (imp.u > 1 - 1e-6) { imp.u = 1; imp.io = 0; }
        else { imp.so = 0; k.push(K(1, 1, 0, 0, QUAD, 0)); }
        return { knots: k, valleyX: valleyX };
    }
    function buildBounce(p) {
        if (p.smooth) {
            const c0 = bnCore(p), sm = buildBounceSmooth(p, c0, infB(p.hang));
            return { knots: sm.knots, handles: [
                { id: 'bounce', x: sm.valleyX !== null ? sm.valleyX : c0.t1 * (1 + c0.d1), y: 1 - c0.d1, label: 'Bounciness ' + p.bnc.toFixed(1) + '  \u00b7  Gravity ' + p.grav.toFixed(1),
                  drag: (x, y) => { p.bnc = clamp(R((1 - clamp(y, 0, 1)) * 1000) / 10, 0, 100); p.grav = clamp(R((101 - clamp(x, 0.01, 1) * 100) * 10) / 10, 1, 100); } }
            ] };
        }
        const c = bnCore(p), B = infB(p.hang), t1 = c.t1;
        const k = [K(0, 0, 0, 0, 0, QUAD)];
        let imp = K(t1, 1, 2 / t1, 0, QUAD, QUAD);
        k.push(imp);
        let s = t1, D = c.d1, d = 2 * t1 * c.d1;
        // rebounds shrink level by level until they are too shallow to see; every rebound follows
        // the handle's rule, including one still in the air at the end (cut there, like Alight Motion)
        let cut = false;
        for (let n = 0; n < 1000 && s < 1 - 1e-6; n++) {
            if (D < 0.002 || d < 1e-4) break;
            if (s + d <= 1 + 1e-9) {                                  // a whole rebound
                imp.so = -4 * D / d;
                k.push(K(s + d / 2, 1 - D, 0, 0, B, B));
                s += d;
                imp = K(s, 1, 4 * D / d, 0, QUAD, QUAD);
                k.push(imp);
            } else if (s < 1 - 1e-4) {                                 // still in the air at the end: the true shape, cut at the edge
                const w = (1 - s) / d;
                imp.so = -4 * D / d;
                if (s + d / 2 < 1 - 1e-4) k.push(K(s + d / 2, 1 - D, 0, 0, B, QUAD));
                else imp.io = QUAD;
                // the curve's own value and speed at the edge; in AE this key is placed one frame before
                // the second key (re-evaluated there from the same parabola) and the last frame moves
                // straight onto the key - a normal key, no hold
                const cutK = K(1, 1 - 4 * D * w * (1 - w), -4 * D * (1 - 2 * w) / d, 0, QUAD, 0, 2);
                cutK.frame = 3;
                k.push(cutK);
                cut = true;
                break;
            } else {                                                   // lands right at the end: on the second key
                const top = k[k.length - 2];
                imp.u = 1;
                if (top && top.v < 1 && top.u < 1) imp.si = 2 * (1 - top.v) / (1 - top.u);
                break;
            }
            D *= c.ry; d *= c.rx;
        }
        if (cut) k.push(K(1, 1, 0, 0, 0, 0));
        else if (imp.u > 1 - 1e-6) { imp.u = 1; imp.io = 0; }
        else { imp.so = 0; k.push(K(1, 1, 0, 0, QUAD, 0)); }
        const hy = 1 - c.d1;
        return { knots: k, handles: [
            { id: 'bounce', x: t1 * (1 + c.d1), y: hy, label: 'Bounciness ' + p.bnc.toFixed(1) + '  ·  Gravity ' + p.grav.toFixed(1),
              drag: (x, y) => { p.bnc = clamp(R((1 - clamp(y, 0, 1)) * 1000) / 10, 0, 100); p.grav = clamp(R((101 - clamp(x, 0.01, 1) * 100) * 10) / 10, 1, 100); } }
        ] };
    }

    // ------------------------------------------------------------------ Cyclic
    /* Same model as Alight Motion's cyclic, four handles:
         bottom handle (sideways)      the first trough = one cycle's length (Frequency)
         right-edge handle (up / down) where the baseline ends (End): every trough lies on the
                                       line from the start to it, every peak touches the target,
                                       so raising it makes the waves smaller towards the end
         top handle (sideways)         where the peak sits inside the cycle (Tilt): middle =
                                       symmetric waves, cycle end = rising sawtooth, start =
                                       falling sawtooth
         knob above it (sideways)      Smoothness, from its place in the first cycle: at the
                                       cycle's end = straight lines, at its start = fully rounded
       Each wave is squeezed between the baseline and the target (value = base + (1 - base) x
       wave), which is why a raised baseline bends even straight waves, as in Alight Motion.
       Smooth end (default on): the cycles after the first are stretched or squeezed a little so
       the curve finishes on a peak exactly at the second key (otherwise it is cut at the end). */
    const cyInf = s => QUAD + s * (0.4 - QUAD);
    const CY_EPS = 0.0015;
    // value / slope / influence split of the bezier segment A -> B at time u (the part A -> u);
    // the same maths as jsx/graph.jsx graphCurveSplit
    function splitSeg(A, B2, u) {
        const du = B2.u - A.u;
        const x0 = A.u, y0 = A.v, x3 = B2.u, y3 = B2.v;
        const x1 = A.u + A.io * du, y1 = A.v + A.so * A.io * du, x2 = B2.u - B2.ii * du, y2 = B2.v - B2.si * B2.ii * du;
        const bz = (p0, p1, p2, p3, s) => { const m = 1 - s; return m * m * m * p0 + 3 * m * m * s * p1 + 3 * m * s * s * p2 + s * s * s * p3; };
        let lo = 0, hi = 1;
        for (let i = 0; i < 50; i++) { const s = (lo + hi) / 2; if (bz(x0, x1, x2, x3, s) < u) lo = s; else hi = s; }
        const s = (lo + hi) / 2;
        const ax = x0 + (x1 - x0) * s, ay = y0 + (y1 - y0) * s, bx = x1 + (x2 - x1) * s, by = y1 + (y2 - y1) * s;
        const cx = x2 + (x3 - x2) * s, cy = y2 + (y3 - y2) * s;
        const dx = ax + (bx - ax) * s, dy = ay + (by - ay) * s, ex = bx + (cx - bx) * s, ey = by + (cy - by) * s;
        const px = dx + (ex - dx) * s, py = dy + (ey - dy) * s, nu = px - x0;
        return { v: py, si: px - dx > 1e-12 ? (py - dy) / (px - dx) : (ey - py) / Math.max(1e-12, ex - px), ii: nu > 1e-12 ? (px - dx) / nu : QUAD, aio: nu > 1e-12 ? (ax - x0) / nu : QUAD };
    }
    function cyCore(p) {
        const P0 = clamp(1 / p.freq, 0.02, 1), tau = p.tilt / 100;
        let fAll = 1, g = 1, landsOnPeak = false;
        if (p.smooth) {
            let best = null;
            const consider = (sc, gg, ff) => { if (!best || sc < best.sc) best = { sc: sc, g: gg, f: ff }; };
            // keep the first cycle (and so the handles) and fit the later ones
            if (P0 < 1 - 1e-6) for (let k = 1; k < 2000; k++) {
                const den = (k - 1 + tau) * P0;
                if (den <= 1e-9) continue;
                const gg = (1 - P0) / den;
                consider(Math.abs(Math.log(gg)), gg, 1);
                if (gg < 0.4) break;
            }
            // or scale everything (the handles move with it) - only when that is clearly closer
            for (let k = 0; k < 2000; k++) {
                const den = (k + tau) * P0;
                if (den <= 1e-9) continue;
                const ff = 1 / den;
                consider(Math.abs(Math.log(ff)) * 4 + 0.15, 1, ff);   // rarely: the handles would leave the pointer
                if (ff < 0.4) break;
            }
            if (best) { g = best.g; fAll = best.f; landsOnPeak = true; }
        }
        return { P0: P0, tau: tau, s: p.soft / 100, B: p.end / 100, g: g, fAll: fAll, landsOnPeak: landsOnPeak };
    }
    function buildCyclic(p) {
        const c = cyCore(p), I = cyInf(c.s), sm = 1 - c.s, L = u => c.B * Math.min(u, 1), EPS = CY_EPS;   // the baseline stops at the edge
        const k = [K(0, 0, 0, 0, 0, I)];
        let cs = 0, last = k[0];
        // one cycle past the end too: a falling sawtooth reaches its last peak through the edge after it
        for (let cyc = 0, extra = 1; cyc < 4000; cyc++) {
            if (cs >= 1 - 1e-9 && extra-- <= 0) break;
            const len = (cyc === 0 ? c.P0 : c.P0 * c.g) * c.fAll, ra = c.tau * len, fb = len - ra;
            const pk = cs + ra, ce = cs + len;
            // rise: trough (last) -> peak
            if (ra < EPS) {
                last.seg = 2;
                const pkK = K(cs + EPS, 1, 0, 0, 0, I); pkK.frame = 5;   // a vertical edge (at least a frame in AE)
                k.push(pkK); last = pkK;
            } else {
                last.so = c.B + (1 - L(cs)) * sm / ra; last.io = I;
                const pkK = K(pk, 1, (1 - L(pk)) * sm / ra, 0, I, I);
                k.push(pkK); last = pkK;
            }
            // fall: peak -> next trough
            if (fb < EPS) {
                last.seg = 2;
                const trK = K(ce + EPS, L(ce), 0, 0, 0, I); trK.frame = 5;
                k.push(trK); last = trK;
            } else {
                last.so = (1 - L(pk)) * -sm / fb; last.io = I;
                const trK = K(ce, L(ce), c.B - (1 - L(ce)) * sm / fb, 0, I, I);
                k.push(trK); last = trK;
            }
            cs = ce;
        }
        // end: on a peak exactly at the second key (Smooth end), or cut at the edge
        let i = k.findIndex(q => q.u > 1 - 1e-7);
        if (i < 0) i = k.length - 1;
        if (c.landsOnPeak) {
            // the peak that lands on 1 (a falling sawtooth reaches it through its vertical edge)
            let j = i;
            while (j < k.length && k[j].v < 1 - 1e-9) j++;
            if (j >= k.length) j = i;
            const out = k.slice(0, j + 1);
            const endK = out[out.length - 1];
            if (endK.frame === 5 && out.length >= 2) {           // edge onto the final peak: its trough sits a frame before the key
                const tr = out[out.length - 2]; tr.u = 1 - EPS; tr.frame = 6; tr.seg = 2;   // 6: a frame before the key, on the curve, drawn
                endK.frame = 0;
            }
            endK.u = 1; endK.io = 0; endK.so = 0; endK.seg = 0;
            endK.v = 1;
            return { core: c, knots: out };
        }
        const A = k[i - 1], Bk = k[i];
        if (Math.abs(Bk.u - 1) < 1e-7 && !Bk.frame) {            // a knot right on the end
            const out = k.slice(0, i + 1); const e2 = out[out.length - 1];
            if (Math.abs(e2.v - 1) < 1e-9) { e2.u = 1; e2.io = 0; e2.seg = 0; return { core: c, knots: out }; }
            e2.u = 1; e2.seg = 2; e2.frame = 3; out.push(K(1, 1, 0, 0, 0, 0)); return { core: c, knots: out };
        }
        const out = k.slice(0, i);
        let cut;
        if (A.seg === 2) {                                        // inside a vertical edge
            cut = K(1, A.v + (Bk.v - A.v) * (1 - A.u) / Math.max(1e-9, Bk.u - A.u), 0, 0, 0, 0, 2);
        } else {
            const sp = splitSeg(A, Bk, 1);
            A.io = sp.aio;
            cut = K(1, sp.v, sp.si, 0, sp.ii, 0, 2);
        }
        cut.frame = 3;
        out.push(cut);
        out.push(K(1, 1, 0, 0, 0, 0));
        return { core: c, knots: out };
    }
    function buildCyclicShape(p) {
        const r = buildCyclic(p), c = r.core, P1 = c.P0 * c.fAll;
        const hx = c.tau * P1, wx = (1 - c.s) * P1;
        return { knots: r.knots, handles: [
            { id: 'freq', x: P1, y: 0, label: 'Frequency ' + p.freq.toFixed(2),
              drag: x => { p.freq = clamp(R(1 / clamp(x, 0.02, 1) * 100) / 100, 1, 50); } },
            { id: 'end', x: 1, y: c.B, lines: [[0, 0, 1, c.B]], label: 'End ' + p.end.toFixed(1),
              drag: (x, y) => { p.end = clamp(R(clamp(y, 0, 1) * 1000) / 10, 0, 100); } },
            { id: 'tilt', x: hx, y: 1, label: 'Tilt ' + p.tilt.toFixed(1),
              drag: x => { p.tilt = clamp(R(clamp(x / P1, 0, 1) * 1000) / 10, 0, 100); } },
            { id: 'soft', x: wx, y: 1.5, small: true, lines: [[hx, 1, wx, 1.5]], label: 'Smoothness ' + p.soft.toFixed(1),
              drag: x => { p.soft = clamp(R((1 - clamp(x / P1, 0, 1)) * 1000) / 10, 0, 100); } }
        ] };
    }

    // ------------------------------------------------------------------ Steps
    /* Same model as Alight Motion's steps: the move is cut into steps of equal length P, each one
       also P high, so the staircase follows the straight line from the first key to the second.
         bottom handle  on the zero line at the first step, left / right only: Frequency (1 / P)
         top handle     on the top line, left / right only: Smoothness. Right above the bottom
                        handle = hard steps; further right, each step becomes an S curve that
                        still arrives on time and starts that much earlier (at most a whole step).
       Smooth end (on by default): the first step stays at the handle and the rest are spread
       evenly so the last one reaches the target a whole step before the second key and holds
       there. Off: the last level holds and the second key jumps (a step still rising at the end
       is cut there). The jump onto the second key is not drawn. */
    function stJumps(p) {
        const P = 1 / p.freq, s = clamp(p.soft / 100, 0, 1), out = [];
        if (p.smooth) {
            const m = Math.max(1, R((1 - P) / P)), t1 = m === 1 ? Math.min(P, 0.9) : P, Q = (1 - t1) / m, wMax = Math.min(P, Q);
            for (let i = 0; i < m; i++) out.push({ b: t1 + i * Q, lo: i / m, hi: (i + 1) / m });
            return { J: out, w: s * wMax, wMax: wMax, t1: t1 };
        }
        const wMax = Math.min(P, 1 - P), w = s * wMax;
        for (let j = 1; j * P - w < 1 - 0.005; j++) {
            let bj = j * P, hi = Math.min(j * P, 1);                    // never past the target
            if (w < 1e-6 && bj > 1 - 0.02) break;                          // a hard step right at the end is the second key's
            if (w >= 1e-6 && Math.abs(bj - 1) < 0.01) { bj = 1; hi = 1; }   // a smooth one arrives on the second key
            out.push({ b: bj, lo: (j - 1) * P, hi: hi });
        }
        return { J: out, w: w, wMax: wMax, t1: P };
    }
    function buildSteps(p, rev) {
        const S = stJumps(p), J = S.J, w = S.w, RI = 0.55;
        let k;
        if (w < 1e-6 && rev) {
            // reversed hard steps, built directly (a hold only jumps forwards in time)
            const Ll = J.length ? J[J.length - 1].hi : 0;
            if (p.smooth) k = [K(0, 0, 0, 0, 0, 0, 1)];
            else { k = [K(0, 0, 0, 0, 0, 0, 2)]; const f1 = K(0.012, 1 - Ll, 0, 0, 0, 0, 1); f1.frame = 1; k.push(f1); }  // the first jump, one frame in
            for (let i = J.length - 1; i >= 0; i--) k.push(K(1 - J[i].b, 1 - J[i].lo, 0, 0, 0, 0, 1));
            k.push(K(1, 1, 0, 0, 0, 0));
            k.noMirror = true;
        } else if (w < 1e-6) {
            // hard steps: held levels
            k = [K(0, 0, 0, 0, 0, 0, 1)];
            J.forEach(r => k.push(K(r.b, r.hi, 0, 0, 0, 0, 1)));
            if (!p.smooth) k.jumpEnd = true;
            k.push(K(1, 1, 0, 0, 0, 0));
        } else {
            k = [K(0, 0, 0, 0, 0, QUAD)];
            let cut = false;
            for (const r of J) {
                const a0 = r.b - w, last = k[k.length - 1];
                let A;
                if (a0 - last.u > 1e-6) { A = K(a0, r.lo, 0, 0, QUAD, RI); k.push(A); } else { A = last; A.io = RI; }
                const B = K(r.b, r.hi, 0, 0, RI, QUAD);
                if (r.b > 1 + 1e-9) {
                    // still rising at the end: the true shape, cut at the edge (the jump onto the key is not drawn)
                    const sp = splitSeg(A, B, 1);
                    A.io = sp.aio;
                    const c = K(1, sp.v, sp.si, 0, sp.ii, 0, 2); c.frame = 3;
                    k.push(c);
                    cut = true;
                    break;
                }
                k.push(B);
            }
            const tail = k[k.length - 1];
            if (cut) k.push(K(1, 1, 0, 0, 0, 0));
            else if (tail.u > 1 - 1e-9) { tail.u = 1; tail.v = 1; tail.io = 0; }      // arrives on the second key
            else {
                tail.io = 0;
                if (!p.smooth) {
                    tail.seg = 1; k.jumpEnd = true;                                    // the last level holds; the second key jumps
                    if (rev && tail.u < 1 - 0.008) {
                        // reversed, the first jump has to happen right away: one frame after the first key
                        tail.seg = 0; tail.io = QUAD;
                        const h = K(1 - 0.004, tail.v, 0, 0, QUAD, 0, 1); h.frame = 6;
                        k.push(h);
                    }
                }
                k.push(K(1, 1, 0, 0, 0, 0));
            }
        }
        const t1 = S.t1, top1 = J.length ? J[0].hi : 1;
        return { knots: k, handles: [
            { id: 'freq', x: t1, y: 0, label: 'Frequency ' + p.freq.toFixed(2),
              drag: x => { p.freq = clamp(R(100 / clamp(x, 1 / 24, 1 / 1.05)) / 100, 1.05, 24); } },
            { id: 'soft', x: t1 + w, y: 1, lines: [[t1, top1, t1 + w, 1]], label: w > 0 ? 'Smoothness ' + p.soft.toFixed(1) : 'Hard steps',
              drag: x => { let v = clamp(R((x - t1) / Math.max(1e-6, S.wMax) * 1000) / 10, 0, 100); if (v < 2) v = 0; p.soft = v; } }
        ] };
    }

    // ------------------------------------------------------------------ Elastic Steps
    /* Same model as Alight Motion's elastic steps: the move is cut into steps of equal length P,
       each one also P high, so the staircase follows the straight line from the first key to the
       second (a jump at P, 2P, 3P ...; the last level holds and the second key makes the last jump).
         bottom handle  on the zero line at the first jump, left / right only: Frequency (1 / P)
         right handle   on the right edge, up / down only: all the way down = smooth steps (each
                        jump an S curve over half a step); going up, the jumps get quicker and
                        overshoot their level, then wobble back (a round, slow swing at first); at
                        the top each jump is sharp and rings quickly, like the Elastic graph.
       Smooth end (on by default): the first jump stays at the handle and the rest are spread evenly
       so the last one reaches the target a whole step before the second key and settles onto it.
       Off: a jump whose wobble would run past the second key is squeezed to settle before it.
       The curve stays inside the box: a swing that would pass the target is lowered so its peak
       just touches it. Right-click: Strength scales how far the steps overshoot. Reverse mirrors it. */
    function esCore(p) {
        // eased so the shape changes at an even pace from the very bottom of the handle (no sudden start)
        const P = 1 / p.freq, h = clamp(p.el / 100, 0, 1), ez = q => 1 - Math.pow(1 - h, q), kL = ez(3);
        return {
            P: P, h: h, kL: kL,
            A: 0.45 * ez(1.4) * p.str / 100,            // first overshoot, as a share of the step height
            trR: 0.5 - 0.465 * ez(1.8),                 // the jump's length (to its first peak), as a share of the step
            spR: 0.4 + 0.3 * h                          // the wobble has faded by here (from the jump), as a share of the step
        };
    }
    /* Where the jumps go: [time, level before, level after, the step's length].
       Smooth end off: every P, levels P, 2P ...; the last level holds and the second key jumps.
       Smooth end on: the first jump stays at P (the handle), the rest are spread evenly so the last
       one reaches the target a whole step before the second key and settles there. */
    function esJumps(p, c) {
        const P = c.P, out = [];
        if (!p.smooth) {
            for (let j = 1; 1 - j * P >= 0.02; j++) out.push([j * P, (j - 1) * P, j * P, P]);
            return out;
        }
        const m = Math.max(1, R((1 - P) / P)), t1 = m === 1 ? Math.min(P, 0.6) : P, Q = (1 - t1) / m;
        for (let i = 0; i < m; i++) out.push([t1 + i * Q, i / m, (i + 1) / m, Q]);
        return out;
    }
    function buildElasticSteps(p, rev) {
        const c = esCore(p), I = infE(50), J = esJumps(p, c);
        const ioJ = 0.6 - (0.6 - QUAD) * c.kL, iiP = 0.6 - (0.6 - 0.42) * c.kL;   // S curve -> sharp launch
        const k = [K(0, 0, 0, 0, 0, QUAD)];
        J.forEach((jp, j) => {
            const t0 = jp[0], lo = jp[1], hi = jp[2], Sl = jp[3], D = hi - lo, r = 1 - t0, lastJ = j === J.length - 1;
            // the shape scales with the step's length; a half swing is never shorter than 0.25% of the move
            // the wobble has faded out by the time the step runs out, so a swing always appears (and goes)
            // at zero size while the handle moves: no swing pops in or out
            // the last step with Smooth end settles by 94% of it, so no key crowds the second key
            const lim = (p.smooth && lastJ ? 0.94 : 0.98) * Sl, Tr = Math.max(c.trR * Sl, 0.0025), Sp = Math.min(Math.max(c.spR * Sl, 3.2 * Tr), lim - Tr);
            const E = tau => (Sp > Tr ? c.A * D * Math.pow(Math.max(0, (Sp - tau) / (Sp - Tr)), 1.6) : 0);
            // inside the box: a swing that would pass the target keeps its size, but its centre comes
            // down so the peak just touches the target (near the top it settles up into it)
            const room = 1 - hi, at = (e, sgn) => Math.max(0, hi + sgn * e - Math.max(0, e - room));
            // the jump's events at its natural timing: [time from the jump, value]
            const ev = [[Tr, at(c.A * D, 1)]];
            if (c.A >= 0.002) {
                for (let m = 2; ; m++) {
                    const tau = Tr * m;
                    if (tau >= Sp) break;
                    const e = E(tau);
                    if (e < 0.0015 * D) break;
                    ev.push([tau, at(e, m % 2 ? 1 : -1)]);
                }
                ev.push([Math.min(ev[ev.length - 1][0] + Tr, lim), hi]);   // settled
            }
            // Smooth end off: a step without room for itself is a smaller copy of a whole step, fitted into
            // 85% of what is left (scaled by the step, not by its wobble, so it changes smoothly with the handle)
            const end = ev[ev.length - 1][0], sc = p.smooth ? 1 : Math.min(1, 0.85 * r / lim);
            k.push(K(t0, lo, 0, c.kL * (ev[0][1] - lo) / (Tr * sc), QUAD, ioJ));
            ev.forEach((q, i) => { k.push(K(t0 + q[0] * sc, q[1], 0, 0, i ? I : iiP, i === ev.length - 1 ? 0 : I)); });
        });
        const tail = k[k.length - 1];
        if (p.smooth) {
            // lands on the target: flat into the second key, or the last swing settles on it
            const swing = Math.abs(tail.v - 1) > 1e-9;
            if (swing) tail.io = I;
            k.push(K(1, 1, 0, 0, swing ? I : 0, 0));
        } else {
            tail.io = 0; tail.seg = 1; k.jumpEnd = true;                  // the last level holds; the second key jumps (not drawn)
            if (rev && tail.u < 1 - 0.008) {
                // reversed, the first jump has to happen right away: one frame after the first key
                tail.seg = 0; tail.io = QUAD;
                const st = K(1 - 0.004, J.length ? J[J.length - 1][2] : 0, 0, 0, QUAD, 0, 1); st.frame = 6;
                k.push(st);
            }
            k.push(K(1, 1, 0, 0, 0, 0));
        }
        const arm = J.length > 1 ? [J[1][0], J[1][1]] : [J[0][0], 0];
        return { knots: k, handles: [
            { id: 'freq', x: J[0][0], y: 0, label: 'Frequency ' + p.freq.toFixed(2),
              drag: x => { p.freq = clamp(R(100 / clamp(x, 1 / 24, 1 / 1.05)) / 100, 1.05, 24); } },
            { id: 'elastic', x: 1, y: c.h, lines: [[arm[0], arm[1], 1, c.h]], label: c.h > 0 ? 'Elastic ' + p.el.toFixed(1) : 'Smooth steps',
              drag: (x, y) => { p.el = clamp(R(clamp(y, 0, 1) * 1000) / 10, 0, 100); } }
        ] };
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
            params: [P('bnc', 'Bounciness', 0, 100, 80, false, 0.1), P('grav', 'Gravity', 1, 100, 74, false, 0.1), P('dx', 'Decay X', 0, 90, 0), P('dy', 'Decay Y', 0, 90, 0), P('hang', 'Hang', 0, 100, 75), P('smooth', 'Smooth end', 0, 1, 1, true)] },
        cyclic: { name: 'Cyclic', build: buildCyclicShape, view: [-0.12, 1.65],
            params: [P('freq', 'Frequency', 1, 50, 3.2, false, 0.01), P('tilt', 'Tilt', 0, 100, 50, false, 0.1), P('soft', 'Smoothness', 0, 100, 0, false, 0.1), P('end', 'End', 0, 100, 0, false, 0.1), P('smooth', 'Smooth end', 0, 1, 1, true)] },
        steps: { name: 'Steps', build: buildSteps, view: [-0.1, 1.12],
            params: [P('freq', 'Frequency', 1.05, 24, 4, false, 0.01), P('soft', 'Smoothness', 0, 100, 0, false, 0.1), P('smooth', 'Smooth end', 0, 1, 1, true)] },
        elasticsteps: { name: 'Elastic Steps', build: buildElasticSteps,
            view: [-0.12, 1.12],   // the curve stays inside the box
            params: [P('freq', 'Frequency', 1.05, 24, 4, false, 0.01), P('el', 'Elastic', 0, 100, 100, false, 0.1), P('str', 'Strength', 0, 200, 100, false, 1), P('smooth', 'Smooth end', 0, 1, 1, true)] },
        random: { name: 'Random', build: buildRandom, params: [P('amount', 'Amount', 0, 100, 35), P('density', 'Density', 0, 100, 40), P('traj', 'Trajectory', -50, 150, 100), P('seed', 'Seed', 0, 999999, 0, true)] }
    };
    const defParams = m => { const o = {}; MODELS[m].params.forEach(q => { o[q.k] = q.def; }); return o; };
    function assignKnown(m, target, src) {
        if (!src) return;
        MODELS[m].params.forEach(q => { if (typeof src[q.k] === 'number' && isFinite(src[q.k])) target[q.k] = clamp(R(src[q.k] / q.step) * q.step, q.min, q.max); });
    }

    // ------------------------------------------------------------------ state
    const VERSION = 3, MODEL_VERSION = { elastic: 2, bounce: 3, cyclic: 2, elasticsteps: 5, steps: 2 };
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
            if (q.frame && q.frame !== 5) m.frame = { 1: 2, 2: 1, 3: 4, 4: 3, 6: 7, 7: 6 }[q.frame];
            const after = k[N - j];
            if (after && after.frame === 5) m.frame = 5;
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
            knots: b.knots.noMirror ? b.knots : Object.assign(mirrorKnots(b.knots), { jumpStart: !!b.knots.jumpEnd }),
            band: b.band && b.band.map(r => [1 - r[0], 1 - r[2], 1 - r[1]]),
            handles: b.handles.map(h => Object.assign({}, h, f(h.x, h.y), { lines: h.lines && h.lines.map(l => [1 - l[0], 1 - l[1], 1 - l[2], 1 - l[3]]) }))
        };
    }
    const shape = () => shapeFor(st);
    function viewRange(sh, noPad) {
        const M = model();
        if (M && M.view) {                                        // a fixed view: nothing rescales while dragging
            const v = typeof M.view === 'function' ? M.view(st[st.mode]) : M.view;
            return st.rev ? [1 - v[1], 1 - v[0]] : v.slice();
        }
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
    // a jump onto a key (a cut bounce snapping to the second key's value) is not drawn: the curve ends mid-air as in Alight Motion
    const snapEnd = k => k.length > 2 && k[k.length - 2].seg === 2 && k[k.length - 2].frame === 3;
    // a held last level jumping onto the second key (Steps / Elastic Steps, Smooth end off) is drawn up to the edge, without the jump
    const snapStart = k => k.length > 2 && k[0].seg === 2 && (k[1].frame === 1 || k[1].frame === 4 || !!k.jumpStart);
    function pathD(k, toPx) {
        let d = '';
        const skipLast = snapEnd(k), skipFirst = snapStart(k);
        k.forEach((q, i) => {
            if (skipFirst && i === 0) return;
            if (skipLast && i === k.length - 1) return;
            const P0 = toPx(skipFirst && i === 1 ? 0 : (skipLast && i === k.length - 2 ? 1 : q.u), q.v);
            if (!d) { d = 'M ' + P0.x + ',' + P0.y; return; }
            const a = k[i - 1], du = q.u - a.u;
            if (a.seg === 1) { const H = toPx(q.u, a.v); d += ' L ' + H.x + ',' + H.y + (k.jumpEnd && i === k.length - 1 ? '' : ' L ' + P0.x + ',' + P0.y); return; }
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
                const rr = h.small ? (on ? 6 : 5) : (on ? 8 : 6.5);
                html += '<circle data-id="' + h.id + '" class="gx-handle' + (h.small ? ' gx-handle-sm' : '') + (on ? ' is-on' : '') + '" cx="' + base0.x + '" cy="' + base0.y + '" r="' + rr + '" stroke-width="2.5"/>';
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
        syncChip();   // the graph area is rebuilt on its first draw: keep the chip in it
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

    // pointer moves arrive faster than the screen refreshes: keep the latest and draw once per frame
    let movePending = null, moveRaf = 0;
    function moveDrag(e) {
        if (!drag || e.pointerId !== drag.pid) return;
        movePending = local(e);
        if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
    }
    function flushMove() {
        moveRaf = 0;
        if (!drag || !movePending) return;
        const pos = movePending; movePending = null;
        applyDrag(pos);
    }
    function applyDrag(pos) {
        const m = lastM, h = lastPx.find(q => q.id === drag.id);
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
        if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = 0; }
        if (movePending) { const pos = movePending; movePending = null; applyDrag(pos); }   // the last position counts
        try { lastM.svg.releasePointerCapture(drag.pid); } catch (err) {}
        drag = null; save();
        try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
        if (lastM) lastM.svg.style.cursor = hover ? 'grab' : '';
        easeRangeTo(viewRange());
        autoApply();
    }
    function easeRangeTo(target) {
        if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }
        const M = model();
        if (!M || M.view) { frozen = null; redraw(); return; }   // a fixed view has nothing to ease
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
        if (hasSmoothEnd(st.mode)) item(p.smooth ? 'Smooth end: on' : 'Smooth end: off', () => toggleSmooth());
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
    const hasSmoothEnd = m => m === 'bounce' || m === 'cyclic' || m === 'steps' || m === 'elasticsteps';
    function toggleSmooth() {
        if (!hasSmoothEnd(st.mode)) return;
        const p = st[st.mode];
        p.smooth = p.smooth ? 0 : 1;
        save(); syncChip(); redraw(); autoApply();
    }
    function syncChip() {
        let chip = document.getElementById('gx-smooth-end');
        const area = document.getElementById('graph-editor-area');
        if (!chip && area) {
            chip = document.createElement('button');
            chip.id = 'gx-smooth-end';
            chip.className = 'gx-chip';
            chip.setAttribute('data-tooltip', 'Land exactly on the second key: no cut, no last-frame jump');
            chip.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18c3 0 4-12 7-12s3 8 5 8 3-4 6-4"/></svg><span>Smooth end</span>';
            chip.addEventListener('pointerdown', e => e.stopPropagation());
            chip.addEventListener('click', e => { e.stopPropagation(); toggleSmooth(); });
            area.appendChild(chip);
        }
        if (!chip) return;
        chip.style.display = hasSmoothEnd(st.mode) ? '' : 'none';
        chip.classList.toggle('on', hasSmoothEnd(st.mode) && !!st[st.mode].smooth);
    }
    function setMode(m) {
        if (m !== 'bezier' && !MODELS[m]) return;
        closeMenu();
        st.mode = m; save();
        hover = null;
        if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }
        drag = null; movePending = null;
        const tg = document.getElementById('tab-graph');
        if (tg) tg.classList.toggle('graph-shape-mode', m !== 'bezier');
        document.querySelectorAll('#graph-type-header .graph-type-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-type') === m));
        syncReverse();
        syncChip();
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
