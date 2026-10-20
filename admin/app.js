// The editor. Screens are built from small pieces so every page uses the same boxes.
import { logout } from './identity.js'
import { photosScreen, photoImg } from './photos.js'
import { blank, newBlock, buildNewPage, slugify } from './newpage.js'
import { historyScreen } from './history.js'

const $ = (sel, root = document) => root.querySelector(sel)

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid))
  return el
}

async function api(url, opts) {
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts))
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.')
  return data
}

// ---------- state ----------
const state = {
  files: {},          // path -> { sha, content, timer, saving, again }
  screen: 'menu',
  waiting: false,     // draft changes not live yet
  user: null,
}
let statusEl, bannerEl, liveBtn, editorEl, previewFrame, previewPane

function setStatus(text, kind) { statusEl.textContent = text; statusEl.className = 'status ' + (kind || '') }

async function loadFile(path) {
  if (!state.files[path]) {
    const r = await api('/.netlify/functions/content-read?path=' + encodeURIComponent(path))
    state.files[path] = { sha: r.sha, content: r.content }
    if (r.changed) markWaiting(true)
  }
  return state.files[path].content
}

function markWaiting(on) {
  state.waiting = on
  bannerEl.classList.toggle('hidden', !on)
  liveBtn.disabled = !on
}

// ---------- saving ----------
function touch(path) {
  const f = state.files[path]
  clearTimeout(f.timer)
  setStatus('Saving...')
  f.timer = setTimeout(() => saveNow(path), 1200)
  schedulePreview()
}

async function saveNow(path) {
  const f = state.files[path]
  if (f.saving) { f.again = true; return }
  f.saving = true
  try {
    const r = await api('/.netlify/functions/content-save', {
      method: 'POST',
      body: JSON.stringify({ path, content: f.content, sha: f.sha }),
    })
    f.sha = r.sha
    markWaiting(true)
    setStatus('Saved', 'ok')
  } catch (err) {
    setStatus(err.message, 'bad')
  } finally {
    f.saving = false
    if (f.again) { f.again = false; saveNow(path) }
  }
}

async function flushAll() {
  const jobs = []
  for (const [path, f] of Object.entries(state.files)) {
    if (f.timer) { clearTimeout(f.timer); f.timer = null; jobs.push(saveNow(path)) }
  }
  await Promise.all(jobs)
  for (const f of Object.values(state.files)) while (f.saving) await new Promise((r) => setTimeout(r, 100))
}

async function makeLive() {
  liveBtn.disabled = true
  setStatus('Publishing...')
  try {
    await flushAll()
    const r = await api('/.netlify/functions/publish', { method: 'POST' })
    markWaiting(false)
    setStatus(r.nothing ? 'Nothing new to publish' : r.combined ? 'Live! We combined your changes with a newer version of the site. Site updates in about a minute' : 'Live! Site updates in about a minute', 'ok')
    if (state.screen === 'history') go('history')
  } catch (err) {
    liveBtn.disabled = false
    setStatus(err.message, 'bad')
  }
}

// ---------- live preview ----------
let previewTimer = null
let previewPage = 'home'
let previewEnd = false
function schedulePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(refreshPreview, 450)
}
async function refreshPreview() {
  try {
    const site = await loadFile('content/site.json')
    const body = { pageId: previewPage, site }
    if (state.files['content/pages/' + previewPage + '.json']) body.page = state.files['content/pages/' + previewPage + '.json'].content
    const r = await api('/.netlify/functions/preview', { method: 'POST', body: JSON.stringify(body) })
    const y = previewFrame.contentWindow ? previewFrame.contentWindow.scrollY : 0
    previewFrame.srcdoc = r.html
    const goEnd = previewEnd
    previewEnd = false
    previewFrame.addEventListener('load', () => { try { previewFrame.contentWindow.scrollTo(0, goEnd ? 1e6 : y) } catch (e) {} }, { once: true })
  } catch (err) {
    setStatus('Preview problem: ' + err.message, 'bad')
  }
}

// ---------- form pieces ----------
function counter(max, input) {
  const c = h('span', { class: 'count' })
  const upd = () => { const n = input.value.length; c.textContent = n + ' / ' + max; c.classList.toggle('over', n > max) }
  input.addEventListener('input', upd); upd()
  return c
}

function textField(label, value, opts, onChange) {
  const input = h('input', { type: 'text', value: value || '' })
  input.addEventListener('input', () => onChange(input.value))
  return h('div', { class: 'field' }, h('label', {}, label, opts.max ? counter(opts.max, input) : null), input, opts.hint ? h('p', { class: 'hint' }, opts.hint) : null)
}

function switchField(label, value, onChange) {
  const cb = h('input', { type: 'checkbox' })
  cb.checked = !!value
  cb.addEventListener('change', () => onChange(cb.checked))
  return h('div', { class: 'field' }, h('label', { class: 'switch' }, cb, label))
}


// ---------- schema and photo library ----------
let SCHEMA = null
async function loadSchema() {
  if (!SCHEMA) {
    SCHEMA = await (await fetch('/admin/blocks.json')).json()
    // The SEO screen comes with the engine. A site can still define its own.
    if (!SCHEMA.siteForms) SCHEMA.siteForms = {}
    if (!SCHEMA.siteForms.seo) SCHEMA.siteForms.seo = await (await fetch('/admin/seo-form.json')).json()
  }
  return SCHEMA
}
let ROLE = ''
async function loadPhotos() {
  const f = await loadFile('content/photos.json')
  return f.photos
}
const PAGE_CHOICES = [['home', 'The Home page'], ['services', 'The Services page'], ['about', 'The About page'], ['gallery', 'The Gallery page'], ['contact', 'The Contact page']]

