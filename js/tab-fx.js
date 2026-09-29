// This tab's ExtendScript backend (jsx/fx.jsx), loaded on first use.
const fxJsx = window.createJsxLoader('fx.jsx');

/* FX TAB
   Copy effect stacks from the selected layers into a library that persists in
   localStorage, then paste any checked stacks (or a single one) onto the selected
   layers. jsx/fx.jsx does the AE work and keeps no state. */
(function() {
    const STORE_KEY = 'rfxFxLibrary';     // [{ id, name, layer, effects, checked }]
    const REPLACE_KEY = 'rfxFxReplace';   // "true" = remove existing effects before pasting

    let entries = loadEntries();
    let clearArmedTimer = null;
    let searchQuery = '';

    const ICON = {
        paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    };

    // ---------------------------------------------------------------- storage
    function loadEntries() {
        try {
            const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
            return Array.isArray(list) ? list.filter(e => e && Array.isArray(e.effects)) : [];
        } catch (e) { return []; }
    }
    function saveEntries() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(entries)); }
        catch (e) { showToast('Cannot save the FX library: ' + e.message); }
    }
    function replaceOn() { return localStorage.getItem(REPLACE_KEY) === 'true'; }

    // ---------------------------------------------------------------- helpers
    function effectNames(entry) { return entry.effects.map(fx => fx.name).join(', '); }
    function entryTitle(entry) { return entry.name || effectNames(entry); }
    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
    function checkedEntries() { return entries.filter(e => e.checked); }

    /* evalScript result -> object. Anything that is not our JSON becomes a clear error. */
    function parseResult(res) {
        if (!res || res === 'EvalScript error.') return { ok: false, error: 'FX backend error. Close and reopen the panel, then try again.' };
        try { return JSON.parse(res); }
        catch (e) { return { ok: false, error: 'Unexpected reply from After Effects: ' + String(res).slice(0, 120) }; }
    }

    /* JSON is valid ExtendScript source except for U+2028/U+2029 inside strings. */
    function toJsxLiteral(value) {
        const separators = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g");
        return JSON.stringify(value).replace(separators, c => "\\u" + c.charCodeAt(0).toString(16));
    }

    // ---- search engine start ------------------------------------------------
    /* Smart library search. The query becomes a list of "concepts" (usually effect names):
       - "quoted text" stays one concept, -word / -"quoted" excludes stacks that match it;
       - , ; + & / | and the words and/or/with/plus split concepts explicitly;
       - the remaining words are segmented against the words actually in the library, so
         "deep glow grow bound" becomes "deep glow" + "grow bound" without any commas.
       Each concept is matched against every stack's effect names, custom name and source
       layer: exact, prefix, any word order, joined words ("deepglow"), initials ("gb"),
       diacritics and case ignored, and spelling mistakes (edit distance) when the word
       has no exact or prefix match anywhere in the library.
       Ranking: stacks matching every concept first; among those, stronger matches, then
       stacks whose effects are exactly the searched ones before stacks with extra effects,
       then fewer effects, then library order. Stacks matching only some concepts follow
       as partial matches. */
    const FxSearch = (function() {
        const MATCH = 0.6;                         // minimum strength for a concept to count
        const BREAK_WORDS = new Set(['and', 'or', 'with', 'plus', 'vs']);
        const NOISE = new Set(['fx', 'effect', 'effects', 'preset', 'presets', 'stack', 'stacks', 'the', 'a', 'an']);

        function normalize(s) {
            return String(s == null ? '' : s).normalize('NFD').replace(/\p{M}+/gu, '')
                .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        }
        function tokenize(s) { const n = normalize(s); return n ? n.split(' ') : []; }

        function makeTarget(text) {
            const tokens = tokenize(text);
            return { tokens: tokens, compact: tokens.join(''), initials: tokens.map(t => t[0]).join('') };
        }

        /* An effect is searchable by its name, its base effect name (displayName, stored by
           Copy) and its name without AE's duplicate number ("Deep Glow 2" -> "Deep Glow"). */
        function effectTargets(fx) {
            const names = [fx.name];
            if (fx.displayName) names.push(fx.displayName);
            const unnumbered = String(fx.name || '').replace(/\s+\d+$/, '');
            if (unnumbered) names.push(unnumbered);
            const seen = new Set();
            return names.map(makeTarget).filter(t => t.tokens.length && !seen.has(t.compact) && seen.add(t.compact));
        }
        function bestSim(qTokens, qTypo, targets) {
            let s = 0;
            for (const t of targets) { const v = phraseSim(qTokens, qTypo, t); if (v > s) s = v; }
            return s;
        }

        /* Optimal-string-alignment distance (insert, delete, substitute, swap neighbours),
           abandoned early once it exceeds max. */
        function editDistance(a, b, max) {
            if (Math.abs(a.length - b.length) > max) return max + 1;
            let prev2 = null, prev = [], cur;
            for (let j = 0; j <= b.length; j++) prev[j] = j;
            for (let i = 1; i <= a.length; i++) {
                cur = [i];
                let rowMin = i;
                for (let j = 1; j <= b.length; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
                    if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
                    cur[j] = v;
                    if (v < rowMin) rowMin = v;
                }
                if (rowMin > max) return max + 1;
                prev2 = prev; prev = cur;
            }
            return prev[b.length];
        }

        function typoBudget(len) { return len <= 5 ? 1 : len <= 9 ? 2 : 3; }

        /* How well one query word q matches one target word w (0..1). */
        function tokenSim(q, w, typoOK) {
            if (q === w) return 1;
            if (w.startsWith(q)) return q.length === 1 ? 0.62 : 0.82 + 0.13 * q.length / w.length;
            if (q.length >= 4 && w.length >= 3 && q.startsWith(w)) return 0.8;      // "bounds" vs "bound"
            if (q.length >= 3 && w.includes(q)) return 0.7;                          // "blur" in "fastblur"
            if (!typoOK || q.length < 3) return 0;
            if (q.length === 3) {                                                    // "dep" -> "deep": one edit, same first letter
                return q[0] === w[0] && editDistance(q, w, 1) <= 1 ? 0.62 : 0;
            }
            const budget = typoBudget(q.length);
            const d = editDistance(q, w, budget);
            if (d <= budget) return 0.78 - 0.08 * d;
            if (w.length > q.length) {                                               // mistyped while still typing
                const dp = editDistance(q, w.slice(0, q.length), budget);
                if (dp <= budget) return 0.7 - 0.08 * dp;
            }
            return 0;
        }

        /* How well a concept (query words) matches a target (a name). */
        function phraseSim(qTokens, qTypo, target) {
            if (!target.tokens.length) return 0;
            let sum = 0, lastIdx = -1, inOrder = true;
            const covered = new Set();
            for (let i = 0; i < qTokens.length; i++) {
                let best = 0, bestIdx = -1;
                for (let k = 0; k < target.tokens.length; k++) {
                    const s = tokenSim(qTokens[i], target.tokens[k], qTypo[i]);
                    if (s > best) { best = s; bestIdx = k; if (s === 1) break; }
                }
                sum += best;
                if (best >= MATCH) {
                    covered.add(bestIdx);
                    if (bestIdx < lastIdx) inOrder = false;
                    lastIdx = bestIdx;
                }
            }
            let score = (sum / qTokens.length) * (0.85 + 0.15 * covered.size / target.tokens.length);
            if (!inOrder) score *= 0.97;

            const qc = qTokens.join('');
            if (qc.length >= 3 && (qTokens.length > 1 || target.tokens.length > 1)) {
                if (qc === target.compact) score = Math.max(score, 1);
                else if (target.compact.startsWith(qc)) score = Math.max(score, 0.8 + 0.15 * qc.length / target.compact.length);
                else if (qc.length >= 5 && qTypo.every(Boolean)) {
                    const b = qc.length <= 9 ? 1 : 2, d = editDistance(qc, target.compact, b);
                    if (d <= b) score = Math.max(score, 0.75 - 0.08 * d);
                }
            }
            if (qTokens.length === 1 && qc.length >= 2 && qc.length <= 5 && target.tokens.length >= 2 && qc === target.initials) {
                score = Math.max(score, 0.72);
            }
            return Math.min(score, 1);
        }

        /* Raw query -> explicit concepts (quoted / negated) + free runs of words. */
        function parseQuery(raw) {
            const concepts = [], runs = [];
            let rest = String(raw || '');
            rest = rest.replace(/(^|\s)(-?)"([^"]*)"?/g, (m, sp, neg, text) => {
                const t = tokenize(text);
                if (t.length) concepts.push({ tokens: t, negative: !!neg });
                return ' , ';
            });
            rest = rest.replace(/(^|\s)-(\S+)/g, (m, sp, word) => {
                const t = tokenize(word);
                if (t.length) concepts.push({ tokens: t, negative: true });
                return ' , ';
            });
            rest.split(/[,;+&|/\\]+/).forEach(group => {
                let run = [];
                tokenize(group).forEach(t => {
                    if (BREAK_WORDS.has(t)) { if (run.length) runs.push(run); run = []; }
                    else if (!NOISE.has(t)) run.push(t);
                });
                if (run.length) runs.push(run);
            });
            return { concepts: concepts, runs: runs };
        }

        /* Splits a run of words into the most likely names, using the library vocabulary. */
        function segment(run, typo, vocab) {
            const n = run.length, best = [0], from = [0];
            for (let i = 1; i <= n; i++) {
                best[i] = -Infinity;
                for (let j = Math.max(0, i - 5); j < i; j++) {
                    const len = i - j, toks = run.slice(j, i), tp = typo.slice(j, i);
                    let sim = 0;
                    for (const v of vocab) { const s = phraseSim(toks, tp, v); if (s > sim) sim = s; }
                    let score;
                    if (len === 1) score = Math.max(sim, 0.3);          // unknown words still count as terms
                    else if (sim >= 0.72) score = sim * len + 0.15 * len;
                    else continue;
                    if (best[j] + score > best[i]) { best[i] = best[j] + score; from[i] = j; }
                }
            }
            const parts = [];
            for (let i = n; i > 0; i = from[i]) parts.unshift(run.slice(from[i], i));
            return parts;
        }

        /* entries -> { active, results: [{ entry, partial, hits: Set<effectIndex> }] } */
        function search(list, raw) {
            const parsed = parseQuery(raw);
            if (!parsed.concepts.length && !parsed.runs.length) return { active: false, results: list.map(e => ({ entry: e, partial: false, hits: new Set() })) };

            const prepared = list.map(e => ({
                entry: e,
                effects: e.effects.map(effectTargets),
                name: e.name ? makeTarget(e.name) : null,
                layer: e.layer ? makeTarget(e.layer) : null
            }));
            const vocab = [], seen = new Set(), words = new Set();
            prepared.forEach(p => [p.name, p.layer].concat(...p.effects).forEach(t => {
                if (!t || !t.tokens.length) return;
                t.tokens.forEach(w => words.add(w));
                if (!seen.has(t.compact)) { seen.add(t.compact); vocab.push(t); }
            }));
            // A word that matches something exactly or as a prefix is not treated as a typo.
            const typoOK = q => { for (const w of words) if (w === q || w.startsWith(q)) return false; return true; };

            // Exclusions never use typo matching, so a misspelled -word cannot hide the wrong stacks.
            const concepts = parsed.concepts.map(c => ({ tokens: c.tokens, typo: c.tokens.map(t => !c.negative && typoOK(t)), negative: c.negative }));
            parsed.runs.forEach(run => {
                const typo = run.map(typoOK);
                segment(run, typo, vocab).forEach(part => concepts.push({ tokens: part, typo: part.map(typoOK), negative: false }));
            });
            const positives = concepts.filter(c => !c.negative).length;

            const results = [];
            prepared.forEach((p, order) => {
                const hits = new Set();
                let matched = 0, total = 0;
                for (const c of concepts) {
                    let s = 0;
                    const effectScores = p.effects.map(targets => bestSim(c.tokens, c.typo, targets));
                    effectScores.forEach(v => { if (v > s) s = v; });
                    if (p.name) s = Math.max(s, phraseSim(c.tokens, c.typo, p.name));
                    if (p.layer) s = Math.max(s, 0.75 * phraseSim(c.tokens, c.typo, p.layer));
                    if (c.negative) { if (s >= MATCH) return; continue; }
                    if (s < MATCH) continue;
                    matched++;
                    total += s;
                    effectScores.forEach((v, i) => { if (v >= MATCH) hits.add(i); });
                }
                if (positives && !matched) return;
                results.push({
                    entry: p.entry,
                    partial: matched < positives,
                    hits: hits,
                    matched: matched,
                    strength: matched ? total / matched : 0,
                    extras: hits.size ? p.effects.length - hits.size : 0,
                    order: order
                });
            });

            results.sort((a, b) =>
                (b.matched - a.matched) ||
                (Math.round(b.strength * 10) - Math.round(a.strength * 10)) ||
                (a.extras - b.extras) ||
                (a.entry.effects.length - b.entry.effects.length) ||
                (b.strength - a.strength) ||
                (a.order - b.order));
            return { active: true, results: results };
        }

        return { search: search, normalize: normalize, editDistance: editDistance };
    })();
    // ---- search engine end --------------------------------------------------

    // ---------------------------------------------------------------- actions
    function copyFromSelection() {
        fxJsx('fxCopyFromSelection()', res => {
            const r = parseResult(res);
            if (!r.ok) return showToast(r.error);
            const stamp = Date.now();
            const fresh = r.entries.map((e, i) => ({ id: stamp + '-' + i, name: '', layer: e.layer, effects: e.effects, checked: true }));
            entries = fresh.concat(entries);   // newest on top
            saveEntries();
            render();
            const count = fresh.reduce((n, e) => n + e.effects.length, 0);
            let msg = 'Copied ' + plural(count, 'effect') + (fresh.length > 1 ? ' from ' + plural(fresh.length, 'layer') : '');
            if (r.empty && r.empty.length) msg += ' (' + plural(r.empty.length, 'layer') + ' without effects skipped)';
            showToast(msg);
        });
    }

    function pasteEntries(list) {
        if (!list.length) return showToast('No stacks checked. Check some, or use a row\'s paste button.');
        const payload = toJsxLiteral(list.map(e => ({ effects: e.effects })));
        fxJsx('fxPasteToSelection(' + payload + ', ' + (replaceOn() ? 'true' : 'false') + ')', res => {
            const r = parseResult(res);
            if (!r.ok) return showToast(r.error);
            let msg = r.added
                ? 'Pasted ' + plural(r.added, 'effect') + ' onto ' + plural(r.layers, 'layer')
                : 'Nothing was pasted';
            if (r.skipped && r.skipped.length) msg += '. Not installed or not allowed on this layer: ' + r.skipped.join(', ');
            if (r.noEffects && r.noEffects.length) msg += '. Skipped (cannot hold effects): ' + r.noEffects.join(', ');
            showToast(msg);
        });
    }

    function removeFromLayers() {
        fxJsx('fxRemoveAllFromSelection()', res => {
            const r = parseResult(res);
            if (!r.ok) return showToast(r.error);
            if (!r.effects && !r.animators) return showToast('No effects to remove on the selected layers.');
            let what = plural(r.effects, 'effect');
            if (r.animators) what += ' and ' + plural(r.animators, 'text animator');
            showToast('Removed ' + what + ' from ' + plural(r.layers, 'layer'));
        });
    }

    function deleteEntry(id) {
        entries = entries.filter(e => e.id !== id);
        saveEntries();
        render();
    }

    /* Updates the row in place (no list rebuild), so a double-click still reaches the
       same element and opens rename. */
    function toggleEntry(entry, row) {
        entry.checked = !entry.checked;
        row.classList.toggle('is-checked', entry.checked);
        saveEntries();
        renderHeader();
    }

    /* While searching, check all / none applies to the stacks that are shown. */
    function toggleAll() {
        const scope = visibleEntries();
        const all = scope.length > 0 && scope.every(e => e.checked);
        scope.forEach(e => { e.checked = !all; });
        saveEntries();
        render();
    }

    /* Two-step clear: the first click arms the button for 3 s, the second clears. */
    function clearLibrary(btn) {
        if (!entries.length) return;
        if (!clearArmedTimer) {
            btn.classList.add('fxt-armed');
            btn.textContent = 'Click again to clear';
            clearArmedTimer = setTimeout(() => disarmClear(btn), 3000);
            return;
        }
        disarmClear(btn);
        entries = [];
        saveEntries();
        render();
    }
    function disarmClear(btn) {
        clearTimeout(clearArmedTimer);
        clearArmedTimer = null;
        btn.classList.remove('fxt-armed');
        btn.textContent = 'Clear library';
    }

    function startRename(entry, main, nameEl) {
        const input = document.createElement('input');
        input.className = 'fxt-rename';
        input.value = entryTitle(entry);
        input.spellcheck = false;
        main.removeAttribute('data-tooltip');   // the tooltip rule disables pointer events on its children
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            if (save) {
                const value = input.value.trim();
                entry.name = (value && value !== effectNames(entry)) ? value : '';
                saveEntries();
            }
            render();
        };
        input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') finish(true);
            else if (ev.key === 'Escape') finish(false);
            ev.stopPropagation();
        });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('click', ev => ev.stopPropagation());
        input.addEventListener('dblclick', ev => ev.stopPropagation());
    }

    // ---------------------------------------------------------------- search UI
    let lastResults = null;   // cached search output for the current query

    function currentSearch() {
        if (!lastResults) lastResults = FxSearch.search(entries, searchQuery);
        return lastResults;
    }
    function visibleEntries() { return currentSearch().results.map(r => r.entry); }
    function invalidateSearch() { lastResults = null; }

    function setSearch(value) {
        searchQuery = value;
        const wrap = document.getElementById('fxt-search-wrap');
        if (wrap) wrap.classList.toggle('has-text', !!value.trim());
        render();
    }

    // ---------------------------------------------------------------- render
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function iconButton(className, tooltip, svg, onClick) {
        const btn = el('button', 'fxt-icon-btn ' + className);
        btn.setAttribute('data-tooltip', tooltip);
        btn.innerHTML = svg;
        btn.addEventListener('click', ev => { ev.stopPropagation(); onClick(); });
        return btn;
    }

    /* Effect names as "A, B, C" with the ones matching the search highlighted. */
    function appendEffectNames(parent, entry, hits) {
        entry.effects.forEach((fx, i) => {
            if (i) parent.appendChild(document.createTextNode(', '));
            parent.appendChild(el('span', hits.has(i) ? 'fxt-hit' : '', fx.name));
        });
    }

    function renderRow(entry, hits) {
        const row = el('div', 'fxt-item' + (entry.checked ? ' is-checked' : ''));
        row.appendChild(el('span', 'fxt-check'));

        const main = el('div', 'fxt-item-main');
        main.setAttribute('data-tooltip', entry.effects.map(fx => fx.name).join('\n') + '\n\nDouble-click to rename');
        const name = el('div', 'fxt-item-name');
        if (entry.name) name.textContent = entry.name;
        else appendEffectNames(name, entry, hits);
        main.appendChild(name);

        const meta = el('div', 'fxt-item-meta');
        meta.appendChild(el('span', 'fxt-pill', entry.effects.length + ' FX'));
        const source = el('span', 'fxt-item-source');
        if (entry.name) appendEffectNames(source, entry, hits);
        else if (entry.layer) source.textContent = 'from ' + entry.layer;
        meta.appendChild(source);
        main.appendChild(meta);
        main.addEventListener('dblclick', ev => { ev.stopPropagation(); startRename(entry, main, name); });
        row.appendChild(main);

        const actions = el('div', 'fxt-item-actions');
        actions.appendChild(iconButton('fxt-row-paste', 'Paste only this stack', ICON.paste, () => pasteEntries([entry])));
        actions.appendChild(iconButton('fxt-row-delete', 'Delete from library', ICON.close, () => deleteEntry(entry.id)));
        row.appendChild(actions);

        row.addEventListener('click', () => toggleEntry(entry, row));
        return row;
    }

    function renderHeader() {
        const checked = checkedEntries().length;
        const search = currentSearch();
        const shown = search.results.length;
        document.getElementById('fxt-count').textContent = search.active ? shown + ' / ' + entries.length : entries.length;

        const pasteBtn = document.getElementById('fxt-paste');
        pasteBtn.disabled = checked === 0;
        document.getElementById('fxt-paste-count').textContent = checked;

        const scope = visibleEntries();
        const scopeChecked = scope.filter(e => e.checked).length;
        const all = document.getElementById('fxt-all');
        all.classList.toggle('is-all', scope.length > 0 && scopeChecked === scope.length);
        all.classList.toggle('is-some', scopeChecked > 0 && scopeChecked < scope.length);
        all.disabled = scope.length === 0;

        document.getElementById('fxt-clear').disabled = entries.length === 0;
    }

    function renderEmpty(list, title, hint) {
        const empty = el('div', 'fxt-empty');
        empty.appendChild(el('div', 'fxt-empty-title', title));
        empty.appendChild(el('div', 'fxt-empty-hint', hint));
        list.appendChild(empty);
    }

    function render() {
        const list = document.getElementById('fxt-list');
        if (!list) return;
        invalidateSearch();
        list.innerHTML = '';
        renderHeader();

        if (!entries.length) {
            return renderEmpty(list, 'No effect stacks yet', 'Select a layer and press Copy FX. Select specific effects first to copy only those.');
        }
        const search = currentSearch();
        if (!search.results.length) {
            return renderEmpty(list, 'No stacks match “' + searchQuery.trim() + '”', 'Try fewer or shorter words, or search by effect, stack or layer name.');
        }
        let dividerShown = false;
        search.results.forEach(r => {
            if (r.partial && !dividerShown) {
                list.appendChild(el('div', 'fxt-divider', 'Partial matches'));
                dividerShown = true;
            }
            list.appendChild(renderRow(r.entry, r.hits));
        });
    }

    // ---------------------------------------------------------------- init
    function init() {
        if (!document.getElementById('fxt-list')) return;
        document.getElementById('fxt-copy').addEventListener('click', copyFromSelection);
        document.getElementById('fxt-paste').addEventListener('click', () => pasteEntries(checkedEntries()));
        document.getElementById('fxt-all').addEventListener('click', toggleAll);
        document.getElementById('fxt-remove').addEventListener('click', removeFromLayers);
        const clearBtn = document.getElementById('fxt-clear');
        clearBtn.addEventListener('click', () => clearLibrary(clearBtn));
        const replace = document.getElementById('fxt-replace');
        replace.checked = replaceOn();
        replace.addEventListener('change', () => localStorage.setItem(REPLACE_KEY, replace.checked ? 'true' : 'false'));

        // Search: live filtering; Enter pastes the top result, Esc clears.
        const search = document.getElementById('fxt-search');
        search.addEventListener('input', () => setSearch(search.value));
        search.addEventListener('keydown', ev => {
            if (ev.key === 'Escape') { search.value = ''; setSearch(''); }
            else if (ev.key === 'Enter' && searchQuery.trim()) {
                const top = currentSearch().results[0];
                if (top) pasteEntries([top.entry]);
                else showToast('No stack matches the search.');
            }
        });
        document.getElementById('fxt-search-clear').addEventListener('click', () => {
            search.value = '';
            setSearch('');
            search.focus();
        });
        render();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
