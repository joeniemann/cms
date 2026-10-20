#!/usr/bin/env node
'use strict';
// CMS build.
//   node render.js --site <site folder> --out <output folder>
// Reads  <site>/content/*.json  and  <site>/templates/**  and writes the pages.

const fs = require('fs');
const path = require('path');
const { parse, tokenize, renderNodes, esc, escAttr } = require('./engine');
const seo = require('./seo');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

function compile(siteDir, ov) {
  ov = ov || {};
  const rd = p => fs.readFileSync(path.join(siteDir, p), 'utf8');
  const json = p => JSON.parse(rd(p));
  const site = ov.site || json('content/site.json');
  const photoList = json('content/photos.json').photos;
  const gallery = json('content/gallery.json');
  const pageFiles = fs.readdirSync(path.join(siteDir, 'content/pages')).filter(f => f.endsWith('.json')).sort();
  const pages = pageFiles.map(f => json('content/pages/' + f)).map(p => (ov.pages && ov.pages[p.id]) || p);
  // pages that exist only in an edit that is not saved yet (a brand-new page being previewed)
  Object.values(ov.pages || {}).forEach(p => { if (!pages.some(x => x.id === p.id)) pages.push(p); });
  const isLive = p => p.published !== false && !p.archived;
  const liveIds = new Set(pages.filter(isLive).map(p => p.id));
  const pageById = Object.fromEntries(pages.map(p => [p.id, p]));
  // menu items that point at a page that is not live are left out
  const menuFixed = Object.assign({}, site.menu, {
    items: site.menu.items.map(i => (i.page && !liveIds.has(i.page) ? Object.assign({}, i, { show: false }) : i))
  });
  const photoById = Object.fromEntries(photoList.map(p => [p.id, p]));
  const warnings = [];

  // the menu as the site shows it: top-level items, each with the items tucked under it
  const shownItems = menuFixed.items.filter(i => i.show !== false);
  const menuTree = shownItems.filter(i => !i.parent).map(i =>
    Object.assign({}, i, { children: shownItems.filter(c => c.parent && c.parent !== c.page && c.parent === i.page) }));

  // ---------- derived values ----------
  const b = site.business;
  const digits = b.phone.replace(/\D/g, '');
  const cityNoComma = b.cityLine.replace(/,/g, '');
  const derived = {
    phoneHref: 'tel:+1' + digits,
    mapq: encodeURIComponent(b.street + ' ' + cityNoComma).replace(/%20/g, '+'),
    mapEmbedQ: encodeURIComponent(b.street + ', ' + b.cityLine).replace(/%20/g, '+').replace(/%2C/g, ','),
    mapTitleAddress: b.street + ', ' + cityNoComma,
    socialLinks: [
      ['facebook', 'Facebook', 'fa-facebook-f'],
      ['instagram', 'Instagram', 'fa-instagram'],
      ['tiktok', 'TikTok', 'fa-tiktok']
    ].filter(([k]) => b.social && b.social[k]).map(([k, label, icon]) => ({ key: k, label, icon, url: b.social[k] }))
  };
  const photoCount = gallery.items.filter(i => !i.hidden).length;

  // ---------- helpers ----------
  const photoOf = p => {
    const id = typeof p === 'string' ? p : p && p.id;
    const ph = photoById[id];
    if (!ph) throw new Error('Photo not found in the library: ' + id);
    return ph;
  };
  function linkHref(l) {
    if (!l) return '#';
    if (typeof l === 'string') return l;
    if (l.url) return l.url;
    if (l.phone) return derived.phoneHref;
    if (l.email) return 'mailto:' + b.email;
    if (l.page) {
      const pg = pageById[l.page];
      if (!pg) { warnings.push('Link points to a page that does not exist: ' + l.page); return '#'; }
      if (!isLive(pg)) warnings.push('Link points to a page that is not on the site: ' + l.page);
      return pg.file + (l.anchor ? '#' + l.anchor : '');
    }
    return '#';
  }
  const ALLOWED = new Set(['b', 'i', 'em', 'strong', 'a', 'br']);
  function sanitize(s) {
    s = String(s == null ? '' : s).replace(/&(?!#?\w+;)/g, '&amp;');
    return s.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (m, close, tag, rest) => {
      tag = tag.toLowerCase();
      if (!ALLOWED.has(tag)) return '';
      if (close) return '</' + tag + '>';
      if (tag === 'a') {
        const h = /href="([^"]*)"/.exec(rest);
        return h && /^(https?:|mailto:|tel:|[a-z0-9_.\-]+\.html)/i.test(h[1]) ? '<a href="' + h[1] + '">' : '<a>';
      }
      return '<' + tag + '>';
    });
  }
  const helpers = {
    br: v => esc(v).replace(/\n/g, '<br>'),
    attr: v => escAttr(v),
    rich: v => sanitize(v),
    href: v => escAttr(linkHref(v)),
    eyebrow: v => esc(v).replace(/ × /g, ' <i>&times;</i> ').replace(/ · /g, ' &nbsp;&middot;&nbsp; '),
    delay: (i, step) => (i > 0 ? ' data-reveal-delay="' + i * Number(step) + '"' : ''),
    backdropClass: v => (v === 'sewing' ? ' band--whatwedo' : v === 'welding' ? ' band--howwework' : ''),
    tileClass: i => (i === 0 ? ' shop-tile--tall' : i === 3 ? ' shop-tile--wide' : ''),
    pressed: first => (first ? 'true' : 'false'),
    photoSrc: p => escAttr(photoOf(p).file),
    photoAlt: p => escAttr(p && typeof p === 'object' && p.alt != null ? p.alt : photoOf(p).alt),
    alignClass: v => (v === 'center' || v === 'right' ? ' phead-stats--' + v : ''),
    tens: i => String(Math.floor((i + 1) / 10)),
    ones: i => String((i + 1) % 10)
  };

  // ---------- templates ----------
  const cache = {};
  function loadTemplate(rel) {
    if (!cache[rel]) cache[rel] = parse(tokenize(rd(rel)));
    return cache[rel];
  }
  function partial(name) {
    for (const rel of ['templates/partials/' + name + '.html', 'templates/blocks/_' + name + '.html']) {
      if (fs.existsSync(path.join(siteDir, rel))) return loadTemplate(rel);
    }
    throw new Error('Partial not found: ' + name);
  }
  const env = { helpers, partial };

  const THEMED = new Set(['pageHeader', 'cardRow', 'textPhoto', 'photoMosaic', 'timeline', 'contactSection']);
  function blockTemplate(block) {
    if (block.type === 'serviceFeature') return 'templates/blocks/serviceFeature-' + (block.version || 'plain') + '.html';
    return 'templates/blocks/' + block.type + '.html';
  }
  function resolveFacts(block) {
    if (block.factsFromHours) return b.hours.map(h => ({ big: h.days, label: h.times }));
    if (!block.facts) return block.facts;
    return block.facts.map(f => {
      if (f.auto === 'photoCount') return { big: String(photoCount), label: f.label };
      if (f.auto === 'categoryCount') return { big: String(gallery.categories.length), label: f.label };
      return f;
    });
  }

  // The gallery is drawn by site.js, but the tiles are also written into the page so search
  // engines and AI tools that do not run scripts can still see every photo and its alt text.
  function galleryTiles() {
    return gallery.items.filter(i => !i.hidden).map((i, n) => {
      const ph = photoOf(i.photo);
      const alt = escAttr(ph.alt);
      return '<button class="tile in" type="button" aria-label="Open image: ' + alt + '" data-i="' + n + '">' +
        '<img src="' + escAttr(ph.thumb || ph.file) + '" alt="' + alt + '" loading="' + (n < 12 ? 'eager' : 'lazy') + '" decoding="async">' +
        '<figcaption>' + esc(ph.alt) + '</figcaption></button>';
    }).join('\n');
  }

  const out = [];

  for (const page of pages) {
    const imageUrl = seo.shareImageUrl(site, page, photoById, gallery.items);
    const root = Object.assign({}, site, { menu: menuFixed, menuTree }, derived, {
      title: page.title, description: page.description, showCallBand: page.showCallBand !== false,
      seoHead: seo.headTags(site, page, imageUrl), jsonLd: seo.jsonLd(site, page, imageUrl),
      hasHero: page.blocks.some(x => x.type === 'homeHero'),
      hasGallery: page.blocks.some(x => x.type === 'galleryBrowser')
    });
    // light / dark alternation, with an optional override on each block
    let prev = null;
    let html = '';
    for (const block of page.blocks) {
      const ctx = Object.assign({}, block);
      if (THEMED.has(block.type) || (block.type === 'serviceFeature' && block.version !== 'finish')) {
        ctx.look = block.look || (prev == null ? 'dark' : prev === 'dark' ? 'light' : 'dark');
        prev = ctx.look;
      } else {
        prev = 'dark';
      }
      ctx.facts = resolveFacts(block);
      if (block.type === 'galleryBrowser') ctx.staticTiles = galleryTiles();
      const tpl = loadTemplate(blockTemplate(block));
      html += renderNodes(tpl, [{ ctx: root }, { ctx }], env);
      if (!html.endsWith('\n')) html += '\n';
    }
    root.blocks = html;
    let doc = renderNodes(loadTemplate('templates/page.html'), [{ ctx: root }], env);
    doc = doc.replace(/<!--[\s\S]*?-->/g, '');
    out.push({ id: page.id, file: page.file, html: doc, live: isLive(page), seo: page.seo });
  }
  const livePages = pages.filter(isLive);
  const extras = {
    'sitemap.xml': seo.sitemap(site, livePages),
    'robots.txt': seo.robots(site),
    'llms.txt': seo.llms(site, livePages),
    '_redirects': seo.redirects(site)
  };

  // gallery data for the browser script
  const items = gallery.items.filter(i => !i.hidden).map(i =>
    '  {f:' + JSON.stringify(i.photo) + ', cat:' + JSON.stringify(i.category) + ', alt:' + JSON.stringify(photoOf(i.photo).alt) + '}');
  const g = '/* Generated by the CMS build from content/gallery.json. Edit photos in the Gallery manager. */\n' +
    'window.CMS_GALLERY = [\n' + items.join(',\n') + '\n];\n\n' +
    'window.CMS_CATEGORIES = ' + JSON.stringify([{ id: 'all', label: 'All Work' }].concat(gallery.categories)) + ';\n\n' +
    'window.CMS_GROUPS = ' + JSON.stringify(gallery.groups) + ';\n';
  return { pages: out, galleryJs: g, extras, warnings };
}