// ---------- the list of pages (so new pages show up everywhere) ----------
let PAGES = []
const BASE_LABELS = { home: 'Home', services: 'Services', about: 'About', gallery: 'Gallery', contact: 'Contact' }
const navLabel = (p) => BASE_LABELS[p.id] || String(p.title || p.id).split('|')[0].trim()
async function loadPages() {
  await flushAll()
  try { PAGES = (await api('/.netlify/functions/pages-list')).pages } catch (e) { PAGES = PAGE_CHOICES.map(([id, name]) => ({ id, title: name, type: id, file: id + '.html', published: true, archived: false, custom: false })) }
  const order = ['home', 'services', 'about', 'gallery', 'contact']
  PAGES.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99) || navLabel(a).localeCompare(navLabel(b)))
  const schema = await loadSchema()
  for (const p of PAGES) if (p.custom && !SCREENS[p.id]) SCREENS[p.id] = customPageScreen(p, schema)
}
function pageChoices() {
  const list = PAGE_CHOICES.slice()
  PAGES.filter((p) => p.custom && p.published !== false && !p.archived).forEach((p) => list.push([p.id, 'The ' + navLabel(p) + ' page']))
  return list
}

// ---------- little helpers ----------
function visible(def, scopes) {
  if (!def.onlyWhen) return true
  return Object.entries(def.onlyWhen).every(([k, v]) => scopes.some((s) => s && (Array.isArray(v) ? v.includes(s[k]) : s[k] === v)))
}
function labelRow(text, count) { return h('label', {}, text, count || null) }
function hint(text) { return text ? h('p', { class: 'hint' }, text) : null }

// ---------- rich text (bold, italic, link only) ----------
function cleanHtml(node) {
  let out = ''
  for (const n of node.childNodes) {
    if (n.nodeType === 3) out += n.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    else if (n.nodeType === 1) {
      const t = n.tagName.toLowerCase()
      const inner = cleanHtml(n)
      if (t === 'b' || t === 'strong') out += '<b>' + inner + '</b>'
      else if (t === 'i' || t === 'em') out += '<i>' + inner + '</i>'
      else if (t === 'br') out += '<br>'
      else if (t === 'a' && n.getAttribute('href')) out += '<a href="' + n.getAttribute('href').replace(/"/g, '&quot;') + '">' + inner + '</a>'
      else out += inner
    }
  }
  return out
}
function richField(label, getVal, setVal, max) {
  const box = h('div', { class: 'rich', contenteditable: 'true', role: 'textbox', 'aria-label': label || 'Text' })
  box.innerHTML = getVal() || ''
  const count = h('span', { class: 'count' })
  const upd = () => { const n = box.textContent.length; count.textContent = n + ' / ' + max; count.classList.toggle('over', n > max) }
  box.addEventListener('input', () => { setVal(cleanHtml(box)); upd() })
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault() })
  box.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ')) })
  upd()
  let savedRange = null
  const linkRow = h('div', { class: 'linkrow hidden' })
  const linkInput = h('input', { type: 'text', placeholder: 'Paste the web address here' })
  const cmd = (name) => (e) => { e.preventDefault(); box.focus(); document.execCommand(name); setVal(cleanHtml(box)) }
  const tool = (txt, title, fn) => h('button', { type: 'button', class: 'tool', title, onmousedown: (e) => e.preventDefault(), onclick: fn }, txt)
  const bar = h('div', { class: 'toolbar' },
    tool('B', 'Bold', cmd('bold')),
    tool('I', 'Italic', cmd('italic')),
    tool('Link', 'Make the selected words a link', () => {
      const sel = window.getSelection()
      if (!sel.rangeCount || sel.isCollapsed || !box.contains(sel.anchorNode)) { linkInput.placeholder = 'First select some words, then click Link'; linkRow.classList.remove('hidden'); return }
      savedRange = sel.getRangeAt(0).cloneRange(); linkInput.placeholder = 'Paste the web address here'; linkRow.classList.remove('hidden'); linkInput.focus()
    }),
    tool('Unlink', 'Remove the link', cmd('unlink')))
  const apply = () => {
    const url = linkInput.value.trim()
    if (savedRange && url) {
      box.focus(); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange)
      document.execCommand('createLink', false, /^(https?:|mailto:|tel:)/i.test(url) ? url : 'https://' + url)
      setVal(cleanHtml(box))
    }
    linkInput.value = ''; linkRow.classList.add('hidden'); savedRange = null
  }
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } })
  linkRow.append(linkInput, h('button', { type: 'button', class: 'btn small', onclick: apply }, 'Add link'))
  return h('div', { class: 'field' }, labelRow(label, count), bar, box, linkRow)
}

// ---------- photo picker ----------
async function openPicker(currentId, onPick) {
  const photos = await loadPhotos()
  const overlay = h('div', { class: 'overlay' })
  const close = () => overlay.remove()
  const search = h('input', { type: 'text', placeholder: 'Search by what is in the photo, like "boat" or "seat"' })
  const grid = h('div', { class: 'pgrid' })
  const draw = () => {
    const q = search.value.trim().toLowerCase()
    grid.textContent = ''
    photos.filter((p) => !q || p.alt.toLowerCase().includes(q)).forEach((p) => {
      grid.append(h('button', { type: 'button', class: 'pthumb' + (p.id === currentId ? ' on' : ''), title: p.alt, onclick: () => { onPick(p); close() } },
        photoImg(h, p, 'thumb', { alt: p.alt })))
    })
    if (!grid.children.length) grid.append(h('p', { class: 'lead' }, 'No photos match that. Try a different word.'))
  }
  search.addEventListener('input', draw)
  overlay.append(h('div', { class: 'modal' },
    h('div', { class: 'mhead' }, h('strong', {}, 'Pick a photo'), h('button', { type: 'button', class: 'btn plain small', onclick: close }, 'Close')),
    search, grid))
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  document.body.append(overlay)
  draw(); search.focus()
}

// ---------- form fields from the schema ----------
function renderFields(fields, obj, ctx) {
  const wrap = h('div')
  for (const [key, def] of Object.entries(fields)) {
    if (def.hidden || !visible(def, [obj, ctx.block])) continue
    if (ctx.hide && obj === ctx.block && (ctx.hide[ctx.block.type] || []).includes(key)) continue
    wrap.append(renderField(key, def, obj, ctx))
  }
  return wrap
}

