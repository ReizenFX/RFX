#!/usr/bin/env node
/*
 * Applies branding.json (the single source of truth for the product name, IDs and
 * version) to every file that carries them:
 *
 *   CSXS/manifest.xml  ExtensionBundleId / Name / Version, Extension Id + Version, <Menu>
 *   index.html         <title>
 *   package.json       name / version
 *   js/branding.js     window.APP (generated)
 *
 * Safe to re-run: a file is only rewritten when its content actually changes, and
 * every edit is printed. It never touches internal identifiers: localStorage keys,
 * on-disk data folders, Discord client IDs, bin/ paths and JSX globals stay as they are.
 *
 * Usage: node scripts/apply-branding.js   (or: npm run branding)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let changeCount = 0;

function fail(msg) {
    console.error('apply-branding: ' + msg);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Load + validate branding.json
// ---------------------------------------------------------------------------
let brand;
try {
    brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'branding.json'), 'utf8'));
} catch (e) {
    fail('cannot read branding.json: ' + e.message);
}

['appName', 'menuName', 'bundleId', 'extensionId', 'version'].forEach(function (k) {
    if (typeof brand[k] !== 'string' || !brand[k].trim()) fail('branding.json: "' + k + '" must be a non-empty string');
});
const REVERSE_DOMAIN = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/;
if (!REVERSE_DOMAIN.test(brand.bundleId)) fail('branding.json: bundleId "' + brand.bundleId + '" is not reverse-domain style (e.g. com.vendor.product)');
if (!REVERSE_DOMAIN.test(brand.extensionId)) fail('branding.json: extensionId "' + brand.extensionId + '" is not reverse-domain style');
if (!/^\d+\.\d+\.\d+$/.test(brand.version)) fail('branding.json: version "' + brand.version + '" must be MAJOR.MINOR.PATCH');
if (brand.extensionId.indexOf(brand.bundleId + '.') !== 0) {
    console.warn('apply-branding: warning: extensionId should start with bundleId + "." (Adobe convention)');
}

const npmName = brand.appName.toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '');
if (!npmName) fail('branding.json: appName "' + brand.appName + '" does not produce a usable package.json name');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Replace the value captured by group 2 of `re` (groups 1 and 3 are kept) in every
   match. The pattern must match exactly `expected` times, otherwise the file's
   structure is not what this script knows how to edit and it stops. */
function setField(text, rel, label, re, value, expected) {
    const matches = text.match(new RegExp(re.source, 'g')) || [];
    if (matches.length !== expected) fail(rel + ': expected ' + expected + ' match(es) for ' + label + ', found ' + matches.length);
    return text.replace(new RegExp(re.source, 'g'), function (m, pre, old, post) {
        if (old !== value) {
            console.log('    ' + label + ': "' + old + '" -> "' + value + '"');
            changeCount++;
        }
        return pre + value + post;
    });
}

function updateFile(rel, transform) {
    const file = path.join(ROOT, rel);
    const before = fs.readFileSync(file, 'utf8');
    console.log(rel);
    const after = transform(before, rel);
    if (after === before) {
        console.log('    (no change)');
        return;
    }
    fs.writeFileSync(file, after, 'utf8');
}

function writeGenerated(rel, content) {
    const file = path.join(ROOT, rel);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    console.log(rel);
    if (before === content) {
        console.log('    (no change)');
        return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    console.log('    ' + (before === null ? 'created' : 'regenerated'));
    changeCount++;
}

// ---------------------------------------------------------------------------
// CSXS/manifest.xml
// ---------------------------------------------------------------------------
updateFile('CSXS/manifest.xml', function (x, rel) {
    x = setField(x, rel, 'ExtensionBundleId', /(\bExtensionBundleId=")([^"]*)(")/, escXml(brand.bundleId), 1);
    x = setField(x, rel, 'ExtensionBundleName', /(\bExtensionBundleName=")([^"]*)(")/, escXml(brand.appName), 1);
    x = setField(x, rel, 'ExtensionBundleVersion', /(\bExtensionBundleVersion=")([^"]*)(")/, escXml(brand.version), 1);
    // <Extension Id> appears twice: in <ExtensionList> and in <DispatchInfoList>.
    x = setField(x, rel, 'Extension Id', /(<Extension\s+Id=")([^"]*)(")/, escXml(brand.extensionId), 2);
    x = setField(x, rel, 'Extension Version', /(<Extension\s+Id="[^"]*"\s+Version=")([^"]*)(")/, escXml(brand.version), 1);
    x = setField(x, rel, 'Menu', /(<Menu>)([^<]*)(<\/Menu>)/, escXml(brand.menuName), 1);
    return x;
});

// ---------------------------------------------------------------------------
// index.html
// ---------------------------------------------------------------------------
updateFile('index.html', function (x, rel) {
    return setField(x, rel, 'title', /(<title>)([^<]*)(<\/title>)/, escHtml(brand.appName), 1);
});

// ---------------------------------------------------------------------------
// package.json (created with just name/version if missing)
// ---------------------------------------------------------------------------
(function () {
    const rel = 'package.json';
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        writeGenerated(rel, JSON.stringify({ name: npmName, version: brand.version, private: true }, null, 2) + '\n');
        return;
    }
    updateFile(rel, function (text) {
        const pkg = JSON.parse(text);
        let changed = false;
        ['name', 'version'].forEach(function (k) {
            const value = k === 'name' ? npmName : brand.version;
            if (pkg[k] !== value) {
                console.log('    ' + k + ': "' + pkg[k] + '" -> "' + value + '"');
                pkg[k] = value;
                changed = true;
                changeCount++;
            }
        });
        if (!changed) return text;   // leave formatting untouched
        const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
        return JSON.stringify(pkg, null, 2).replace(/\n/g, eol) + eol;
    });
})();

// ---------------------------------------------------------------------------
// js/branding.js (generated)
// ---------------------------------------------------------------------------
writeGenerated('js/branding.js', [
    '// GENERATED by scripts/apply-branding.js from branding.json. Do not edit by hand:',
    '// change branding.json, then run `node scripts/apply-branding.js`.',
    'window.APP = Object.freeze(' + JSON.stringify({
        name: brand.appName,
        menuName: brand.menuName,
        version: brand.version,
        bundleId: brand.bundleId,
        extensionId: brand.extensionId
    }, null, 4) + ');',
    ''
].join('\n'));

console.log(changeCount ? '\n' + changeCount + ' change(s) applied.' : '\nAlready up to date.');
