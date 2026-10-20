#!/usr/bin/env node
'use strict';
// Command line for the CMS.
//   cms build  [--site .] [--out dist]   build the site, the editor and the editor functions
//   cms sync   [--site .]                copy the engine's editor functions into the site (build does this too)
//   cms init   <folder>                  start a new client site
//   cms version
const fs = require('fs');
const path = require('path');

const ENGINE = path.resolve(__dirname, '..');
const pkg = require('../package.json');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const copy = (src, dst) => fs.cpSync(src, dst, { recursive: true, force: true });

function loadConfig(site) {
  const p = path.join(site, 'cms.config.json');
  if (!fs.existsSync(p)) throw new Error('No cms.config.json in ' + site + '. Run cms init for a new site.');
  return readJson(p);
}

// The editor functions and the page builder live in the engine. Netlify looks for functions
// in the site's own netlify folder, so they are copied there. These copies are generated:
// the site keeps them out of git and never edits them.
function sync(site) {
  copy(path.join(ENGINE, 'netlify/functions'), path.join(site, 'netlify/functions'));
  copy(path.join(ENGINE, 'netlify/lib'), path.join(site, 'netlify/lib'));
  fs.mkdirSync(path.join(site, 'cms/build'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ENGINE, 'build'))) {
    copy(path.join(ENGINE, 'build', f), path.join(site, 'cms/build', f));
  }
  // functions that belong to this one site (a branded form email, say) live in netlify/site-functions
  const own = path.join(site, 'netlify/site-functions');
  if (fs.existsSync(own)) copy(own, path.join(site, 'netlify/functions'));
}

function build(site, out) {
  const config = loadConfig(site);
  const blocks = path.join(site, 'cms/blocks.json');
  if (!fs.existsSync(blocks)) throw new Error('Missing cms/blocks.json in ' + site);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(path.join(site, 'assets'))) copy(path.join(site, 'assets'), path.join(out, 'assets'));
  copy(path.join(ENGINE, 'admin'), path.join(out, 'admin'));
  copy(blocks, path.join(out, 'admin/blocks.json'));
  for (const rel of config.copy || []) {
    const from = path.join(site, rel);
    if (fs.existsSync(from)) copy(from, path.join(out, rel));
  }
  const r = require('../build/render').build(site, out);
  r.written.forEach(f => console.log('built ' + f));
  r.warnings.forEach(w => console.warn('warning: ' + w));
  sync(site);
  console.log('synced editor functions');
}

const cmd = process.argv[2];
try {
  const site = path.resolve(arg('site', '.'));
  if (cmd === 'build') build(site, path.resolve(arg('out', path.join(site, 'dist'))));
  else if (cmd === 'sync') { sync(site); console.log('synced editor functions'); }
  else if (cmd === 'init') require('../init')(ENGINE, path.resolve(process.argv[3] || ''));
  else if (cmd === 'version') console.log(pkg.version);
  else { console.log('Usage: cms build | sync | init <folder> | version'); process.exit(cmd ? 1 : 0); }
} catch (e) {
  console.error('Stopped: ' + e.message);
  process.exit(1);
}