function renderField(key, def, obj, ctx) {
  const set = (v) => { obj[key] = v; ctx.changed() }
  switch (def.kind) {
    case 'text': {
      const input = h('input', { type: 'text', value: obj[key] || '', maxlength: def.max || 200 })
      const warn = h('p', { class: 'hint warn' })
      const re = def.pattern ? new RegExp(def.pattern) : null
      input.addEventListener('input', () => {
        if (re && !re.test(input.value.trim())) { warn.textContent = def.patternMessage || 'That does not look right yet.'; return }
        warn.textContent = ''; set(re ? input.value.trim() : input.value)
      })
      return h('div', { class: 'field' }, labelRow(def.label, def.max ? counter(def.max, input) : null), input, warn, hint(def.note))
    }
    case 'paragraph': {
      const ta = h('textarea', { rows: 4, maxlength: def.max || 600 })
      ta.value = obj[key] || ''
      ta.addEventListener('input', () => set(ta.value))
      return h('div', { class: 'field' }, labelRow(def.label, def.max ? counter(def.max, ta) : null), ta, hint(def.note))
    }
    case 'headline': {
      const maxLines = def.lines || 2, per = def.maxPerLine || 40
      const ta = h('textarea', { rows: maxLines })
      ta.value = obj[key] || ''
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ta.value.split('\n').length >= maxLines) e.preventDefault() })
      ta.addEventListener('input', () => {
        const v = ta.value.split('\n').slice(0, maxLines).map((l) => l.slice(0, per)).join('\n')
        if (v !== ta.value) ta.value = v
        set(v)
      })
      return h('div', { class: 'field' }, labelRow(def.label), ta, hint('Up to ' + maxLines + ' lines, ' + per + ' letters each. Press Enter to start the next line.'))
    }
    case 'richtext':
      return richField(def.label || '', () => obj[key], (v) => set(v), def.max || 400)
    case 'choice': {
      const opts = def.options.slice()
      if (def.optional && !opts.some((o) => o[0] === '')) opts.unshift(['', 'Automatic'])
      const sel = h('select')
      opts.forEach(([v, l]) => sel.append(h('option', { value: v, selected: (obj[key] || '') === v }, l)))
      sel.addEventListener('change', () => { if (sel.value === '' && def.optional) delete obj[key]; else obj[key] = sel.value; ctx.changed(); ctx.redraw() })
      return h('div', { class: 'field' }, labelRow(def.label), sel, hint(def.note))
    }
    case 'switch': {
      const el = switchField(def.label, obj[key], (v) => set(v))
      if (def.note) el.append(hint(def.note))
      return el
    }
    case 'align': {
      const cur = obj[key] || 'left'
      const row = h('div', { class: 'alignrow', role: 'group', 'aria-label': def.label })
      def.options.forEach(([v, name]) => {
        const b = h('button', { type: 'button', class: 'alignbtn' + (cur === v ? ' on' : ''), 'aria-pressed': cur === v ? 'true' : 'false', onclick: () => {
          if (v === 'left') delete obj[key]; else obj[key] = v
          ctx.changed(); ctx.redraw()
        } }, h('span', { class: 'aico aico-' + v }, h('i'), h('i'), h('i')), name)
        row.append(b)
      })
      return h('div', { class: 'field' }, labelRow(def.label), row)
    }
    case 'color': {
      const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(obj[key] || '') ? obj[key] : '#888888', class: 'colorpick' })
      const hex = h('input', { type: 'text', value: obj[key] || '', maxlength: 7, placeholder: '#C98A52' })
      pick.addEventListener('input', () => { hex.value = pick.value.toUpperCase(); set(hex.value) })
      hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { pick.value = hex.value; set(hex.value.toUpperCase()) } })
      return h('div', { class: 'field' }, labelRow(def.label), h('div', { class: 'colorrow' }, pick, hex))
    }
    case 'link':
      return linkField(def, obj, key, ctx)
    case 'photo':
      return photoField(def, obj, key, ctx)
    case 'list':
      return listField(key, def, obj, ctx)
    case 'object': {
      if (!obj[key]) obj[key] = blank(def)
      return h('div', { class: 'group' }, h('div', { class: 'lab grouplab' }, def.label), renderFields(def.item, obj[key], ctx))
    }
    default:
      return h('div', { class: 'field' }, h('p', { class: 'hint' }, def.label + ' (this box is not ready yet)'))
  }
}

function linkField(def, obj, key, ctx) {
  const l = obj[key] || (obj[key] = { page: 'contact' })
  const type = l.url !== undefined ? 'url' : l.phone ? 'phone' : l.email ? 'email' : 'page:' + (l.page || 'home')
  const sel = h('select')
  const choices = pageChoices()
  if (type.startsWith('page:') && !choices.some(([id]) => 'page:' + id === type)) choices.push([type.slice(5), 'A page that is not on the site right now'])
  choices.forEach(([id, name]) => sel.append(h('option', { value: 'page:' + id, selected: type === 'page:' + id }, name)))
  ;[['phone', 'Call the shop (phone number)'], ['email', 'Email the shop'], ['url', 'Another website']].forEach(([v, name]) => sel.append(h('option', { value: v, selected: type === v }, name)))
  const url = h('input', { type: 'text', placeholder: 'https://', value: l.url || '' })
  url.addEventListener('input', () => { obj[key] = { url: url.value.trim() }; ctx.changed() })
  const urlRow = h('div', { class: type === 'url' ? '' : 'hidden', style: 'margin-top:8px' }, url)
  sel.addEventListener('change', () => {
    const v = sel.value
    if (v === 'phone') obj[key] = { phone: true }
    else if (v === 'email') obj[key] = { email: true }
    else if (v === 'url') obj[key] = { url: l.url || '' }
    else { const id = v.slice(5); obj[key] = id === l.page && l.anchor ? { page: id, anchor: l.anchor } : { page: id } }
    urlRow.classList.toggle('hidden', v !== 'url')
    ctx.changed()
  })
  return h('div', { class: 'field' }, labelRow(def.label), sel, urlRow)
}

