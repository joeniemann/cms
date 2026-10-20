// The Photos screen: add, describe, hide, move and delete gallery photos.
const PHOTOS = 'content/photos.json'
const GALLERY = 'content/gallery.json'
const PAGES = ['site', 'pages/home', 'pages/services', 'pages/about', 'pages/gallery', 'pages/contact']

// Show a photo. New photos only exist on the drafts branch, so fall back to the function that reads them.
export function photoImg(h, p, kind, attrs) {
  const path = kind === 'full' ? p.file : p.thumb
  const img = h('img', Object.assign({ src: '/' + path, loading: 'lazy' }, attrs || {}))
  let tried = false
  img.addEventListener('error', () => {
    if (tried) return
    tried = true
    img.src = '/.netlify/functions/photo-read?p=' + encodeURIComponent(path)
  })
  return img
}

// Shrink a picked file to a web-size photo and a thumbnail, both webp.
async function shrink(file) {
  let bmp
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch (e) { throw new Error('Could not open ' + file.name + '. Try a JPG or PNG.') }
  const make = async (maxSide, quality) => {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', quality))
    if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot make web photos. Try Chrome or Edge.')
    return blob
  }
  const full = await make(1200, 0.82)
  const thumb = await make(540, 0.78)
  const b64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob) })
  return { full: await b64(full), thumb: await b64(thumb), preview: URL.createObjectURL(thumb) }
}