function build(siteDir, outDir) {
  const r = compile(siteDir);
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const pg of r.pages) {
    if (!pg.live) continue; // new pages stay off the site until they are switched on
    fs.writeFileSync(path.join(outDir, pg.file), pg.html);
    written.push(pg.file);
  }
  fs.mkdirSync(path.join(outDir, 'assets/data'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'assets/data/gallery.js'), r.galleryJs);
  written.push('assets/data/gallery.js');
  // browsers ask for /favicon.ico at the site root even when the page names another icon
  const ico = path.join(siteDir, 'assets/icons/favicon.ico');
  if (fs.existsSync(ico)) { fs.copyFileSync(ico, path.join(outDir, 'favicon.ico')); written.push('favicon.ico'); }
  Object.keys(r.extras).forEach(name => {
    if (!r.extras[name]) return; // nothing to say (for example, no site address set yet)
    fs.writeFileSync(path.join(outDir, name), r.extras[name]);
    written.push(name);
  });
  return { written, warnings: r.warnings };
}

// Builds one page in memory from edits that are not saved yet (used by the live preview).
function renderPreview(siteDir, o) {
  const r = compile(siteDir, { site: o.site, pages: o.page ? { [o.page.id]: o.page } : undefined });
  const hit = r.pages.find(x => x.id === o.pageId);
  if (!hit) throw new Error('Page not found: ' + o.pageId);
  return hit.html;
}

if (require.main === module) {
  const site = path.resolve(arg('site', '.'));
  const out = path.resolve(arg('out', '.'));
  try {
    const r = build(site, out);
    r.written.forEach(f => console.log('built ' + f));
    r.warnings.forEach(w => console.warn('warning: ' + w));
  } catch (e) {
    console.error('Build stopped: ' + e.message);
    process.exit(1);
  }
}
module.exports = { build, compile, renderPreview };