function photoField(def, obj, key, ctx) {
  const wrap = h('div', { class: 'field' })
  const draw = async () => {
    wrap.textContent = ''
    const photos = await loadPhotos()
    const plain = def.altRequired === false
    const cur = typeof obj[key] === 'string' ? { id: obj[key] } : (obj[key] || {})
    const ph = photos.find((p) => p.id === cur.id)
    const img = ph ? photoImg(h, ph, 'thumb', { class: 'bigthumb', alt: '' }) : h('div', { class: 'bigthumb empty' }, 'No photo yet')
    const alt = h('input', { type: 'text', value: cur.alt || '', maxlength: 200 })
    const warn = h('p', { class: 'hint warn' })
    alt.addEventListener('input', () => {
      if (!alt.value.trim()) { warn.textContent = 'Please describe the photo. It helps people who cannot see it, and Google.'; return }
      warn.textContent = ''; obj[key] = Object.assign({}, obj[key], { alt: alt.value }); ctx.changed()
    })
    const choose = h('button', { type: 'button', class: 'btn plain small', onclick: () => openPicker(cur.id, (p) => {
      if (plain) { obj[key] = p.id; if ('alt' in obj) obj.alt = p.alt; ctx.changed(); ctx.redraw() }
      else { obj[key] = { id: p.id, alt: p.alt }; ctx.changed(); draw() }
    }) }, ph ? 'Change photo' : 'Pick a photo')
    wrap.append(labelRow(def.label), h('div', { class: 'photorow' }, img, h('div', {}, choose)))
    if (!plain) wrap.append(h('div', { class: 'lab', style: 'margin-top:10px;font-weight:600;font-size:14px' }, 'Describe this photo'), alt, warn)
  }
  draw()
  return wrap
}

function listField(key, def, obj, ctx) {
  if (!Array.isArray(obj[key])) obj[key] = []
  const arr = obj[key]
  const simple = typeof def.item.kind === 'string'
  const min = def.min || 0, max = def.max || 99
  const wrap = h('div', { class: 'field' })
  const draw = () => {
    wrap.textContent = ''
    wrap.append(h('div', { class: 'lab' }, def.label))
    arr.forEach((_, i) => {
      const move = (d) => { const j = i + d; [arr[i], arr[j]] = [arr[j], arr[i]]; ctx.changed(); draw() }
      const row = h('div', { class: 'row' }, h('span', { class: 'num' }, '#' + (i + 1)),
        h('button', { type: 'button', class: 'btn plain small', disabled: i === 0, onclick: () => move(-1), title: 'Move up' }, '▲'),
        h('button', { type: 'button', class: 'btn plain small', disabled: i === arr.length - 1, onclick: () => move(1), title: 'Move down' }, '▼'),
        h('button', { type: 'button', class: 'btn plain small', disabled: arr.length <= min, onclick: () => { arr.splice(i, 1); ctx.changed(); draw() }, title: 'Remove' }, 'Remove'))
      let body
      if (simple) {
        const holder = { get v() { return arr[i] }, set v(x) { arr[i] = x } }
        body = renderField('v', Object.assign({}, def.item, { label: '' }), holder, ctx)
      } else {
        body = renderFields(def.item, arr[i], ctx)
      }
      wrap.append(h('div', { class: 'listitem' }, row, body))
    })
    if (arr.length < max) wrap.append(h('button', { type: 'button', class: 'btn plain small', onclick: () => { arr.push(simple ? blank(def.item) : blank({ kind: 'object', item: def.item })); ctx.changed(); draw() } }, 'Add another'))
    if (def.max) wrap.append(hint('Between ' + min + ' and ' + max + '.'))
  }
  draw()
  return wrap
}

// ---------- page screens ----------
function pageScreen(pageId, cfg) {
  return {
    title: cfg.title,
    preview: pageId,
    async render(root) {
      const schema = await loadSchema()
      await loadPhotos()
      const path = 'content/pages/' + pageId + '.json'
      const page = await loadFile(path)
      const changed = () => touch(path)
      const draw = () => {
        const keep = editorEl.scrollTop
        const was = [...root.querySelectorAll('details.blockcard')].map((d) => d.open)
        root.textContent = ''
        root.append(h('h1', {}, cfg.title), h('p', { class: 'lead' }, cfg.lead))
        const info = h('details', { class: 'blockcard' }, h('summary', {}, cfg.custom ? 'Page settings: title, show on the site' : 'Page title and search description'))
        const ictx = { block: page, changed, redraw: draw }
        const infoBody = h('div', { class: 'blockbody' },
          renderFields({
            title: { label: 'Page title (shows on the browser tab and in Google)', kind: 'text', max: 70 },
            description: { label: 'Short description for Google', kind: 'paragraph', max: 160 },
            showCallBand: { label: 'Show the "Set up a call" band at the bottom of this page', kind: 'switch' },
          }, page, ictx))
        if (cfg.custom) infoBody.append(customControls(page, changed))
        info.append(infoBody)
        info.open = was.length ? !!was[0] : !!cfg.custom
        root.append(info)
        page.blocks.forEach((block, i) => {
          const def = schema.blocks[block.type]
          const ctx = { block, changed, redraw: draw, hide: cfg.hide }
          const movable = cfg.movable.includes(block.type)
          const title = def.name + (block.eyebrow ? ': ' + block.eyebrow : '')
          const card = h('details', { class: 'blockcard' }, h('summary', {}, title))
          card.open = was.length ? !!was[i + 1] : i === 0
          const body = h('div', { class: 'blockbody' }, h('p', { class: 'hint' }, def.help), renderFields(def.fields, block, ctx))
          if (movable) {
            const move = (d) => { const j = i + d; [page.blocks[i], page.blocks[j]] = [page.blocks[j], page.blocks[i]]; changed(); draw() }
            const stuck = (j) => j < 0 || j >= page.blocks.length || !cfg.movable.includes(page.blocks[j].type)
            let armed = false
            const rm = h('button', { type: 'button', class: 'btn plain small', onclick: () => {
              if (!armed) { armed = true; rm.textContent = 'Click again to remove this section'; setTimeout(() => { armed = false; rm.textContent = 'Remove this section' }, 3000); return }
              page.blocks.splice(i, 1); changed(); draw()
            } }, 'Remove this section')
            body.append(h('div', { class: 'blockactions' },
              h('button', { type: 'button', class: 'btn plain small', disabled: stuck(i - 1), onclick: () => move(-1) }, 'Move section up'),
              h('button', { type: 'button', class: 'btn plain small', disabled: stuck(i + 1), onclick: () => move(1) }, 'Move section down'), rm))
          } else {
            body.append(h('p', { class: 'hint' }, 'This section stays where it is, but you can change its words.'))
          }
          card.append(body)
          root.append(card)
        })
        if (cfg.addable.length) {
          root.append(h('div', { class: 'addrow' }, h('strong', {}, 'Add a new section:'),
            ...cfg.addable.map((t) => h('button', { type: 'button', class: 'btn plain small', onclick: async () => {
              const photos = await loadPhotos()
              page.blocks.push(newBlock(schema, t, photos)); changed(); draw()
              const cards = root.querySelectorAll('details.blockcard'); const last = cards[cards.length - 1]
              last.open = true; last.scrollIntoView({ behavior: 'smooth' })
            } }, schema.blocks[t].name))))
        }
        editorEl.scrollTop = keep
      }
      draw()
    },
  }
}