export function photosScreen(d) {
  const { h, api, loadFile, touch, setStatus, loadFileRaw } = d
  return {
    title: 'Photos',
    preview: 'gallery',
    async render(root) {
      const photos = (await loadFile(PHOTOS)).photos
      const gal = await loadFile(GALLERY)
      const byId = () => Object.fromEntries(photos.map((p) => [p.id, p]))
      const catLabel = (id) => (gal.categories.find((c) => c.id === id) || {}).label || id
      const saved = () => { touch(PHOTOS); touch(GALLERY) }
      let filterCat = ''
      let q = ''

      const catSelect = (value, onChange) => {
        const s = h('select', {}, gal.categories.map((c) => h('option', { value: c.id }, c.label)))
        s.value = value || gal.categories[0].id
        s.addEventListener('change', () => onChange && onChange(s.value))
        return s
      }

      // ----- adding photos -----
      const addBox = h('div', { class: 'addbox' })
      const pending = []
      const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' })
      const drawPending = () => {
        addBox.textContent = ''
        if (!pending.length) {
          addBox.append(h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'Add photos'),
            h('p', { class: 'hint' }, 'Pick one or more photos from your phone or computer. They are shrunk for the web automatically.'))
          return
        }
        const list = h('div', { class: 'plist' })
        pending.forEach((it, i) => {
          const alt = h('input', { type: 'text', maxlength: 200, placeholder: 'Describe it, like "Tan diamond-stitched boat seat"', value: it.alt })
          alt.addEventListener('input', () => { it.alt = alt.value; go.disabled = !pending.every((x) => x.alt.trim()) })
          list.append(h('div', { class: 'pitem' },
            h('img', { src: it.preview, alt: '' }),
            h('div', { class: 'pfields' },
              h('label', {}, 'What is in this photo? (required)'), alt,
              h('label', {}, 'Which group?'), catSelect(it.cat, (v) => { it.cat = v }),
              h('button', { type: 'button', class: 'btn plain small', onclick: () => { pending.splice(i, 1); drawPending() } }, 'Remove'))))
        })
        const go = h('button', { type: 'button', class: 'btn', onclick: () => upload(go) }, 'Add ' + pending.length + (pending.length === 1 ? ' photo' : ' photos'))
        go.disabled = !pending.every((x) => x.alt.trim())
        addBox.append(list, h('div', { class: 'row' }, go,
          h('button', { type: 'button', class: 'btn plain', onclick: () => { pending.length = 0; drawPending() } }, 'Cancel')))
      }
      const nextId = () => {
        const n = Math.max(0, ...photos.map((p) => parseInt(p.id.slice(1), 10) || 0)) + 1
        return 'g' + String(n).padStart(3, '0')
      }
      const upload = async (btn) => {
        btn.disabled = true
        let done = 0
        try {
          for (const it of pending.slice()) {
            setStatus('Adding photo ' + (done + 1) + ' of ' + pending.length + '...')
            const id = nextId()
            await api('/.netlify/functions/photo-save', { method: 'POST', body: JSON.stringify({ id, full: it.full, thumb: it.thumb }) })
            photos.push({ id, file: 'assets/gallery/' + id + '.webp', thumb: 'assets/gallery-thumbs/' + id + '.webp', alt: it.alt.trim() })
            gal.items.unshift({ photo: id, category: it.cat, hidden: false })
            pending.splice(pending.indexOf(it), 1)
            done++
            saved()
          }
          setStatus('Photos added', 'ok')
        } catch (err) {
          setStatus(err.message, 'bad')
          if (done) saved()
        }
        drawPending(); drawGrid()
      }
      fileInput.addEventListener('change', async () => {
        const files = [...fileInput.files]
        fileInput.value = ''
        for (const f of files) {
          try {
            const s = await shrink(f)
            pending.push({ full: s.full, thumb: s.thumb, preview: s.preview, alt: '', cat: filterCat || gal.categories[0].id })
          } catch (err) { setStatus(err.message, 'bad') }
        }
        drawPending()
      })

      // ----- the grid -----
      const grid = h('div', { class: 'pgrid big' })
      const count = h('p', { class: 'hint' })
      let dragFrom = null
      const drawGrid = () => {
        const ph = byId()
        grid.textContent = ''
        const ql = q.trim().toLowerCase()
        let shown = 0
        gal.items.forEach((it, idx) => {
          const p = ph[it.photo]
          if (!p) return
          if (filterCat && it.category !== filterCat) return
          if (ql && !p.alt.toLowerCase().includes(ql)) return
          shown++
          const tile = h('button', { type: 'button', class: 'pthumb' + (it.hidden ? ' off' : ''), draggable: 'true', title: p.alt, onclick: () => openEdit(it, p) },
            photoImg(h, p, 'thumb', { alt: p.alt }),
            it.hidden ? h('span', { class: 'tag' }, 'Hidden') : null)
          tile.addEventListener('dragstart', () => { dragFrom = idx })
          tile.addEventListener('dragover', (e) => e.preventDefault())
          tile.addEventListener('drop', (e) => {
            e.preventDefault()
            if (dragFrom == null || dragFrom === idx) return
            const [m] = gal.items.splice(dragFrom, 1)
            gal.items.splice(idx, 0, m)
            dragFrom = null
            touch(GALLERY); drawGrid()
          })
          grid.append(tile)
        })
        count.textContent = shown + (shown === 1 ? ' photo' : ' photos') + (filterCat || ql ? ' shown. Clear the filter to drag and reorder everything.' : '. Drag a photo to move it, or click one to edit it.')
        if (!shown) grid.append(h('p', { class: 'lead' }, 'No photos match that.'))
      }

      // ----- editing one photo -----
      const openEdit = (it, p) => {
        const overlay = h('div', { class: 'overlay' })
        const close = () => { overlay.remove(); drawGrid() }
        const alt = h('input', { type: 'text', maxlength: 200, value: p.alt })
        const warn = h('p', { class: 'hint warn' })
        alt.addEventListener('input', () => {
          if (!alt.value.trim()) { warn.textContent = 'A short description is needed so Google and screen readers know what this is.'; return }
          warn.textContent = ''
          p.alt = alt.value; touch(PHOTOS)
        })
        const sw = h('input', { type: 'checkbox' })
        sw.checked = !it.hidden
        sw.addEventListener('change', () => { it.hidden = !sw.checked; touch(GALLERY) })
        const move = (dir) => {
          const i = gal.items.indexOf(it), j = i + dir
          if (j < 0 || j >= gal.items.length) return
          gal.items.splice(i, 1); gal.items.splice(j, 0, it); touch(GALLERY)
        }
        const delArea = h('div', { class: 'row' })
        const drawDel = (confirming) => {
          delArea.textContent = ''
          if (!confirming) {
            delArea.append(h('button', { type: 'button', class: 'btn plain small danger', onclick: () => checkDelete() }, 'Delete this photo'))
          } else {
            delArea.append(h('span', { class: 'hint' }, 'Delete it for good?'),
              h('button', { type: 'button', class: 'btn small danger', onclick: () => doDelete() }, 'Yes, delete'),
              h('button', { type: 'button', class: 'btn plain small', onclick: () => drawDel(false) }, 'Keep it'))
          }
        }
        const checkDelete = async () => {
          const needle = '"' + p.id + '"'
          for (const name of PAGES) {
            const c = await loadFile('content/' + name + '.json')
            if (JSON.stringify(c).includes(needle)) {
              warn.textContent = 'This photo is used on the ' + (name === 'site' ? 'site settings' : name.replace('pages/', '') + ' page') + '. Pick a different photo there first, then delete this one.'
              return
            }
          }
          drawDel(true)
        }
        const doDelete = async () => {
          try {
            setStatus('Deleting...')
            await api('/.netlify/functions/photo-delete', { method: 'POST', body: JSON.stringify({ id: p.id }) })
            photos.splice(photos.indexOf(p), 1)
            gal.items.splice(gal.items.indexOf(it), 1)
            saved(); setStatus('Photo deleted', 'ok'); close()
          } catch (err) { warn.textContent = err.message; setStatus(err.message, 'bad') }
        }
        drawDel(false)
        overlay.append(h('div', { class: 'modal' },
          h('div', { class: 'mhead' }, h('strong', {}, 'Edit photo'), h('button', { type: 'button', class: 'btn plain small', onclick: close }, 'Done')),
          h('div', { class: 'editgrid' },
            photoImg(h, p, 'full', { class: 'editimg', alt: p.alt }),
            h('div', { class: 'pfields' },
              h('label', {}, 'What is in this photo?'), alt, warn,
              h('label', {}, 'Which group?'), catSelect(it.category, (v) => { it.category = v; touch(GALLERY) }),
              h('label', { class: 'switch' }, sw, 'Show in the gallery'),
              h('div', { class: 'row' },
                h('button', { type: 'button', class: 'btn plain small', onclick: () => move(-1) }, 'Move earlier'),
                h('button', { type: 'button', class: 'btn plain small', onclick: () => move(1) }, 'Move later')),
              delArea))))
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
        document.body.append(overlay)
      }

      // ----- the filters -----
      const search = h('input', { type: 'text', placeholder: 'Search photos' })
      search.addEventListener('input', () => { q = search.value; drawGrid() })
      const filter = h('select', {}, h('option', { value: '' }, 'All groups'), gal.categories.map((c) => h('option', { value: c.id }, c.label)))
      filter.addEventListener('change', () => { filterCat = filter.value; drawGrid() })

      root.append(
        h('h1', {}, 'Photos'),
        h('p', { class: 'lead' }, 'Every photo in the gallery lives here. Add new ones, fix descriptions, hide or delete old ones, and drag to change the order.'),
        fileInput, addBox,
        h('div', { class: 'row filters' }, search, filter),
        count, grid)
      drawPending(); drawGrid()
    },
  }
}
