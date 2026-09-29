/* ============================================================================
   RFX DEPENDENCY MANAGER  (js/deps.js)
   Shared installer code for the tabs that need external programs (Caption,
   Download, Assets). It is not a tab: each tab registers its OWN dependencies and
   gets its OWN installs. Two tabs never share a binary; only this code is shared.

   Layout   <tab root>\<dependency>\<version>\...      the installed files
            <tab root>\deps.json                         active + previous version,
                                                         source, hashes, dates
            <tab root>\_downloads\                       resumable .part files
            <tab root>\<dependency>\_staging\            extraction workspace
   Tab root defaults to %APPDATA%\RFX\Dependencies\<tab> and can be changed per tab.

   Install  free-space check -> download to .part (progress, speed, cancel, HTTP
            Range resume) -> verify sha256 / git blob sha1 when the source publishes
            one, else the exact size -> extract to _staging -> test-run the program
            -> rename into <version>\ -> switch the active pointer. Any failure
            leaves the active version untouched. Old versions are only deleted when
            the user asks. Nothing needs admin rights.
   Lookup   managed active version -> legacy copy in bin\<platform>\<tab> -> missing.
   Updates  on request, plus at most one silent check per dependency per day
            (cached in deps.json; quiet when offline or rate-limited).
   Works in the panel (window.RFXDeps) and in plain Node for tests (module.exports).
   ========================================================================== */