// ---------- screens ----------
function formScreen(formId, rootOf) {
  return {
    title: formId,
    preview: 'contact',
    async render(root) {
      const schema = await loadSchema()
      const form = schema.siteForms[formId]
      this.preview = form.preview || 'home'
      previewPage = this.preview
      previewEnd = form.previewScroll === 'end'
      const site = await loadFile('content/site.json')
      const target = rootOf(site)
      const changed = () => touch('content/site.json')
      const draw = () => {
        const keep = editorEl.scrollTop
        const was = [...root.querySelectorAll('details.blockcard')].map((d) => d.open)
        root.textContent = ''
        root.append(h('h1', {}, form.title), h('p', { class: 'lead' }, form.lead))
        form.groups.forEach((g, i) => {
          const card = h('details', { class: 'blockcard' }, h('summary', {}, g.name))
          card.open = was.length ? !!was[i] : i === 0
          card.append(h('div', { class: 'blockbody' }, renderFields(g.fields, target, { block: target, changed, redraw: draw })))
          root.append(card)
        })
        editorEl.scrollTop = keep
      }
      draw()
    },
  }
}
// ---------- added pages: show, remove, restore, create ----------
const pagePath = (id) => 'content/pages/' + id + '.json'
const setListed = (page, patch) => { const m = PAGES.find((x) => x.id === page.id); if (m) Object.assign(m, patch) }

async function setPublished(page, on) {
  page.published = on
  setListed(page, { published: on })
}
async function setArchived(page, on) {
  const site = await loadFile('content/site.json')
  if (on) {
    site.menu.items.forEach((it) => { if (it.parent === page.id) delete it.parent })
    site.menu.items = site.menu.items.filter((it) => it.page !== page.id)
  }
  page.archived = on
  page.published = false
  setListed(page, { archived: on, published: false })
  touch('content/site.json')
  touch(pagePath(page.id))
}


// ---------- delete a removed page for good ----------
// Finds every place in the editable content that links to this page.
async function findLinksTo(page, schema) {
  const found = []
  const file = page.id + '.html'
  const where = (label, ctxLabel) => found.push(label + (ctxLabel ? ': "' + ctxLabel + '"' : ''))
  const scan = (node, label, ctx) => {
    if (Array.isArray(node)) { node.forEach((n) => scan(n, label, ctx)); return }
    if (!node || typeof node !== 'object') return
    const here = typeof node.label === 'string' ? node.label : typeof node.title === 'string' ? node.title : ctx
    if (node.page === page.id) where(label, typeof node.label === 'string' ? node.label : ctx)
    for (const v of Object.values(node)) {
      if (typeof v === 'string') {
        if (v.includes('href="' + file) || v === file || v.startsWith(file + '#')) where(label, 'a link in the text')
      } else scan(v, label, here)
    }
  }
  const others = PAGES.filter((p) => p.id !== page.id)
  for (const p of others) {
    const d = await loadFile(pagePath(p.id))
    ;(d.blocks || []).forEach((b) => scan(b, navLabel(p) + ' page, ' + (((schema.blocks[b.type] || {}).name) || b.type) + ' section', ''))
  }
  const site = await loadFile('content/site.json')
  scan(site.callBand, 'Call band', '')
  scan(site.footer, 'Footer', '')
  ;(site.menu.items || []).forEach((it) => { if (it.page === page.id) found.push('Menu: "' + (it.label || navLabel(page)) + '"') })
  return [...new Set(found)]
}

function confirmDelete(page, links) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'overlay' })
    const done = (v) => { overlay.remove(); resolve(v) }
    const list = links.length
      ? h('div', {}, h('p', { class: 'hint warn' }, 'These places still point to this page. They will go nowhere until you change them:'),
          h('ul', { class: 'linklist' }, ...links.map((t) => h('li', {}, t))))
      : h('p', { class: 'hint' }, 'Nothing else on the site points to this page.')
    const yes = h('button', { type: 'button', class: 'btn danger', onclick: () => done(true) }, 'Delete for good')
    overlay.append(h('div', { class: 'modal small' },
      h('div', { class: 'mhead' }, h('strong', {}, 'Are you sure?')),
      h('p', {}, 'This deletes "' + navLabel(page) + '" completely. It cannot be brought back from the editor.'),
      list,
      h('div', { class: 'blockactions' }, h('button', { type: 'button', class: 'btn plain', onclick: () => done(false) }, 'Cancel'), yes)))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false) })
    document.body.append(overlay)
  })
}

