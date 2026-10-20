'use strict';
// SEO, answer-engine and AI-search output for the CMS build.
// Everything here is built from the site's own content, so it cannot drift from what the pages say.
//   head tags (canonical, share tags), JSON-LD, sitemap.xml, robots.txt, llms.txt, _redirects

const { esc, escAttr } = require('./engine');

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'];

const baseUrl = site => String((site.seo && site.seo.siteUrl) || '').replace(/\/+$/, '');
const pageUrl = (site, page) => {
  const base = baseUrl(site);
  if (!base) return '';
  return page.file === 'index.html' ? base + '/' : base + '/' + page.file;
};
const plain = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function parseTime(t) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  return String(h).padStart(2, '0') + ':' + (m[2] || '00');
}

// "Mon-Fri" + "8am-5pm" -> schema.org opening hours. Rows that are not plain times ("By appointment") are skipped.
function openingHours(hours) {
  const out = [];
  (hours || []).forEach(h => {
    const times = String(h.times || '').split(/\s*[-–]\s*/);
    if (times.length !== 2) return;
    const opens = parseTime(times[0]), closes = parseTime(times[1]);
    if (!opens || !closes) return;
    const days = [];
    String(h.days || '').split(',').forEach(part => {
      const r = part.trim().toLowerCase().split(/\s*[-–]\s*/).map(x => x.slice(0, 3));
      const a = DAY_ORDER.indexOf(r[0]);
      const z = r.length > 1 ? DAY_ORDER.indexOf(r[1]) : a;
      if (a < 0 || z < a) return;
      for (let i = a; i <= z; i++) days.push(DAY_NAMES[DAY_ORDER[i]]);
    });
    if (days.length) out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens, closes });
  });
  return out;
}

function shareImageUrl(site, page, photoById, galleryItems) {
  const base = baseUrl(site);
  if (!base) return '';
  const id = (page.seo && page.seo.shareImage) || (site.seo && site.seo.shareImage) ||
    (galleryItems.find(i => !i.hidden) || {}).photo;
  const ph = id && photoById[id];
  return ph ? base + '/' + ph.file : '';
}

// canonical + share tags. Title and description stay in the page template.
function headTags(site, page, imageUrl) {
  const url = pageUrl(site, page);
  const b = site.business;
  const t = [];
  if (url) t.push('<link rel="canonical" href="' + escAttr(url) + '">');
  if (page.seo && page.seo.noindex) t.push('<meta name="robots" content="noindex, follow">');
  t.push('<meta property="og:title" content="' + escAttr(page.title) + '">');
  t.push('<meta property="og:description" content="' + escAttr(page.description) + '">');
  t.push('<meta property="og:type" content="website">');
  t.push('<meta property="og:site_name" content="' + escAttr(b.name) + '">');
  t.push('<meta property="og:locale" content="en_US">');
  if (url) t.push('<meta property="og:url" content="' + escAttr(url) + '">');
  if (imageUrl) t.push('<meta property="og:image" content="' + escAttr(imageUrl) + '">');
  t.push('<meta name="twitter:card" content="' + (imageUrl ? 'summary_large_image' : 'summary') + '">');
  t.push('<meta name="twitter:title" content="' + escAttr(page.title) + '">');
  t.push('<meta name="twitter:description" content="' + escAttr(page.description) + '">');
  if (imageUrl) t.push('<meta name="twitter:image" content="' + escAttr(imageUrl) + '">');
  return t.join('\n');
}

// LocalBusiness on the home and contact pages, Service on any page that has service blocks.
// Service areas. serviceArea can be one string (old way, one region) or a list of places.
// serviceRegion (optional string) is a broader region listed first, like "Central Florida".
function areaServed(site) {
  const seo = site.seo || {};
  const b = site.business || {};
  const st = /^(.+?),\s*([A-Za-z]{2})\s+\d{5}/.exec(b.cityLine || '');
  const state = st ? st[2].toUpperCase() : '';
  const out = [];
  if (seo.serviceRegion) out.push({ '@type': 'AdministrativeArea', name: seo.serviceRegion });
  const list = Array.isArray(seo.serviceArea) ? seo.serviceArea : [];
  if (typeof seo.serviceArea === 'string' && seo.serviceArea) out.push({ '@type': 'AdministrativeArea', name: seo.serviceArea });
  list.map(x => String(x || '').trim()).filter(Boolean).forEach(name => {
    const c = { '@type': 'City', name };
    if (state) c.containedInPlace = { '@type': 'AdministrativeArea', name: state };
    out.push(c);
  });
  return out;
}
function areaNames(site) {
  return areaServed(site).map(a => a.name);
}