(function (root) {
    'use strict';
    if (typeof require !== 'function') { root.RFXDeps = null; return; }

    const fs = require('fs'), path = require('path'), https = require('https'), crypto = require('crypto'),
          cp = require('child_process'), os = require('os'), stream = require('stream');

    const IS_WIN = process.platform === 'win32';
    const DAY = 24 * 60 * 60 * 1000;
    const UA = 'RFX-Dependency-Manager';
    const config = { depsRoot: null, extensionRoot: null, storage: null, tarExe: null, noCurl: false };   // tarExe, noCurl: test hooks

    // ------------------------------------------------------------------ basics
    function memoryStorage() {
        const m = new Map();
        return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    }
    function storage() {
        if (config.storage) return config.storage;
        try { if (root.localStorage) return root.localStorage; } catch (e) {}
        return (config.storage = memoryStorage());
    }
    function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
    function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { try { fs.rmdirSync(p, { recursive: true }); } catch (e2) {} } }
    function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }
    function safeName(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/[. ]+$/, '') || 'item'; }
    function exeName(name) { return IS_WIN ? name : name.replace(/\.exe$/i, ''); }
    function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return url; } }
    function firstLine(s) { return String(s || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || ''; }

    function formatBytes(n) {
        if (n == null || isNaN(n)) return '?';
        const u = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
    }
    function formatDuration(sec) {
        if (!isFinite(sec) || sec < 0) return '';
        if (sec < 60) return Math.ceil(sec) + ' s';
        if (sec < 3600) return Math.round(sec / 60) + ' min';
        return (sec / 3600).toFixed(1) + ' h';
    }

    function defaultRoot() {
        if (config.depsRoot) return config.depsRoot;
        const appData = process.env.APPDATA || path.join(os.homedir(), IS_WIN ? 'AppData/Roaming' : 'Library/Application Support');
        return path.join(appData, 'RFX', 'Dependencies');
    }
    function extensionRoot() {
        if (config.extensionRoot) return config.extensionRoot;
        try {
            let p = root.csInterface.getSystemPath('extension') || '';
            if (p.indexOf('file:') === 0) {
                p = p.replace(/^file:\/*/, '');
                try { p = decodeURIComponent(p); } catch (e) {}
                if (!/^[A-Za-z]:/.test(p)) p = '/' + p;
            }
            return (config.extensionRoot = path.normalize(p));
        } catch (e) { return null; }
    }

    // ------------------------------------------------------------------ registry + state
    const registry = {};     // tab -> { tab, label, deps: [def] }
    const listeners = new Set();
    const jobs = {};         // "tab/id" -> job
    const latestCache = {};  // source key -> { at, info }
    let rateLimitedUntil = 0;

    function register(tab, spec) {
        registry[tab] = { tab: tab, label: spec.label || tab, deps: (spec.deps || []).map(d => Object.assign({ tab: tab }, d)) };
        emit({ tab: tab });
    }
    function depDef(tab, id) {
        const t = registry[tab];
        const d = t && t.deps.find(x => x.id === id);
        if (!d) throw new Error('Unknown dependency ' + tab + '/' + id);
        return d;
    }
    function tabs() { return Object.keys(registry).map(k => registry[k]); }

    function tabRoot(tab) { return storage().getItem('rfxDepsDir:' + tab) || path.join(defaultRoot(), tab); }
    function isDefaultTabRoot(tab) { return !storage().getItem('rfxDepsDir:' + tab); }
    function setTabRoot(tab, dir) {
        if (dir) storage().setItem('rfxDepsDir:' + tab, path.resolve(dir));
        else storage().removeItem('rfxDepsDir:' + tab);
        emit({ tab: tab });
    }

    function stateFile(tab) { return path.join(tabRoot(tab), 'deps.json'); }
    function readState(tab) {
        try {
            const s = JSON.parse(fs.readFileSync(stateFile(tab), 'utf8'));
            s.deps = s.deps || {};
            s.checks = s.checks || {};
            return s;
        } catch (e) { return { deps: {}, checks: {} }; }
    }
    function writeState(tab, s) {
        mkdirp(tabRoot(tab));
        const f = stateFile(tab);
        fs.writeFileSync(f + '.tmp', JSON.stringify(s, null, 2));
        fs.renameSync(f + '.tmp', f);
    }

    function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    function emit(evt) { listeners.forEach(fn => { try { fn(evt); } catch (e) {} }); }

    // ------------------------------------------------------------------ resolution
    function legacyLookup(def) {
        const ext = extensionRoot();
        if (!ext || !def.legacy) return null;
        const dir = path.join(ext, 'bin', IS_WIN ? 'win' : 'mac', def.legacy.folder || def.tab);
        if (def.legacy.find) return def.legacy.find(dir);
        const main = path.join(dir, exeName(def.legacy.main));
        if (!exists(main)) return null;
        if ((def.legacy.require || []).some(r => !exists(path.join(dir, r)))) return null;
        return { dir: dir, path: main };
    }

    /* Where a tab should run this dependency from. Synchronous, so tabs can call it
       right before launching a process. state: managed | legacy | missing */
    function resolve(tab, id) {
        const def = depDef(tab, id);
        const rec = readState(tab).deps[id] || {};
        const out = { tab: tab, id: id, label: def.label, state: 'missing', dir: null, path: null, version: null,
                      active: rec.active || null, previous: rec.previous || null, brokenManaged: false };
        if (rec.active) {
            const dir = path.join(tabRoot(tab), id, rec.active.dir);
            const main = path.join(dir, exeName(def.main));
            if (exists(main)) return Object.assign(out, { state: 'managed', dir: dir, path: main, version: rec.active.version });
            out.brokenManaged = true;
        }
        const legacy = legacyLookup(def);
        if (legacy) return Object.assign(out, { state: 'legacy', dir: legacy.dir, path: legacy.path });
        return out;
    }

    // ------------------------------------------------------------------ network
    /* opts: { headers, method: 'GET'|'HEAD', follow: true } -> { res, req, url } */
    function httpRequest(url, opts, hops) {
        opts = opts || {};
        hops = hops || 0;
        return new Promise((resolveP, reject) => {
            let u;
            try { u = new URL(url); } catch (e) { return reject(new Error('Invalid download address: ' + url)); }
            const req = https.request({
                method: opts.method || 'GET', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
                headers: Object.assign({ 'User-Agent': UA }, opts.headers || {})
            }, res => {
                const loc = res.headers.location;
                if (opts.follow !== false && [301, 302, 303, 307, 308].indexOf(res.statusCode) !== -1 && loc) {
                    res.resume();
                    if (hops >= 10) return reject(new Error('Too many redirects from ' + u.hostname));
                    return resolveP(httpRequest(new URL(loc, url).toString(), opts, hops + 1));
                }
                resolveP({ res: res, req: req, url: url });
            });
            req.on('error', reject);
            req.setTimeout(30000, () => req.destroy(Object.assign(new Error('The server stopped responding'), { code: 'ETIMEDOUT' })));
            req.end();
        });
    }
    function httpGet(url, headers) { return httpRequest(url, { headers: headers }); }

    async function httpText(url) {
        const r = await httpGet(url);
        const body = await new Promise((resolveP, reject) => {
            let b = '';
            r.res.setEncoding('utf8');
            r.res.on('data', d => { b += d; });
            r.res.on('end', () => resolveP(b));
            r.res.on('error', reject);
        });
        if (r.res.statusCode < 200 || r.res.statusCode >= 300) throw new Error(hostOf(url) + ' answered HTTP ' + r.res.statusCode);
        return body;
    }

    /* Exact size of a download (HEAD, following redirects to the file host). */
    async function headSize(url) {
        const r = await httpRequest(url, { method: 'HEAD' });
        r.res.resume();
        const n = Number(r.res.headers['content-length']);
        return r.res.statusCode >= 200 && r.res.statusCode < 300 && n > 0 ? n : null;
    }

    async function httpJson(url) {
        const r = await httpGet(url, { Accept: 'application/vnd.github+json, application/json' });
        const body = await new Promise((resolveP, reject) => {
            let b = '';
            r.res.setEncoding('utf8');
            r.res.on('data', d => { b += d; });
            r.res.on('end', () => resolveP(b));
            r.res.on('error', reject);
        });
        const status = r.res.statusCode;
        if ((status === 403 || status === 429) && r.res.headers['x-ratelimit-remaining'] === '0') {
            rateLimitedUntil = Number(r.res.headers['x-ratelimit-reset'] || 0) * 1000 || Date.now() + 3600000;
            throw Object.assign(new Error('GitHub update limit reached. Try again after ' + new Date(rateLimitedUntil).toLocaleTimeString() + '.'), { code: 'RATE_LIMIT' });
        }
        if (status < 200 || status >= 300) throw new Error(hostOf(url) + ' answered HTTP ' + status);
        try { return JSON.parse(body); } catch (e) { throw new Error('Unexpected reply from ' + hostOf(url)); }
    }

    // ------------------------------------------------------------------ sources
    function digestSha256(asset) {
        const m = /^sha256:([0-9a-f]{64})$/i.exec(asset && asset.digest || '');
        return m ? m[1].toLowerCase() : null;
    }
    function versionParts(v) { return (String(v).match(/\d+/g) || []).map(Number); }
    function compareVersions(a, b) {
        const x = versionParts(a), y = versionParts(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
            const d = (x[i] || 0) - (y[i] || 0);
            if (d) return d > 0 ? 1 : -1;
        }
        return 0;
    }

    /* GitHub release data. Uses the REST API; when its per-IP limit (60 calls/hour, shared
       with every other program on the same network) is used up, the same information is
       read from the public release pages: asset names from the release's asset list,
       exact sizes with HEAD requests, hashes from the release's checksum files. */
    function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    async function ghRelease(repo, tag) {
        if (rateLimitedUntil > Date.now()) return ghReleaseFromWeb(repo, tag);
        try {
            return await httpJson('https://api.github.com/repos/' + repo + '/releases/' + (tag === 'latest' ? 'latest' : 'tags/' + encodeURIComponent(tag)));
        } catch (e) {
            if (e.code !== 'RATE_LIMIT') throw e;
            return ghReleaseFromWeb(repo, tag);
        }
    }

    /* Newest releases whose tag passes `accept`, newest first. */
    async function ghRecentReleases(repo, count, accept) {
        try {
            if (rateLimitedUntil > Date.now()) throw Object.assign(new Error('rate limited'), { code: 'RATE_LIMIT' });
            const list = await httpJson('https://api.github.com/repos/' + repo + '/releases?per_page=' + count);
            return list.filter(r => !accept || accept(r.tag_name));
        } catch (e) {
            if (e.code !== 'RATE_LIMIT') throw e;
            const html = await httpText('https://github.com/' + repo + '/releases');
            const re = new RegExp('/' + escapeRe(repo) + '/releases/tag/([^"?#]+)"', 'g');
            const tags = [];
            let m;
            while ((m = re.exec(html)) && tags.length < count) {
                const t = decodeURIComponent(m[1]);
                if (tags.indexOf(t) === -1 && (!accept || accept(t))) tags.push(t);
            }
            const out = [];
            for (const t of tags.slice(0, 2)) out.push(await ghReleaseFromWeb(repo, t));
            return out;
        }
    }

    async function ghReleaseFromWeb(repo, tag) {
        if (tag === 'latest') {
            const r = await httpRequest('https://github.com/' + repo + '/releases/latest', { follow: false });
            r.res.resume();
            const m = /\/releases\/tag\/([^/?#]+)/.exec(r.res.headers.location || '');
            if (!m) throw new Error('Could not find the latest ' + repo + ' release');
            tag = decodeURIComponent(m[1]);
        }
        const html = await httpText('https://github.com/' + repo + '/releases/expanded_assets/' + encodeURIComponent(tag));
        const re = new RegExp('href="/' + escapeRe(repo) + '/releases/download/[^/"]+/([^"]+)"', 'g');
        const assets = [];
        let m;
        while ((m = re.exec(html))) {
            const name = decodeURIComponent(m[1]);
            if (!assets.some(a => a.name === name)) {
                assets.push({ name: name, size: null, digest: null,
                    browser_download_url: 'https://github.com/' + repo + '/releases/download/' + encodeURIComponent(tag) + '/' + m[1] });
            }
        }
        if (!assets.length) throw new Error('Could not read the files of the ' + repo + ' release ' + tag);
        return { tag_name: tag, published_at: null, assets: assets, fromWeb: true };
    }

    /* Release asset -> download file with exact size and sha256 (GitHub digest, else the
       release's checksum file when it has one). */
    async function ghFile(rel, asset, sumsRe) {
        let sha = digestSha256(asset);
        if (!sha && sumsRe) {
            const sums = rel.assets.find(a => sumsRe.test(a.name));
            if (sums) { try { sha = await shaFromSumsFile(sums.browser_download_url, asset.name, sums.name.indexOf(asset.name) === 0); } catch (e) {} }
        }
        const size = asset.size || await headSize(asset.browser_download_url);
        return { url: asset.browser_download_url, name: asset.name, size: size, sha256: sha || undefined };
    }

    /* Source factories. Each returns a function () -> Promise<info>, where info is
       { version, label, publishedAt, source, archive: 'file'|'zip'|'7z'|'files',
         files: [{ url, name, size, sha256?, sha1git? }] } */
    const sources = {
        /* Latest GitHub release, one asset (yt-dlp.exe, deno zip, 7zr.exe). */
        githubLatest: function (opt) {
            return async function () {
                const rel = await ghRelease(opt.repo, 'latest');
                const asset = (rel.assets || []).find(a => opt.asset.test(a.name));
                if (!asset) throw new Error('No ' + opt.asset + ' file in the latest ' + opt.repo + ' release');
                return {
                    version: String(rel.tag_name).replace(/^v/i, ''), publishedAt: rel.published_at,
                    source: 'https://github.com/' + opt.repo + '/releases/tag/' + rel.tag_name,
                    archive: opt.archive || 'file',
                    files: [await ghFile(rel, asset, opt.sums)]
                };
            };
        },

        /* BtbN FFmpeg-Builds, newest stable release line (n9.0.x ...), win64 GPL static.
           The version is the FFmpeg point release, so rebuilds of the same release do
           not count as updates. */
        ffmpegStable: function () {
            return async function () {
                const rels = await ghRecentReleases('BtbN/FFmpeg-Builds', 6, t => /^autobuild-/.test(t));
                const re = /^ffmpeg-n(\d+(?:\.\d+)+)-\d+-g[0-9a-f]+-win64-gpl-\d+(?:\.\d+)*\.zip$/;
                for (const rel of rels) {
                    const cands = (rel.assets || []).map(a => ({ a: a, m: re.exec(a.name) })).filter(x => x.m);
                    if (!cands.length) continue;
                    cands.sort((p, q) => compareVersions(q.m[1], p.m[1]));
                    const best = cands[0];
                    return {
                        version: best.m[1], publishedAt: rel.published_at,
                        label: best.m[1] + ' (build ' + rel.tag_name.replace(/^autobuild-/, '') + ')',
                        source: 'https://github.com/BtbN/FFmpeg-Builds/releases/tag/' + rel.tag_name,
                        archive: 'zip',
                        files: [await ghFile(rel, best.a, /^checksums\.sha256$/)]
                    };
                }
                throw new Error('No stable FFmpeg build found in the recent BtbN releases');
            };
        },

        /* Purfview Faster-Whisper-XXL: newest free Windows build under the fixed tag.
           (The newest "Pro" builds have no public files.) No hash is published, so the
           exact size is verified. */
        whisperXXL: function () {
            return async function () {
                const rel = await ghRelease('Purfview/whisper-standalone-win', 'Faster-Whisper-XXL');
                const cands = (rel.assets || []).map(a => ({ a: a, m: /^Faster-Whisper-XXL_(r[\d.]+)_windows\.7z$/.exec(a.name) })).filter(x => x.m);
                if (!cands.length) throw new Error('No Windows build found in the Faster-Whisper-XXL release');
                cands.sort((p, q) => compareVersions(q.m[1], p.m[1]));
                const best = cands[0];
                return {
                    version: best.m[1], publishedAt: best.a.updated_at || rel.published_at,
                    source: 'https://github.com/Purfview/whisper-standalone-win/releases/tag/Faster-Whisper-XXL',
                    archive: '7z',
                    files: [await ghFile(rel, best.a, null)]
                };
            };
        },

        /* Hugging Face model repo pinned to its current revision. model.bin is checked
           against its LFS sha256, the small files against their git blob sha1. */
        huggingFace: function (opt) {
            return async function () {
                const info = await httpJson('https://huggingface.co/api/models/' + opt.repo + '?blobs=true');
                const files = opt.files.map(name => {
                    const s = (info.siblings || []).find(x => x.rfilename === name);
                    if (!s) throw new Error(opt.repo + ' no longer has ' + name);
                    return {
                        url: 'https://huggingface.co/' + opt.repo + '/resolve/' + info.sha + '/' + name,
                        name: name, size: s.lfs ? s.lfs.size : s.size,
                        sha256: s.lfs ? s.lfs.sha256 : undefined,
                        sha1git: s.lfs ? undefined : s.blobId
                    };
                });
                return {
                    version: info.sha, versionKind: 'revision', publishedAt: info.lastModified,
                    label: 'revision ' + info.sha.slice(0, 7) + (info.lastModified ? ' (' + info.lastModified.slice(0, 10) + ')' : ''),
                    source: 'https://huggingface.co/' + opt.repo + '/tree/' + info.sha,
                    archive: 'files', files: files
                };
            };
        }
    };

    /* Reads a sha256 for `name` from a checksum file: "hash  name" lines (sha256sum), or a
       per-file checksum (e.g. Deno's "<asset>.sha256sum" in Get-FileHash layout) that
       holds exactly one hash. */
    async function shaFromSumsFile(url, name, perAsset) {
        const text = await httpText(url);
        const line = text.split(/\r?\n/).find(l => l.trim().endsWith(' ' + name) || l.trim().endsWith('*' + name));
        const m = line && /^([0-9a-f]{64})\b/i.exec(line.trim());
        if (m) return m[1].toLowerCase();
        const all = text.match(/\b[0-9a-f]{64}\b/gi);
        return perAsset && all && all.length === 1 ? all[0].toLowerCase() : null;
    }

    async function latest(def, force) {
        const key = def.sourceKey || (def.tab + '/' + def.id);
        const hit = latestCache[key];
        if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.info;
        const info = await def.latest();
        latestCache[key] = { at: Date.now(), info: info };
        return info;
    }
    function totalSize(info) { return info.files.reduce((n, f) => n + (f.size || 0), 0); }

    // ------------------------------------------------------------------ disk + processes
    function freeBytes(dir) {
        return new Promise(resolveP => {
            if (!IS_WIN) return resolveP(null);
            const drive = /^([A-Za-z]):/.exec(path.resolve(dir));
            if (!drive) return resolveP(null);   // UNC / network path: cannot tell, don't block
            const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            cp.execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', '(Get-PSDrive -Name ' + drive[1] + ').Free'],
                { windowsHide: true, timeout: 15000 }, (err, stdout) => {
                    const n = Number(String(stdout || '').trim());
                    resolveP(err || !isFinite(n) ? null : n);
                });
        });
    }

    function run(job, exe, args, opts) {
        return new Promise(resolveP => {
            let out = '', err = '', done = false;
            let child;
            try { child = cp.spawn(exe, args, Object.assign({ windowsHide: true }, opts || {})); }
            catch (e) { return resolveP({ code: -1, stdout: '', stderr: e.message }); }
            if (job) job.child = child;
            const timer = opts && opts.timeout ? setTimeout(() => { try { child.kill(); } catch (e) {} }, opts.timeout) : null;
            if (child.stdout) child.stdout.on('data', d => { if (out.length < 200000) out += d; });
            if (child.stderr) child.stderr.on('data', d => { if (err.length < 200000) err += d; });
            const finish = (code) => { if (done) return; done = true; if (timer) clearTimeout(timer); if (job) job.child = null; resolveP({ code: code, stdout: out, stderr: err }); };
            child.on('error', e => { err += e.message; finish(-1); });
            child.on('close', code => finish(code));
        });
    }

    function dirSize(p) {
        let total = 0;
        const walk = (q) => {
            let st;
            try { st = fs.lstatSync(q); } catch (e) { return; }
            if (st.isDirectory()) { let names = []; try { names = fs.readdirSync(q); } catch (e) {} names.forEach(n => walk(path.join(q, n))); }
            else total += st.size;
        };
        walk(p);
        return total;
    }

    function findFile(dir, name, depth) {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (e) { return null; }
        const hit = names.find(n => n.toLowerCase() === name.toLowerCase());
        if (hit && !fs.statSync(path.join(dir, hit)).isDirectory()) return path.join(dir, hit);
        if (depth <= 0) return null;
        for (const n of names) {
            const p = path.join(dir, n);
            try { if (fs.statSync(p).isDirectory()) { const r = findFile(p, name, depth - 1); if (r) return r; } } catch (e) {}
        }
        return null;
    }

    function moveInto(src, dest, keepSource) {
        mkdirp(path.dirname(dest));
        if (keepSource) { fs.copyFileSync(src, dest); return; }
        try { fs.renameSync(src, dest); }
        catch (e) { fs.copyFileSync(src, dest); fs.unlinkSync(src); }   // different volume
    }

    function hashFile(p, algo, prefix) {
        return new Promise((resolveP, reject) => {
            const h = crypto.createHash(algo);
            if (prefix) h.update(prefix);
            const s = fs.createReadStream(p);
            s.on('data', d => h.update(d));
            s.on('end', () => resolveP(h.digest('hex')));
            s.on('error', reject);
        });
    }

    // ------------------------------------------------------------------ download + verify
    function cancelledError() { return Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }); }
    function pausedError() { return Object.assign(new Error('Paused'), { code: 'PAUSED' }); }
    function stopError(job) { return job.pauseRequested ? pausedError() : cancelledError(); }

    /* Downloads use Windows' own curl.exe when it exists (Windows 10 1803+): it verifies
       certificates with the Windows certificate store, follows redirects and resumes with
       HTTP Range, independent of the panel's older embedded Node. Node's https is the
       fallback. Progress is read from the growing .part file, so it is accurate either way. */
    let curlInfo;
    function curlExe() {
        if (!IS_WIN || config.noCurl) return null;   // noCurl: test hook for the Node fallback
        if (curlInfo !== undefined) return curlInfo;
        curlInfo = null;
        const p = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe');
        if (!exists(p)) return null;
        try {
            const out = cp.execFileSync(p, ['--version'], { windowsHide: true, timeout: 10000 }).toString();
            const m = /curl (\d+)\.(\d+)/.exec(out);
            const v = m ? Number(m[1]) * 1000 + Number(m[2]) : 0;
            curlInfo = { path: p, revoke: v >= 7070 };   // --ssl-revoke-best-effort needs curl 7.70
        } catch (e) { curlInfo = null; }
        return curlInfo;
    }

    function curlError(code, stderr, url) {
        const host = hostOf(url), detail = firstLine(stderr).replace(/^curl: \(\d+\)\s*/, '');
        const known = {
            6: 'Could not find ' + host + '. Check your internet connection.',
            7: 'Could not connect to ' + host + '. Check your internet connection or firewall.',
            22: host + ' refused the download (' + detail + ').',
            23: 'Could not write the download to disk (disk full or no permission).',
            28: 'The download stalled (no data for a minute). Try again: it resumes where it stopped.',
            35: 'Secure connection to ' + host + ' failed (' + detail + ').',
            56: 'The connection to ' + host + ' was interrupted. Try again: it resumes where it stopped.',
            60: 'Windows did not trust the certificate of ' + host + ' (' + detail + ').'
        };
        return Object.assign(new Error(known[code] || ('Download failed (curl ' + code + (detail ? ': ' + detail : '') + ').')), { code: 'CURL_' + code });
    }

    /* Keeps job.received / speed current from the size of the .part file. */
    function startProgressWatch(job, part, base) {
        let lastT = Date.now(), lastB = job.received;
        const tick = () => {
            let size = 0;
            try { size = fs.statSync(part).size; } catch (e) {}
            job.fileReceived = size;
            job.received = base + size;
            const now = Date.now(), dt = now - lastT;
            if (dt >= 250) {
                const inst = Math.max(0, (job.received - lastB) * 1000 / dt);
                job.speed = job.speed ? job.speed * 0.6 + inst * 0.4 : inst;
                lastT = now; lastB = job.received;
            }
            emit({ tab: job.tab, id: job.id, job: job, progress: true });
        };
        const timer = setInterval(tick, 300);
        return () => { clearInterval(timer); tick(); };
    }

    function fetchWithCurl(job, file, part, start, curl) {
        return new Promise((resolveP, reject) => {
            const args = ['-L', '--fail', '--silent', '--show-error', '--connect-timeout', '20',
                          '--speed-limit', '1', '--speed-time', '60', '--retry', '3', '--retry-delay', '2',
                          '-A', UA, '-o', part];
            if (curl.revoke) args.push('--ssl-revoke-best-effort');   // offline revocation servers must not block downloads
            if (start > 0) args.push('-C', '-');
            args.push(file.url);
            let stderr = '';
            let child;
            try { child = cp.spawn(curl.path, args, { windowsHide: true }); }
            catch (e) { return reject(e); }
            job.child = child;
            job.fileTotal = file.size;
            const stopWatch = startProgressWatch(job, part, job.received - start);
            child.stderr.on('data', d => { if (stderr.length < 4000) stderr += d; });
            child.on('error', e => { stopWatch(); job.child = null; reject(e); });
            child.on('close', code => {
                stopWatch();
                job.child = null;
                if (job.pauseRequested || job.cancelled) return reject(stopError(job));
                if (code === 0) return resolveP();
                if (code === 33 || code === 36) return reject(Object.assign(new Error('The server cannot resume this download.'), { code: 'NO_RANGE' }));
                reject(curlError(code, stderr, file.url));
            });
        });
    }

    async function fetchToPart(job, file, part, start) {
        const curl = curlExe();
        if (curl) {
            try { return await fetchWithCurl(job, file, part, start, curl); }
            catch (e) {
                if (e.code !== 'NO_RANGE') throw e;
                try { fs.unlinkSync(part); } catch (e2) {}   // cannot resume: start this file over
                job.received -= start;
                return fetchWithCurl(job, file, part, 0, curl);
            }
        }
        return fetchWithNode(job, file, part, start);
    }

    async function fetchWithNode(job, file, part, start) {
        const r = await httpGet(file.url, start ? { Range: 'bytes=' + start + '-' } : {});
        if (job.cancelled || job.pauseRequested) { r.req.destroy(); throw stopError(job); }
        const status = r.res.statusCode;
        let append = false;
        if (status === 206) append = true;
        else if (status === 200) start = 0;   // server ignored the range: start over
        else if (status === 416 && file.size && start >= file.size) { r.res.resume(); return; }
        else { r.res.resume(); throw new Error('Download failed: ' + hostOf(r.url) + ' answered HTTP ' + status); }

        job.fileTotal = file.size || (start + Number(r.res.headers['content-length'] || 0));
        job.fileReceived = start;
        let lastT = Date.now(), lastB = job.received;
        const step = Math.max(256 * 1024, (job.fileTotal || 0) / 50);   // report at least every 2% (fast links)
        job.abort = () => r.req.destroy(stopError(job));
        r.res.on('data', chunk => {
            job.fileReceived += chunk.length;
            job.received += chunk.length;
            const now = Date.now();
            if (now - lastT >= 400 || job.received - lastB >= step) {
                const dt = Math.max(now - lastT, 1);
                const inst = (job.received - lastB) * 1000 / dt;
                job.speed = job.speed ? job.speed * 0.7 + inst * 0.3 : inst;
                lastT = now; lastB = job.received;
                emit({ tab: job.tab, id: job.id, job: job, progress: true });
            }
        });
        await new Promise((resolveP, reject) => {
            stream.pipeline(r.res, fs.createWriteStream(part, { flags: append ? 'a' : 'w' }), err => (err ? reject(err) : resolveP()));
        }).catch(e => { throw (job.cancelled || job.pauseRequested) ? stopError(job) : e; });
        job.abort = null;
        if (job.cancelled || job.pauseRequested) throw stopError(job);
        const got = fs.statSync(part).size;
        if (file.size && got < file.size) throw Object.assign(new Error('The download stopped early. Try again: it resumes where it stopped.'), { code: 'INCOMPLETE' });
    }

    async function verifyFile(p, file) {
        const size = fs.statSync(p).size;
        if (file.size && size !== file.size) {
            fs.unlinkSync(p);
            throw new Error(file.name + ' has the wrong size (' + formatBytes(size) + ' instead of ' + formatBytes(file.size) + '). It was deleted; try again.');
        }
        if (file.sha256) {
            const h = await hashFile(p, 'sha256');
            if (h !== String(file.sha256).toLowerCase()) {
                fs.unlinkSync(p);
                throw Object.assign(new Error(file.name + ' failed its checksum (sha256), so it was deleted. The download was damaged or changed on the server; try again.'), { code: 'HASH' });
            }
            return 'sha256';
        }
        if (file.sha1git) {
            const h = await hashFile(p, 'sha1', 'blob ' + size + '\0');
            if (h !== String(file.sha1git).toLowerCase()) {
                fs.unlinkSync(p);
                throw Object.assign(new Error(file.name + ' failed its checksum (git sha1), so it was deleted. Try again.'), { code: 'HASH' });
            }
            return 'sha1';
        }
        return 'size';
    }

    /* Downloads (or resumes) one file into <tab root>\_downloads and verifies it.
       Returns the path of the verified file. */
    const verifiedArtifacts = {};   // sha256 -> path, reused by other tabs' queued installs of the same file
    async function downloadVerified(job, file) {
        if (file.sha256 && verifiedArtifacts[file.sha256] && exists(verifiedArtifacts[file.sha256])) {
            job.reused = true;
            job.received += file.size || 0;
            return { path: verifiedArtifacts[file.sha256], shared: true, check: 'sha256' };
        }
        const dir = path.join(tabRoot(job.tab), '_downloads');
        mkdirp(dir);
        const key = (file.sha256 || file.sha1git || crypto.createHash('sha1').update(file.url).digest('hex')).slice(0, 16);
        const done = path.join(dir, key + '-' + safeName(file.name));
        const part = done + '.part', meta = part + '.json';
        job.currentPart = part;
        // Already downloaded and verified (e.g. before a pause): reuse it.
        if (exists(done) && (!file.size || fs.statSync(done).size === file.size)) {
            job.received += file.size || fs.statSync(done).size;
            if (file.sha256) verifiedArtifacts[file.sha256] = done;
            return { path: done, shared: false, check: file.sha256 ? 'sha256' : file.sha1git ? 'sha1' : 'size' };
        }
        let start = 0;
        try {
            const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
            if (m.url === file.url && m.size === file.size && exists(part)) start = fs.statSync(part).size;
        } catch (e) {}
        if (!start) { try { fs.unlinkSync(part); } catch (e) {} }
        if (file.size && start > file.size) { fs.unlinkSync(part); start = 0; }
        fs.writeFileSync(meta, JSON.stringify({ url: file.url, size: file.size }));
        job.resumedFrom = (job.resumedFrom || 0) + start;
        job.received += start;
        if (!(file.size && start === file.size)) {
            job.stage = 'downloading';
            emit({ tab: job.tab, id: job.id, job: job });
            await fetchToPart(job, file, part, start);
        }
        job.stage = 'verifying';
        emit({ tab: job.tab, id: job.id, job: job });
        const check = await verifyFile(part, file);
        if (exists(done)) fs.unlinkSync(done);
        fs.renameSync(part, done);
        try { fs.unlinkSync(meta); } catch (e) {}
        if (file.sha256) verifiedArtifacts[file.sha256] = done;
        return { path: done, shared: false, check: check };
    }

    // ------------------------------------------------------------------ extraction
    function tarExe() { return config.tarExe || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); }

    async function extract(job, def, archive, type, outDir) {
        mkdirp(outDir);
        let tarErr = '';
        if (exists(tarExe())) {
            const patterns = def.extractPatterns || [];
            let r = await run(job, tarExe(), ['-xf', archive, '-C', outDir].concat(patterns));
            if (job.cancelled) throw cancelledError();
            if (r.code === 0) return;
            tarErr = firstLine(r.stderr);
            if (patterns.length) {   // an older tar may not support the name patterns
                rmrf(outDir); mkdirp(outDir);
                r = await run(job, tarExe(), ['-xf', archive, '-C', outDir]);
                if (job.cancelled) throw cancelledError();
                if (r.code === 0) return;
                tarErr = firstLine(r.stderr) || tarErr;
            }
        } else tarErr = 'tar.exe is not available on this Windows version';

        if (type === '7z' && def.sevenZip) {   // fallback: the tab's own official 7zr.exe
            job.stage = 'preparing extractor';
            emit({ tab: job.tab, id: job.id, job: job });
            const seven = await ensureHelper(job, def.sevenZip);
            rmrf(outDir); mkdirp(outDir);
            job.stage = 'extracting';
            emit({ tab: job.tab, id: job.id, job: job });
            const r = await run(job, seven, ['x', '-y', '-bso0', '-bsp0', '-o' + outDir, archive]);
            if (job.cancelled) throw cancelledError();
            if (r.code === 0) return;
            throw new Error('Could not extract ' + path.basename(archive) + ' with 7-Zip: ' + (firstLine(r.stderr) || 'exit code ' + r.code));
        }
        throw new Error('Could not extract ' + path.basename(archive) + (tarErr ? ': ' + tarErr : ''));
    }

    /* Installs (if needed) a helper dependency of the same tab, e.g. caption's 7zr, and
       returns its executable path. Runs inside the current job, not through the queue. */
    async function ensureHelper(parentJob, helperId) {
        const r = resolve(parentJob.tab, helperId);
        if (r.state === 'managed') return r.path;
        const sub = newJob(parentJob.tab, helperId);
        sub.parent = parentJob;
        parentJob.subJob = sub;
        try { await performInstall(sub); }
        finally { parentJob.subJob = null; }
        return resolve(parentJob.tab, helperId).path;
    }

    // ------------------------------------------------------------------ install
    function newJob(tab, id) {
        return { key: tab + '/' + id, tab: tab, id: id, stage: 'queued', received: 0, total: 0, speed: 0,
                 cancelled: false, finished: false, error: null, info: null, startedAt: Date.now() };
    }

    function testArgsOk(def, r) {
        if (!def.verify) return true;
        const text = (r.stdout || '') + '\n' + (r.stderr || '');
        if (def.verify.expect) return def.verify.expect.test(text);
        return r.code === 0;
    }

    async function testRun(def, exePath) {
        if (!def.verify) return { ok: true, text: '' };
        const r = await run(null, exePath, def.verify.args || [], { timeout: def.verify.timeout || 60000, cwd: path.dirname(exePath) });
        const ok = testArgsOk(def, r);
        const text = firstLine(def.verify.pick ? def.verify.pick((r.stdout || '') + '\n' + (r.stderr || '')) : (r.stdout || r.stderr));
        return { ok: ok, text: text, code: r.code, detail: firstLine(r.stderr) };
    }

    async function performInstall(job) {
        const def = depDef(job.tab, job.id);
        if (!IS_WIN) throw new Error('Automatic installs are only available on Windows for now.');
        const tRoot = tabRoot(job.tab);
        const depDir = path.join(tRoot, job.id);

        job.stage = 'checking';
        emit({ tab: job.tab, id: job.id, job: job });
        const info = job.info || await latest(def, job.forceLatest);
        job.info = info;
        job.total = totalSize(info);
        const versionDir = path.join(depDir, safeName(info.versionKind === 'revision' ? info.version.slice(0, 12) : info.version));

        // Already installed and intact: just make it active.
        if (exists(path.join(versionDir, exeName(def.main)))) {
            const rec = readState(job.tab).deps[job.id];
            activate(job.tab, job.id, info, versionDir, rec && rec.versions && rec.versions[path.basename(versionDir)] || null);
            job.stage = 'done';
            return info;
        }

        // Disk space: the download plus room to extract it next to the old version.
        mkdirp(tRoot);
        const factor = info.archive === 'zip' || info.archive === '7z' ? (def.extractFactor || 2.2) : 1.05;
        const needed = Math.round(job.total * factor) + 200 * 1024 * 1024;
        const free = await freeBytes(tRoot);
        if (free !== null && free < needed) {
            throw new Error('Not enough disk space in ' + tRoot + ': ' + formatBytes(needed) + ' needed, ' + formatBytes(free) + ' free. Free some space or choose another dependencies folder.');
        }

        const downloaded = [];
        let staging = null;
        try {
            for (const file of info.files) {
                if (job.cancelled) throw cancelledError();
                downloaded.push(Object.assign({ file: file }, await downloadVerified(job, file)));
            }

            staging = path.join(depDir, '_staging', Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
            const extractDir = path.join(staging, 'x'), outDir = path.join(staging, 'out');
            mkdirp(outDir);
            job.stage = info.archive === 'file' || info.archive === 'files' ? 'installing' : 'extracting';
            emit({ tab: job.tab, id: job.id, job: job });

            if (info.archive === 'file') {
                moveInto(downloaded[0].path, path.join(outDir, exeName(def.main)), downloaded[0].shared);
            } else if (info.archive === 'files') {
                downloaded.forEach(d => moveInto(d.path, path.join(outDir, def.filesSubdir || '', d.file.name), d.shared));
            } else {
                await extract(job, def, downloaded[0].path, info.archive, extractDir);
                if (def.collect) def.collect(extractDir, outDir, { findFile: findFile, moveInto: moveInto });
                else throw new Error('No install layout defined for ' + def.label);
                if (!exists(path.join(outDir, exeName(def.main)))) throw new Error(def.label + ': the downloaded archive did not contain ' + def.main + '.');
            }

            job.stage = 'testing';
            emit({ tab: job.tab, id: job.id, job: job });
            const test = await testRun(def, path.join(outDir, exeName(def.main)));
            if (!test.ok && !(def.verify && def.verify.lenient)) {
                throw new Error(def.label + ' was downloaded but did not run correctly' + (test.detail ? ': ' + test.detail : '') + '. Nothing was changed.');
            }

            // Atomic switch: the finished folder is renamed into place (same volume).
            job.stage = 'installing';
            if (exists(versionDir)) fs.renameSync(versionDir, versionDir + '.replaced-' + Date.now());   // kept, never deleted automatically
            fs.renameSync(outDir, versionDir);
            activate(job.tab, job.id, info, versionDir, {
                check: downloaded.map(d => d.check).join('+'), test: test.text || (test.ok ? 'ok' : 'could not confirm')
            });
            job.stage = 'done';
            return info;
        } finally {
            if (staging) rmrf(staging);
            // Paused: remember the finished files kept for the resume (a later cancel deletes them).
            if (job.pauseRequested) job.keptFiles = downloaded.filter(d => !d.shared).map(d => d.path);
            // Remove the downloaded files (including one reused from another tab's install)
            // unless a queued install of the same source will reuse them next.
            downloaded.forEach(d => {
                if (job.pauseRequested || !exists(d.path)) return;   // paused: keep finished files for the resume
                const reusedLater = d.file.sha256 && def.sourceKey && queue.some(q => {
                    try { return depDef(q.tab, q.id).sourceKey === def.sourceKey; } catch (e) { return false; }
                });
                if (reusedLater) return;
                try { fs.unlinkSync(d.path); } catch (e) {}
                if (d.file.sha256) delete verifiedArtifacts[d.file.sha256];
            });
        }
    }

    function activate(tab, id, info, versionDir, extra) {
        const st = readState(tab);
        const rec = st.deps[id] || (st.deps[id] = {});
        rec.versions = rec.versions || {};
        const dirName = path.basename(versionDir);
        const entry = Object.assign({}, rec.versions[dirName] || {}, {
            version: info.version, label: info.label || info.version, dir: dirName, source: info.source,
            files: info.files.map(f => ({ name: f.name, url: f.url, size: f.size, sha256: f.sha256 || undefined, sha1git: f.sha1git || undefined })),
            size: totalSize(info), publishedAt: info.publishedAt || null
        }, extra || {});
        if (!entry.installedAt) entry.installedAt = new Date().toISOString();
        if (rec.active && rec.active.dir !== dirName) rec.previous = rec.active;
        rec.active = entry;
        rec.versions[dirName] = entry;
        if (st.checks[id]) st.checks[id].updateAvailable = false;
        writeState(tab, st);
        emit({ tab: tab, id: id });
    }

    // ------------------------------------------------------------------ queue (one install at a time)
    const queue = [];
    let running = null;

    function install(tab, id, opts) {
        const key = tab + '/' + id;
        if (jobs[key] && !jobs[key].finished) return jobs[key].promise;
        depDef(tab, id);   // throws for unknown ids
        const job = newJob(tab, id);
        job.forceLatest = !!(opts && opts.forceLatest);
        if (opts && opts.info) job.info = opts.info;
        job.promise = new Promise(res => { job.resolve = res; });
        jobs[key] = job;
        queue.push(job);
        emit({ tab: tab, id: id, job: job });
        pump();
        return job.promise;
    }

    async function pump() {
        if (running || !queue.length) return;
        const job = running = queue.shift();
        let result;
        try {
            const info = await performInstall(job);
            result = { ok: true, version: info.version, label: info.label || info.version };
        } catch (e) {
            if (job.pauseRequested && !job.cancelled) {
                // Paused: the partial file stays; resume() puts the job back in the queue.
                job.stage = 'paused';
                job.speed = 0;
                job.abort = null;
                job.child = null;
                running = null;
                emit({ tab: job.tab, id: job.id, job: job });
                pump();
                return;
            }
            const cancelled = job.cancelled || e.code === 'CANCELLED';
            if (cancelled) discardPartial(job);
            result = { ok: false, cancelled: cancelled, error: cancelled ? 'Cancelled. The partial download was deleted.' : friendlyError(e), code: e.code };
            job.error = result.error;
        }
        finishJob(job, result);
        running = null;
        pump();
    }

    function finishJob(job, result) {
        job.finished = true;
        job.stage = result.ok ? 'done' : (result.cancelled ? 'cancelled' : 'failed');
        job.abort = null;
        emit({ tab: job.tab, id: job.id, job: job });
        job.resolve(result);
    }

    /* Deletes what a cancelled job downloaded: the current .part (+ its note) and any
       finished files kept from a pause. */
    function discardPartial(job) {
        const files = [].concat(job.keptFiles || []);
        if (job.currentPart) files.push(job.currentPart, job.currentPart + '.json');
        files.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
        job.keptFiles = [];
    }

    /* Pause: only while downloading (or while waiting in the queue). The partial file is
       kept; resume() continues from it with an HTTP Range request. */
    function pause(tab, id) {
        const job = jobs[tab + '/' + id];
        if (!job || job.finished || job.stage === 'paused') return false;
        const i = queue.indexOf(job);
        if (i !== -1) {
            queue.splice(i, 1);
            job.stage = 'paused';
            emit({ tab: tab, id: id, job: job });
            return true;
        }
        if (job !== running || job.stage !== 'downloading') return false;
        job.pauseRequested = true;
        if (job.abort) job.abort();
        if (job.child) { try { job.child.kill(); } catch (e) {} }
        return true;
    }

    function resume(tab, id) {
        const job = jobs[tab + '/' + id];
        if (!job || job.finished || job.stage !== 'paused') return false;
        job.pauseRequested = false;
        job.stage = 'queued';
        job.received = 0;
        job.speed = 0;
        queue.push(job);
        emit({ tab: tab, id: id, job: job });
        pump();
        return true;
    }

    function cancel(tab, id) {
        const job = jobs[tab + '/' + id];
        if (!job || job.finished) return;
        job.cancelled = true;
        const i = queue.indexOf(job);
        if (i !== -1 || (job.stage === 'paused' && job !== running)) {
            if (i !== -1) queue.splice(i, 1);
            discardPartial(job);
            job.error = job.currentPart ? 'Cancelled. The partial download was deleted.' : 'Cancelled before it started.';
            finishJob(job, { ok: false, cancelled: true, error: job.error });
            return;
        }
        [job, job.subJob].forEach(j => {
            if (!j) return;
            j.cancelled = true;
            if (j.abort) j.abort();
            if (j.child) { try { j.child.kill(); } catch (e) {} }
        });
    }

    /* Removes every installed (managed) version of a dependency. The tab then uses the
       legacy copy in bin\<platform>\<tab> if there is one, else it is missing again. */
    function uninstall(tab, id) {
        const j = jobFor(tab, id);
        if (j && !j.finished) throw new Error('Wait for the running download to finish (or cancel it) first.');
        const st = readState(tab), rec = st.deps[id];
        if (!rec || !rec.versions) return 0;
        let bytes = 0;
        const failed = [];
        Object.keys(rec.versions).forEach(k => {
            const dir = path.join(tabRoot(tab), id, k);
            if (exists(dir)) {
                const b = dirSize(dir);
                rmrf(dir);
                if (exists(dir)) failed.push(dir); else bytes += b;
            }
            if (!exists(dir)) delete rec.versions[k];
        });
        if (rec.active && !rec.versions[rec.active.dir]) rec.active = null;
        if (rec.previous && !rec.versions[rec.previous.dir]) rec.previous = null;
        if (!Object.keys(rec.versions).length) delete st.deps[id];
        if (st.checks[id]) st.checks[id].updateAvailable = false;
        writeState(tab, st);
        emit({ tab: tab, id: id });
        if (failed.length) throw new Error('Some files are in use and were not removed (' + failed.join(', ') + '). Close anything using them, for example a running transcription, and try again.');
        return bytes;
    }

    function jobFor(tab, id) { return jobs[tab + '/' + id] || null; }

    function friendlyError(e) {
        const code = e && e.code;
        const msg = (e && e.message) || String(e);
        if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Could not reach the download server. Check your internet connection and try again.';
        if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EPIPE') return 'The connection was interrupted (' + code + '). Try again: the download resumes where it stopped.';
        if (code === 'ENOSPC') return 'The disk is full. Free some space or choose another dependencies folder.';
        if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return 'Windows denied access to a file (' + code + '). Close programs that may be using it (or antivirus scanning it) and try again. ' + (e.path ? '(' + e.path + ')' : '');
        return msg;
    }

    // ------------------------------------------------------------------ updates, rollback, cleanup
    async function checkForUpdate(tab, id, opts) {
        opts = opts || {};
        const def = depDef(tab, id);
        const st = readState(tab);
        const cached = st.checks[id];
        if (opts.silent && cached && Date.now() - cached.at < DAY) return cached;
        let info;
        try { info = await latest(def, !opts.silent); }
        catch (e) { if (opts.silent) return cached || null; throw new Error(friendlyError(e)); }
        const r = resolve(tab, id);
        const newer = r.state === 'managed' && (info.versionKind === 'revision'
            ? info.version !== r.version
            : compareVersions(info.version, r.version) > 0);
        const result = {
            at: Date.now(), version: info.version, label: info.label || info.version, size: totalSize(info),
            publishedAt: info.publishedAt || null, current: r.version, state: r.state, updateAvailable: newer
        };
        const st2 = readState(tab);
        st2.checks[id] = result;
        writeState(tab, st2);
        emit({ tab: tab, id: id });
        return result;
    }

    /* At most one silent check per dependency per day; never throws. */
    async function dailyCheck(tab) {
        const t = registry[tab];
        if (!t) return;
        for (const d of t.deps) {
            if (d.hidden) continue;
            try { await checkForUpdate(tab, d.id, { silent: true }); } catch (e) {}
        }
    }

    function lastCheck(tab, id) { return readState(tab).checks[id] || null; }

    function rollback(tab, id) {
        const st = readState(tab);
        const rec = st.deps[id];
        if (!rec || !rec.previous) throw new Error('There is no previous version to roll back to.');
        const dir = path.join(tabRoot(tab), id, rec.previous.dir);
        if (!exists(path.join(dir, exeName(depDef(tab, id).main)))) throw new Error('The previous version (' + rec.previous.version + ') is no longer on disk.');
        const cur = rec.active;
        rec.active = rec.previous;
        rec.previous = cur;
        writeState(tab, st);
        emit({ tab: tab, id: id });
        return rec.active.version;
    }

    /* Installed version folders with their sizes (for "Delete old version"). */
    function versions(tab, id) {
        const rec = readState(tab).deps[id] || {};
        const all = Object.keys(rec.versions || {}).map(k => rec.versions[k]);
        return all.map(v => {
            const dir = path.join(tabRoot(tab), id, v.dir);
            return Object.assign({}, v, {
                path: dir, onDisk: exists(dir), bytes: exists(dir) ? dirSize(dir) : 0,
                isActive: !!(rec.active && rec.active.dir === v.dir), isPrevious: !!(rec.previous && rec.previous.dir === v.dir)
            });
        });
    }

    function deleteVersion(tab, id, dirName) {
        const st = readState(tab);
        const rec = st.deps[id];
        if (!rec || !rec.versions || !rec.versions[dirName]) throw new Error('Unknown version folder ' + dirName);
        if (rec.active && rec.active.dir === dirName) throw new Error('The active version cannot be deleted.');
        const dir = path.join(tabRoot(tab), id, dirName);
        const bytes = exists(dir) ? dirSize(dir) : 0;
        rmrf(dir);
        if (exists(dir)) throw new Error('Could not delete ' + dir + '. Close programs that may be using it and try again.');
        delete rec.versions[dirName];
        if (rec.previous && rec.previous.dir === dirName) rec.previous = null;
        writeState(tab, st);
        emit({ tab: tab, id: id });
        return bytes;
    }

    /* Runs the resolved program (managed or legacy) and returns what it reported. */
    async function test(tab, id) {
        const def = depDef(tab, id);
        const r = resolve(tab, id);
        if (r.state === 'missing') return { ok: false, text: 'Not installed.' };
        if (!def.verify) return { ok: true, text: 'Files present.' };
        return testRun(def, r.path);
    }

    function openFolder(dir) {
        if (!dir) return;
        try { mkdirp(dir); } catch (e) {}
        const opener = IS_WIN ? 'explorer.exe' : 'open';
        try { cp.spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    }

    // ------------------------------------------------------------------ UI (shared panel markup)
    /* Renders the dependency list of one tab into `container` (used by the tab
       settings panels and the welcome dialog). Styles: css/deps.css (rfxdep-*). */
    const ui = (function () {
        function el(tag, cls, text) {
            const n = root.document.createElement(tag);
            if (cls) n.className = cls;
            if (text !== undefined && text !== null) n.textContent = text;
            return n;
        }
        /* Paths are shown right-to-left so long ones lose their start, not their end;
           left-to-right marks keep leading/trailing punctuation in place. */
        function ltr(s) { const m = String.fromCharCode(0x200E); return m + s + m; }
        function button(label, cls, onClick, tooltip) {
            const b = el('button', 'rfxdep-btn ' + (cls || ''), label);
            if (tooltip) b.setAttribute('data-tooltip', tooltip);
            b.addEventListener('click', ev => { ev.stopPropagation(); onClick(b); });
            return b;
        }
        function progressPct(job) { return job.total ? Math.min(100, job.received / job.total * 100) : 0; }

        function stageText(job) {
            if (job.stage === 'queued') return 'Waiting for other downloads...';
            if (job.stage === 'checking') return 'Looking up the latest version...';
            if (job.stage === 'downloading' || job.stage === 'paused') {
                const pct = progressPct(job);
                const sizes = formatBytes(job.received) + ' of ' + formatBytes(job.total);
                if (job.stage === 'paused') return 'Paused at ' + pct.toFixed(0) + '%  -  ' + sizes + '. Resume continues from here.';
                const left = job.speed > 1 ? formatDuration((job.total - job.received) / job.speed) : '';
                return pct.toFixed(0) + '%  -  ' + sizes + (job.speed > 1 ? '  -  ' + formatBytes(job.speed) + '/s' : '') + (left ? '  -  ' + left + ' left' : '');
            }
            if (job.stage === 'verifying') return 'Verifying the download...';
            if (job.stage === 'extracting') return 'Extracting...';
            if (job.stage === 'preparing extractor') return 'Getting the 7-Zip extractor...';
            if (job.stage === 'testing') return 'Checking that it runs...';
            if (job.stage === 'installing') return 'Installing...';
            return '';
        }

        /* refs[id] = { stage, fill, text } lets progress events update a row in place, so
           its buttons are never rebuilt under the mouse (a rebuilt button loses the click). */
        function renderDep(tab, def, msgs, refs) {
            const r = resolve(tab, def.id);
            const job = jobFor(tab, def.id);
            const busy = job && !job.finished;
            const check = lastCheck(tab, def.id);
            const row = el('div', 'rfxdep-item');

            const head = el('div', 'rfxdep-head');
            head.appendChild(el('div', 'rfxdep-name', def.label));
            let chip;
            if (busy && job.stage === 'paused') chip = el('span', 'rfxdep-chip is-legacy', 'Paused');
            else if (busy) chip = el('span', 'rfxdep-chip is-busy', job.stage === 'downloading' ? 'Downloading' : job.stage === 'queued' ? 'Waiting' : 'Working');
            else if (r.state === 'managed' && check && check.updateAvailable) chip = el('span', 'rfxdep-chip is-update', 'Update available');
            else if (r.state === 'managed') chip = el('span', 'rfxdep-chip is-ok', 'Installed');
            else if (r.state === 'legacy') chip = el('span', 'rfxdep-chip is-legacy', 'Existing install');
            else chip = el('span', 'rfxdep-chip is-missing', 'Missing');
            head.appendChild(chip);
            row.appendChild(head);
            if (def.description) row.appendChild(el('div', 'rfxdep-desc', def.description));

            let status;
            if (r.state === 'managed') status = 'Version ' + ((r.active && r.active.label) || r.version) + (r.active && r.active.test ? '  -  reports: ' + r.active.test : '');
            else if (r.state === 'legacy') status = 'Existing install in the extension folder, version unknown. It is used as is.';
            else status = r.brokenManaged ? 'The installed files are missing. Install again.' : 'Not installed.' + (def.sizeHint ? ' Download size about ' + def.sizeHint + '.' : '');
            row.appendChild(el('div', 'rfxdep-status', status));
            if (r.path) { const p = el('div', 'rfxdep-path', ltr(r.dir)); p.title = r.path; row.appendChild(p); }

            if (busy) {
                const bar = el('div', 'rfxdep-progress');
                const fill = el('div', 'rfxdep-progress-fill');
                const measured = job.stage === 'downloading' || job.stage === 'paused';
                fill.style.width = (measured ? progressPct(job) : (job.stage === 'queued' || job.stage === 'checking' ? 0 : 100)) + '%';
                if (!measured) bar.classList.add('is-indeterminate');
                if (job.stage === 'paused') bar.classList.add('is-paused');
                bar.appendChild(fill);
                row.appendChild(bar);
                const line = el('div', 'rfxdep-progress-text', stageText(job));
                row.appendChild(line);
                refs[def.id] = { stage: job.stage, fill: fill, text: line };
            } else delete refs[def.id];

            const msg = msgs[def.id];
            if (!busy && job && job.finished && job.error) row.appendChild(el('div', 'rfxdep-msg ' + (job.stage === 'cancelled' ? '' : 'is-error'), job.error));
            else if (msg) row.appendChild(el('div', 'rfxdep-msg ' + (msg.kind ? 'is-' + msg.kind : ''), msg.text));

            const actions = el('div', 'rfxdep-actions');
            const say = (text, kind) => { msgs[def.id] = { text: text, kind: kind }; emit({ tab: tab, id: def.id }); };
            if (busy) {
                if (job.stage === 'downloading') actions.appendChild(button('Pause', '', () => pause(tab, def.id), 'Stop for now; Resume continues from where it stopped'));
                if (job.stage === 'paused') actions.appendChild(button('Resume', 'is-primary', () => resume(tab, def.id)));
                actions.appendChild(button('Cancel', 'is-danger', () => cancel(tab, def.id), 'Stop and delete what was downloaded'));
            } else {
                if (r.state !== 'managed') {
                    actions.appendChild(button(r.state === 'legacy' ? 'Install managed copy' : 'Install', 'is-primary', () => {
                        delete msgs[def.id];
                        install(tab, def.id).then(res => { if (res.ok) say('Installed ' + res.label + '.', 'ok'); });
                    }, r.state === 'legacy' ? 'Download the official version into the dependencies folder and use it instead of the existing copy' : null));
                }
                if (r.state === 'managed' && check && check.updateAvailable) {
                    actions.appendChild(button('Update to ' + (check.label || check.version) + ' (' + formatBytes(check.size) + ')', 'is-primary', () => {
                        if (def.updateWarning && !root.confirm(def.updateWarning(check))) return;
                        delete msgs[def.id];
                        install(tab, def.id, { forceLatest: true }).then(res => { if (res.ok) say('Updated to ' + res.label + '. You can roll back below.', 'ok'); });
                    }));
                }
                actions.appendChild(button('Check for updates', '', b => {
                    b.disabled = true;
                    b.textContent = 'Checking...';
                    checkForUpdate(tab, def.id).then(c => {
                        if (c.state !== 'managed') say('Latest version: ' + (c.label || c.version) + ' (' + formatBytes(c.size) + ').', '');
                        else if (c.updateAvailable) say('Update available: ' + (c.label || c.version) + ' (' + formatBytes(c.size) + '). You have ' + ((r.active && r.active.label) || r.version) + '.', 'update');
                        else say('Up to date (' + ((r.active && r.active.label) || r.version) + ').', 'ok');
                    }).catch(e => say(e.message, 'error'));
                }));
                if (r.state === 'managed' && r.previous) {
                    actions.appendChild(button('Roll back to ' + (r.previous.label || r.previous.version), '', () => {
                        try { say('Now using ' + rollback(tab, def.id) + '.', 'ok'); } catch (e) { say(e.message, 'error'); }
                    }, 'Switch back to the version you had before the last update'));
                }
                const old = r.state === 'managed' ? versions(tab, def.id).filter(v => !v.isActive && v.onDisk) : [];
                old.forEach(v => {
                    actions.appendChild(button('Delete ' + (v.label || v.version) + ' (frees ' + formatBytes(v.bytes) + ')', 'is-danger', () => {
                        if (!root.confirm('Delete version ' + (v.label || v.version) + '? This frees ' + formatBytes(v.bytes) + '. You will not be able to roll back to it.')) return;
                        try { say('Deleted ' + (v.label || v.version) + ', freed ' + formatBytes(deleteVersion(tab, def.id, v.dir)) + '.', 'ok'); } catch (e) { say(e.message, 'error'); }
                    }));
                });
                if (r.state !== 'missing' && def.verify) {
                    actions.appendChild(button('Test', '', b => {
                        b.disabled = true;
                        test(tab, def.id).then(t => say(t.ok ? 'Runs correctly: ' + (t.text || 'ok') : 'Did not run correctly: ' + (t.detail || t.text || 'no output'), t.ok ? 'ok' : 'error'));
                    }, 'Run it once to check it works'));
                }
                if (r.dir) actions.appendChild(button('Show folder', 'is-ghost', () => openFolder(r.dir)));
                if (r.state === 'managed') {
                    actions.appendChild(button('Remove', 'is-danger', () => {
                        const all = versions(tab, def.id).filter(v => v.onDisk);
                        const bytes = all.reduce((n, v) => n + v.bytes, 0);
                        const fallback = legacyLookup(def);
                        if (!root.confirm('Remove ' + def.label + ' (' + formatBytes(bytes) + (all.length > 1 ? ', ' + all.length + ' versions' : '') + ')?\n\n' +
                            (fallback ? 'The tab will use the existing copy in the extension folder again.' : 'The tab will need it downloaded again before it can use it.'))) return;
                        try { say('Removed ' + def.label + ', freed ' + formatBytes(uninstall(tab, def.id)) + '.', 'ok'); } catch (e) { say(e.message, 'error'); }
                    }, 'Delete the downloaded files of this tool from the dependencies folder'));
                }
            }
            row.appendChild(actions);
            return row;
        }

        /* opts: { showFolder: true } */
        function renderPanel(container, tab, opts) {
            opts = opts || {};
            const msgs = {}, refs = {};
            let pending = null;
            const draw = () => {
                pending = null;
                const t = registry[tab];
                container.innerHTML = '';
                if (!t) { container.appendChild(el('div', 'rfxdep-msg is-error', 'No dependencies registered for ' + tab + '.')); return; }
                if (opts.showFolder !== false) container.appendChild(folderRow(tab));
                const list = el('div', 'rfxdep-list');
                t.deps.filter(d => !d.hidden).forEach(d => list.appendChild(renderDep(tab, d, msgs, refs)));
                container.appendChild(list);
            };
            draw();
            const off = on(evt => {
                if (!container.isConnected) { off(); return; }
                if (evt.tab && evt.tab !== tab) return;
                const ref = evt.progress && evt.job && refs[evt.id];
                if (ref && ref.stage === evt.job.stage) {   // progress only: update in place
                    ref.fill.style.width = progressPct(evt.job) + '%';
                    ref.text.textContent = stageText(evt.job);
                    return;
                }
                if (!pending) pending = setTimeout(draw, 120);
            });
            dailyCheck(tab);
            return { redraw: draw, destroy: off };
        }

        function folderRow(tab) {
            const wrap = el('div', 'rfxdep-folder');
            wrap.appendChild(el('div', 'rfxdep-label', 'Dependencies folder'));
            const rowEl = el('div', 'rfxdep-folder-row');
            const p = el('span', 'rfxdep-folder-path', ltr(tabRoot(tab)));
            p.title = tabRoot(tab);
            rowEl.appendChild(p);
            rowEl.appendChild(button('Change', '', () => {
                const busy = (registry[tab] ? registry[tab].deps : []).some(d => { const j = jobFor(tab, d.id); return j && !j.finished; });
                if (busy) { root.alert('Wait for the running download to finish (or cancel it) before changing the folder.'); return; }
                const pick = root.cep && root.cep.fs && root.cep.fs.showOpenDialogEx(false, true, 'Choose a folder for this tab\'s dependencies', tabRoot(tab), []);
                if (!pick || !pick.data || !pick.data.length) return;
                if (!root.confirm('Use this folder for this tab\'s dependencies?\n\n' + pick.data[0] + '\n\nNothing is moved: files already installed stay in the old folder (switch back any time to use them again, or delete them yourself). Downloads in the new folder start fresh.')) return;
                setTabRoot(tab, pick.data[0]);
            }));
            if (!isDefaultTabRoot(tab)) rowEl.appendChild(button('Reset', 'is-ghost', () => setTabRoot(tab, null), 'Go back to the default folder'));
            wrap.appendChild(rowEl);
            return wrap;
        }

        /* A settings dialog in the same look as the Assets settings panel. */
        function modal(id, title) {
            const old = root.document.getElementById(id);
            if (old) old.remove();
            const overlay = el('div', 'rfxdep-overlay');
            overlay.id = id;
            const card = el('div', 'rfxdep-card');
            const head = el('div', 'rfxdep-card-head');
            head.appendChild(el('div', 'rfxdep-card-title', title));
            const x = el('button', 'rfxdep-x');
            x.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            head.appendChild(x);
            card.appendChild(head);
            const body = el('div', 'rfxdep-card-body');
            card.appendChild(body);
            const foot = el('div', 'rfxdep-card-foot');
            const done = el('button', 'rfxdep-done', 'Done');
            foot.appendChild(done);
            card.appendChild(foot);
            overlay.appendChild(card);
            const close = () => overlay.remove();
            x.onclick = close;
            done.onclick = close;
            overlay.addEventListener('mousedown', ev => { if (ev.target === overlay) close(); });
            root.document.body.appendChild(overlay);
            return { overlay: overlay, body: body, foot: foot, close: close };
        }

        function section(label) {
            const s = el('div', 'rfxdep-section');
            if (label) s.appendChild(el('div', 'rfxdep-label', label));
            return s;
        }

        return { renderPanel: renderPanel, folderRow: folderRow, modal: modal, section: section, el: el, button: button, ltr: ltr };
    })();

    const api = {
        configure: function (opts) { Object.assign(config, opts || {}); },
        register: register, tabs: tabs, depDef: depDef, resolve: resolve,
        tabRoot: tabRoot, setTabRoot: setTabRoot, isDefaultTabRoot: isDefaultTabRoot, defaultRoot: defaultRoot,
        install: install, cancel: cancel, pause: pause, resume: resume, uninstall: uninstall, job: jobFor,
        checkForUpdate: checkForUpdate, dailyCheck: dailyCheck, lastCheck: lastCheck,
        rollback: rollback, versions: versions, deleteVersion: deleteVersion, test: test,
        latest: function (tab, id, force) { return latest(depDef(tab, id), force); },
        on: on, sources: sources, formatBytes: formatBytes, openFolder: openFolder,
        extensionRoot: extensionRoot, ui: ui,
        _internals: { curlExe: curlExe, extract: extract, ghRecentReleases: ghRecentReleases, ghFile: ghFile, compareVersions: compareVersions, verifyFile: verifyFile, hashFile: hashFile, readState: readState }
    };
    root.RFXDeps = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