async function deletePageForGood(p) {
  const schema = await loadSchema()
  const links = await findLinksTo(p, schema)
  if (!(await confirmDelete(p, links))) return false
  setStatus('Deleting the page...')
  const path = pagePath(p.id)
  const f = state.files[path]
  if (f) clearTimeout(f.timer)
  await api('/.netlify/functions/page-delete', { method: 'POST', body: JSON.stringify({ id: p.id }) })
  delete state.files[path]
  delete SCREENS[p.id]
  markWaiting(true)
  await loadPages()
  setStatus('Page deleted. It leaves the live site when you click Make it live.', 'ok')
  return true
}

function customControls(page, changed) {
  const cb = h('input', { type: 'checkbox' })
  cb.checked = page.published !== false
  cb.addEventListener('change', async () => {
    try { await setPublished(page, cb.checked); changed() } catch (err) { setStatus(err.message, 'bad'); cb.checked = !cb.checked }
  })
  let armed = false
  const rm = h('button', { type: 'button', class: 'btn plain small', onclick: async () => {
    if (!armed) { armed = true; rm.textContent = 'Click again to remove this page'; setTimeout(() => { armed = false; rm.textContent = 'Remove this page' }, 3000); return }
    try { await setArchived(page, true); await loadPages(); go('pages') } catch (err) { setStatus(err.message, 'bad') }
  } }, 'Remove this page')
  return h('div', {},
    h('div', { class: 'field' }, h('label', { class: 'switch' }, cb, 'Show this page on the site'),
      h('p', { class: 'hint' }, 'Off keeps it hidden. When it is on and you click Make it live, the page appears on the site. To put it in the menu, use the Menu screen.'),
      h('button', { type: 'button', class: 'btn plain small', onclick: () => go('menu') }, 'Open the Menu screen')),
    h('div', { class: 'blockactions' }, rm),
    h('p', { class: 'hint' }, 'Removing hides the page and takes it out of the menu. You can bring it back from All pages.'))
}

function customPageScreen(p, schema) {
  const t = schema.pageTypes[p.type] || { allowed: [] }
  const free = t.allowed.filter((x) => !['pageHeader', 'galleryBrowser', 'contactSection'].includes(x))
  return pageScreen(p.id, { title: navLabel(p), lead: 'Open a section to change its words and photos. This page is not on the site until you switch it on under "Page settings".', movable: free, addable: free, hide: { serviceFeature: ['version'] }, custom: true })
}

function addPageScreen() {
  return {
    title: 'Add a page',
    preview: 'home',
    async render(root) {
      const schema = await loadSchema()
      const site = await loadFile('content/site.json')
      const types = Object.entries(schema.pageTypes)
      let chosen = types[0][0]
      const grid = h('div', { class: 'typegrid' })
      const drawTypes = () => {
        grid.textContent = ''
        types.forEach(([id, t]) => grid.append(h('button', { type: 'button', class: 'typecard' + (chosen === id ? ' on' : ''), 'aria-pressed': chosen === id ? 'true' : 'false', onclick: () => { chosen = id; drawTypes() } },
          h('strong', {}, t.name), h('span', {}, t.help))))
      }
      drawTypes()
      const input = h('input', { type: 'text', maxlength: 40, placeholder: 'Example: Boat Wraps' })
      const addr = h('p', { class: 'hint' }, 'The page address will show up here.')
      const warn = h('p', { class: 'hint warn' })
      input.addEventListener('input', () => { warn.textContent = ''; const s = slugify(input.value); addr.textContent = s ? 'Page address: ' + s + '.html (it cannot be changed later)' : 'The page address will show up here.' })
      const go2 = h('button', { type: 'button', class: 'btn' }, 'Create page')
      go2.addEventListener('click', async () => {
        const title = input.value.trim()
        const id = slugify(title)
        if (!id) { warn.textContent = 'Please type a name for the page first.'; return }
        const reserved = ['index', 'admin', 'assets', 'style-guide', 'netlify', 'cms', 'templates', 'content', 'preview', 'ideas', 'src', 'tools']
        if (reserved.includes(id) || PAGES.some((p) => p.id === id || p.file === id + '.html')) { warn.textContent = 'There is already a page with that name. Try a different name.'; return }
        go2.disabled = true
        setStatus('Creating the page...')
        try {
          const photos = await loadPhotos()
          const page = buildNewPage({
            schema, typeId: chosen, id, title, businessName: site.business.name, photos,
            contactPage: await loadFile(pagePath('contact')), galleryPage: await loadFile(pagePath('gallery')),
          })
          const r = await api('/.netlify/functions/content-save', { method: 'POST', body: JSON.stringify({ path: pagePath(id), content: page }) })
          state.files[pagePath(id)] = { sha: r.sha, content: page }
          markWaiting(true)
          setStatus('Page created. It is hidden until you switch it on.', 'ok')
          await loadPages()
          if (!PAGES.some((p) => p.id === id)) {
            PAGES.push({ id, type: chosen, file: id + '.html', title: page.title, published: false, archived: false, custom: true })
            SCREENS[id] = customPageScreen(PAGES[PAGES.length - 1], schema)
          }
          go(id)
        } catch (err) { go2.disabled = false; setStatus(err.message, 'bad') }
      })
      root.append(
        h('h1', {}, 'Add a page'),
        h('p', { class: 'lead' }, 'Pick the kind of page, give it a name, and it opens ready to fill in. It stays hidden from the site until you switch it on.'),
        h('div', { class: 'field' }, h('div', { class: 'lab' }, '1. What kind of page?'), grid),
        h('div', { class: 'field' }, h('label', {}, '2. What is the page called?'), input, addr, warn),
        go2)
    },
  }
}

