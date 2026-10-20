// Pieces that build a brand-new page. No browser code in here, so the build tests can run it too.

export function blank(def) {
  if (def.kind === 'list') return []
  if (def.kind === 'switch') return false
  if (def.kind === 'link') return { page: 'contact' }
  if (def.kind === 'choice') return def.optional ? '' : def.options[0][0]
  if (def.kind === 'object') return Object.fromEntries(Object.entries(def.item).map(([k, d]) => [k, blank(d)]))
  return ''
}

export function newBlock(schema, type, photos) {
  const def = schema.blocks[type]
  const b = { type }
  for (const [k, d] of Object.entries(def.fields)) {
    if (d.hidden || d.optional) continue
    b[k] = blank(d)
    if (d.kind === 'list') while (b[k].length < (d.min || 0)) b[k].push(typeof d.item.kind === 'string' ? '' : blank({ kind: 'object', item: d.item }))
    if (d.kind === 'photo') b[k] = { id: photos[0].id, alt: photos[0].alt }
  }
  if (type === 'serviceFeature') {
    // new service pages use the standard layout, so drop the boxes that only the other layouts need
    for (const [k, d] of Object.entries(def.fields)) {
      if (d.onlyWhen && !Object.entries(d.onlyWhen).every(([kk, vv]) => (Array.isArray(vv) ? vv.includes(b[kk]) : b[kk] === vv))) delete b[k]
    }
  }
  if (type === 'cardRow') { b.style = 'linked'; b.eyebrow = 'New section'; b.headline = 'Your headline'; b.cards.forEach((c, i) => { c.label = 'Label'; c.title = 'Card ' + (i + 1); c.text = 'Tell people about it here.'; c.link = { page: 'services' } }) }
  if (type === 'textPhoto') { b.eyebrow = 'New section'; b.headline = 'Your headline'; b.paragraphs = ['Write about it here.'] }
  return b
}

// Fills any empty words with a plain starter so the page never looks broken.
export function fillStarter(fields, obj) {
  for (const [k, d] of Object.entries(fields)) {
    if (d.hidden || d.optional) continue
    const v = obj[k]
    if (d.kind === 'headline' && !v) obj[k] = d.lines === 1 ? 'Your headline' : 'Your headline\ngoes here'
    else if ((d.kind === 'text' || d.kind === 'paragraph' || d.kind === 'richtext') && !v) obj[k] = ('Add your ' + (d.label || 'words').toLowerCase()).slice(0, d.max || 200)
    else if (d.kind === 'list' && Array.isArray(v)) v.forEach((it, i) => {
      if (typeof it === 'string') { if (!it) v[i] = 'Write about it here.' }
      else if (it && typeof it === 'object') fillStarter(d.item, it)
    })
    else if (d.kind === 'object' && v) fillStarter(d.item, v)
  }
}

export function slugify(title) {
  return String(title || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
}

// Everything needed from the site is passed in: schema, photo list, business name,
// and the Contact and Gallery pages (their special blocks are copied, not rebuilt).
export function buildNewPage({ schema, typeId, id, title, businessName, photos, contactPage, galleryPage }) {
  const t = schema.pageTypes[typeId]
  if (!t) throw new Error('Unknown page type: ' + typeId)
  const blocks = t.starts.map((bt) => {
    let b
    const copyOf = (page, type) => page && page.blocks.find((x) => x.type === type)
    if (bt === 'contactSection' && copyOf(contactPage, bt)) b = JSON.parse(JSON.stringify(copyOf(contactPage, bt)))
    else if (bt === 'galleryBrowser' && copyOf(galleryPage, bt)) b = JSON.parse(JSON.stringify(copyOf(galleryPage, bt)))
    else { b = newBlock(schema, bt, photos); fillStarter(schema.blocks[bt].fields, b) }
    if (bt === 'pageHeader') { b.eyebrow = 'New page'; if (title.length <= 28) b.headline = title }
    return b
  })
  return { id, type: typeId, file: id + '.html', title: title + ' | ' + businessName, description: '', showCallBand: true, published: false, custom: true, blocks }
}