function jsonLd(site, page, imageUrl) {
  const base = baseUrl(site);
  if (!base) return '';
  const b = site.business;
  const bizId = base + '/#business';
  const graph = [];
  if (page.type === 'home' || page.type === 'contact') {
    const biz = { '@type': 'LocalBusiness', '@id': bizId, name: b.name, url: base + '/' };
    if (b.shortName) biz.alternateName = b.shortName;
    if (b.description) biz.description = plain(b.description);
    if (b.phone) biz.telephone = '+1' + b.phone.replace(/\D/g, '');
    if (b.email) biz.email = b.email;
    if (imageUrl) biz.image = imageUrl;
    const city = /^(.+?),\s*([A-Za-z]{2})\s+(\d{5})/.exec(b.cityLine || '');
    if (b.street && city) {
      biz.address = { '@type': 'PostalAddress', streetAddress: b.street, addressLocality: city[1], addressRegion: city[2].toUpperCase(), postalCode: city[3], addressCountry: 'US' };
    }
    const hrs = openingHours(b.hours);
    if (hrs.length) biz.openingHoursSpecification = hrs;
    const sameAs = Object.values(b.social || {}).filter(Boolean);
    if (sameAs.length) biz.sameAs = sameAs;
    const areas = areaServed(site);
    if (areas.length) biz.areaServed = areas;
    graph.push(biz);
  }
  (page.blocks || []).filter(x => x.type === 'serviceFeature').forEach(x => {
    const name = plain(x.eyebrow || x.headline);
    if (!name) return;
    const s = { '@type': 'Service', name, provider: { '@id': bizId } };
    const desc = plain(x.text);
    if (desc) s.description = desc;
    const areas = areaServed(site);
    if (areas.length) s.areaServed = areas;
    if (x.anchor) s.url = pageUrl(site, page) + '#' + x.anchor;
    graph.push(s);
  });
  if (!graph.length) return '';
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2).replace(/</g, '\\u003c');
  return '<script type="application/ld+json">\n' + json + '\n</script>';
}

const indexable = p => !(p.seo && p.seo.noindex);

function sitemap(site, livePages) {
  if (!baseUrl(site)) return '';
  const urls = livePages.filter(indexable).map(p => '  <url><loc>' + esc(pageUrl(site, p)) + '</loc></url>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
}

function robots(site) {
  const base = baseUrl(site);
  const block = ua => 'User-agent: ' + ua + '\nAllow: /\nDisallow: /admin/\nDisallow: /style-guide.html\n';
  let out = block('*');
  if (!site.seo || site.seo.allowAiCrawlers !== false) out += '\n' + AI_BOTS.map(block).join('\n');
  if (base) out += '\nSitemap: ' + base + '/sitemap.xml\n';
  return out;
}

// llms.txt: a plain summary for AI tools. Only says what the site already says.
function llms(site, livePages) {
  const base = baseUrl(site);
  if (!base) return '';
  const b = site.business;
  const L = ['# ' + b.name, '', '> ' + plain(b.description), '', '## Pages', ''];
  livePages.filter(indexable).forEach(p => {
    L.push('- [' + plain(p.title).split(' | ')[0] + '](' + pageUrl(site, p) + '): ' + plain(p.description));
  });
  L.push('', '## Business details', '');
  L.push('- Address: ' + b.street + ', ' + b.cityLine);
  L.push('- Phone: ' + b.phone);
  if (b.email) L.push('- Email: ' + b.email);
  (b.hours || []).forEach(h => L.push('- Hours: ' + h.days + ', ' + h.times));
  const names = areaNames(site);
  if (names.length) L.push('- Service area: ' + names.join(', '));
  return L.join('\n') + '\n';
}

// Netlify _redirects from site.seo.redirects: [{ "from": "/old-page", "to": "/services.html", "status": 301 }]
function redirects(site) {
  const list = (site.seo && site.seo.redirects) || [];
  const lines = list.filter(r => r && r.from && r.to).map(r => r.from + ' ' + r.to + ' ' + (r.status || 301));
  return lines.length ? lines.join('\n') + '\n' : '';
}

module.exports = { headTags, jsonLd, shareImageUrl, sitemap, robots, llms, redirects, pageUrl };