function pagesScreen() {
  return {
    title: 'All pages',
    preview: 'home',
    async render(root) {
      await loadPages()
      const schema = await loadSchema()
      root.append(h('h1', {}, 'All pages'),
        h('p', { class: 'lead' }, 'Every page on your site and where it stands.'),
        h('div', { class: 'addrow' }, h('button', { type: 'button', class: 'btn', onclick: () => go('addpage') }, 'Add a page')))
      PAGES.forEach((p) => {
        const st = p.archived ? ['Removed', 'off'] : p.published === false ? ['Not on the site yet', 'wait'] : ['On the site', 'ok']
        const kind = (schema.pageTypes[p.type] || {}).name || (p.type === 'home' ? 'Home page' : 'Page')
        const act = p.archived
          ? h('span', { class: 'rowacts' },
              h('button', { type: 'button', class: 'btn plain small', onclick: async () => {
                try { const page = await loadFile(pagePath(p.id)); await setArchived(page, false); await loadPages(); go('pages') } catch (err) { setStatus(err.message, 'bad') }
              } }, 'Bring it back'),
              p.custom ? h('button', { type: 'button', class: 'btn plain small danger-text', onclick: async () => {
                try { if (await deletePageForGood(p)) go('pages') } catch (err) { setStatus(err.message, 'bad') }
              } }, 'Delete for good') : null)
          : h('button', { type: 'button', class: 'btn plain small', disabled: !SCREENS[p.id], onclick: () => go(p.id) }, 'Edit')
        root.append(h('div', { class: 'pagerow' + (p.archived ? ' off' : '') },
          h('div', { class: 'pi' }, h('strong', {}, navLabel(p)), h('span', { class: 'chip ' + st[1] }, st[0]), h('span', { class: 'ptype' }, kind)), act))
      })
    },
  }
}

const PAGE_COMMON = { movable: [], addable: [], hide: { serviceFeature: ['version'] } }
const SCREENS = {
  services: pageScreen('services', Object.assign({ title: 'Services page', lead: 'Each trade has its own section. Open one to change its words, photo and colors.' }, PAGE_COMMON)),
  about: pageScreen('about', Object.assign({ title: 'About page', lead: 'Open a section to change its words and photos.' }, PAGE_COMMON)),
  gallery: pageScreen('gallery', Object.assign({ title: 'Gallery page', lead: 'The photos themselves are managed under Photos in the menu on the left. Here you can change the words around them.' }, PAGE_COMMON)),
  contact: pageScreen('contact', Object.assign({ title: 'Contact page', lead: 'Open a section to change the words on the Contact page. The phone, email, hours and address come from Business info.' }, PAGE_COMMON)),
  business: formScreen('business', (site) => site.business),
  callBand: formScreen('callBand', (site) => site.callBand),
  footer: formScreen('footer', (site) => site.footer),
  seo: formScreen('seo', (site) => {
    const seo = site.seo || (site.seo = {})
    if (seo.allowAiCrawlers === undefined) seo.allowAiCrawlers = true
    return seo
  }),
  menu: { title: 'Menu', render: renderMenu, preview: 'home' },
  addpage: addPageScreen(),
  pages: pagesScreen(),
  photos: photosScreen({ h, api, loadFile, touch, setStatus }),
  history: historyScreen({ h, api, loadFile, state, setStatus, markWaiting, getPages: () => PAGES, navLabel, flushAll, setPreview: (id) => { previewPage = id }, refreshPreview: () => refreshPreview() }),
  home: pageScreen('home', { title: 'Home page', lead: 'Open a section to change its words and photos. The preview on the right updates as you type.', movable: ['cardRow', 'textPhoto'], addable: ['cardRow', 'textPhoto'], hide: {} }),
}

function navGroups() {
  const base = [['home', 'Home'], ['services', 'Services'], ['about', 'About'], ['gallery', 'Gallery'], ['contact', 'Contact']]
  const added = PAGES.filter((p) => p.custom && !p.archived).map((p) => [p.id, navLabel(p)])
  return [
    ['Pages', [...base, ...added, ['addpage', '+ Add a page'], ['pages', 'All pages']]],
    ['Site', [['photos', 'Photos'], ['menu', 'Menu'], ['business', 'Business info'], ['callBand', 'Call band'], ['footer', 'Footer'], ['history', 'History'], ...(ROLE === 'owner' ? [['seo', 'SEO']] : [])]],
  ]
}

let engineVersion = ''
try { fetch('version.json').then((r) => r.json()).then((v) => { engineVersion = v.version || ''; const el = document.querySelector('.engver'); if (el) el.textContent = engineVersion ? 'CMS engine v' + engineVersion : '' }).catch(() => {}) } catch (e) {}

function drawNav(nav) {
  nav.textContent = ''
  for (const [group, items] of navGroups()) {
    nav.append(h('h3', {}, group))
    for (const [id, label] of items) {
      const live = !!SCREENS[id]
      nav.append(h('button', { class: (state.screen === id ? 'on' : '') + (id === 'addpage' ? ' addbtn' : ''), disabled: !live, title: live ? '' : 'Coming soon', onclick: () => go(id) }, label + (live ? '' : '  (soon)')))
    }
  }
  nav.append(h('p', { class: 'engver' }, engineVersion ? 'CMS engine v' + engineVersion : ''))
}

async function go(id) {
  state.screen = id
  drawNav($('.sidenav'))
  const s = SCREENS[id]
  previewPage = s.preview
  editorEl.textContent = ''
  editorEl.append(h('p', { class: 'lead' }, 'Loading...'))
  try {
    const site = await loadFile('content/site.json')
    editorEl.textContent = ''
    await s.render(editorEl, site)
    refreshPreview()
  } catch (err) {
    editorEl.textContent = ''
    editorEl.append(h('p', { class: 'lead' }, 'Could not load this screen: ' + err.message))
  }
}

async function renderMenu(root, site) {
  await loadPages()
  const m = site.menu
  const changed = () => touch('content/site.json')
  root.append(
    h('h1', {}, 'Menu'),
    h('p', { class: 'lead' }, 'These are the words across the top of every page. Move an item with the arrows, switch it off to hide it, or tuck it under another item to make a drop-down.'),
  )
  const list = h('div')
  const more = h('div')
  const chipFor = (it) => {
    const p = PAGES.find((x) => x.id === it.page)
    return p && (p.published === false || p.archived) ? h('span', { class: 'chip wait', title: 'This item will not show until its page is switched on.' }, 'Page not on the site yet') : null
  }
  function draw() {
    // an item tucked under something that is not a top-level item goes back to the top level
    m.items.forEach((it) => {
      if (it.parent && (it.parent === it.page || !m.items.some((o) => o.page === it.parent && !o.parent))) { delete it.parent; changed() }
    })
    list.textContent = ''
    const sibs = (parent) => m.items.map((it, i) => [it, i]).filter(([it]) => (it.parent || '') === (parent || '')).map(([, i]) => i)
    const hasKids = (it) => m.items.some((o) => o.parent === it.page)
    const row = (it) => {
      const idx = m.items.indexOf(it)
      const S = sibs(it.parent)
      const pos = S.indexOf(idx)
      const move = (d) => { const j = S[pos + d]; [m.items[idx], m.items[j]] = [m.items[j], m.items[idx]]; changed(); draw() }
      const input = h('input', { type: 'text', value: it.label, maxlength: 18, 'aria-label': 'Menu word' })
      input.addEventListener('input', () => { it.label = input.value; changed() })
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Show in menu' })
      cb.checked = it.show !== false
      const el = h('div', { class: 'menurow' + (it.parent ? ' child' : '') + (cb.checked ? '' : ' off') })
      cb.addEventListener('change', () => { it.show = cb.checked; el.classList.toggle('off', !cb.checked); changed() })
      const sel = h('select', { 'aria-label': 'Sits under', title: hasKids(it) ? 'Move its drop-down items out first' : '', disabled: hasKids(it) })
      sel.append(h('option', { value: '', selected: !it.parent }, 'Top level'))
      m.items.filter((o) => !o.parent && o.page !== it.page).forEach((o) => sel.append(h('option', { value: o.page, selected: it.parent === o.page }, 'Under ' + o.label)))
      sel.addEventListener('change', () => { if (sel.value) it.parent = sel.value; else delete it.parent; changed(); draw() })
      let armed = false
      const rm = h('button', { type: 'button', class: 'btn plain small', onclick: () => {
        if (!armed) { armed = true; rm.textContent = 'Click again'; setTimeout(() => { armed = false; rm.textContent = 'Remove' }, 3000); return }
        m.items.forEach((o) => { if (o.parent === it.page) delete o.parent })
        m.items.splice(m.items.indexOf(it), 1); changed(); draw()
      } }, 'Remove')
      el.append(
        h('span', { class: 'arrows' },
          h('button', { type: 'button', disabled: pos === 0, title: 'Move up', onclick: () => move(-1) }, '▲'),
          h('button', { type: 'button', disabled: pos === S.length - 1, title: 'Move down', onclick: () => move(1) }, '▼')),
        h('div', { class: 'menumain' }, input, chipFor(it), h('label', { class: 'under' }, 'Sits under', sel)),
        h('label', { class: 'switch' }, cb, 'Show'),
        rm,
      )
      return el
    }
    m.items.filter((it) => !it.parent).forEach((it) => {
      list.append(row(it))
      m.items.filter((c) => c.parent === it.page).forEach((c) => list.append(row(c)))
    })
    more.textContent = ''
    const out = PAGES.filter((p) => !p.archived && p.id !== 'home' && !m.items.some((it) => it.page === p.id))
    more.append(h('h2', { class: 'subhead' }, 'Pages not in the menu'))
    if (!out.length) more.append(h('p', { class: 'hint' }, 'Every page is already in the menu.'))
    out.forEach((p) => more.append(h('div', { class: 'pagerow' },
      h('div', { class: 'pi' }, h('strong', {}, navLabel(p)),
        h('span', { class: 'chip ' + (p.published === false ? 'wait' : 'ok') }, p.published === false ? 'Not on the site yet' : 'On the site')),
      h('button', { type: 'button', class: 'btn small', onclick: () => { m.items.push({ label: navLabel(p).slice(0, 18), page: p.id, show: true }); changed(); draw() } }, 'Add to menu'))))
  }
  draw()
  root.append(list, more)
  root.append(h('div', { class: 'group' },
    textField('Words on the header button', m.button.label, { max: 20, hint: 'The red button at the end of the menu.' }, (v) => { m.button.label = v; changed() })))
}

// ---------- start ----------
export function startApp(user) {
  ROLE = (user && user.role) || ''
  state.user = user
  const app = $('#app')
  app.textContent = ''
  statusEl = h('span', { class: 'status' }, '')
  liveBtn = h('button', { class: 'btn', disabled: true, onclick: makeLive }, 'Make it live')
  const previewToggle = h('button', { class: 'btn plain small togglepreview', onclick: () => previewPane.classList.toggle('show') }, 'Show or hide preview')
  bannerEl = h('div', { class: 'banner hidden' }, 'You have changes that are saved as a draft but are not on the live site yet. Click "Make it live" when you are ready.')
  editorEl = h('main', { class: 'editor' })
  previewFrame = h('iframe', { title: 'Preview of your page' })
  previewPane = h('aside', { class: 'previewpane' }, h('p', { class: 'cap' }, 'Preview. This is how your page will look.'), previewFrame)
  app.append(
    h('header', { class: 'topbar' },
      h('span', { class: 'brand' }, 'Edit your website'),
      statusEl, previewToggle, liveBtn,
      h('button', { class: 'btn plain', onclick: async () => { await logout(); location.reload() } }, 'Log out')),
    bannerEl,
    h('div', { class: 'workspace' }, h('nav', { class: 'sidenav' }), editorEl, previewPane),
  )
  app.classList.remove('hidden')
  document.body.classList.add('app-mode')
  api('/.netlify/functions/status').then((r) => markWaiting(!!r.waiting)).catch(() => {})
  loadPages().catch(() => {}).finally(() => go('home'))
}
