// The History screen: past live versions of one page, put one back, or start over.
export function historyScreen(d) {
  const { h, api, loadFile, state, setStatus, markWaiting, getPages, navLabel, flushAll, setPreview, refreshPreview } = d

  const when = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

  function ask(title, text, yesLabel) {
    return new Promise((resolve) => {
      const overlay = h('div', { class: 'overlay' })
      const done = (v) => { overlay.remove(); resolve(v) }
      overlay.append(h('div', { class: 'modal small' },
        h('div', { class: 'mhead' }, h('strong', {}, title)),
        h('p', {}, text),
        h('div', { class: 'blockactions' },
          h('button', { type: 'button', class: 'btn plain', onclick: () => done(false) }, 'Cancel'),
          h('button', { type: 'button', class: 'btn', onclick: () => done(true) }, yesLabel))))
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false) })
      document.body.append(overlay)
    })
  }

  // After the draft copy changes on the server, forget our cached copy so the editor re-reads it.
  async function afterChange(path) {
    const f = state.files[path]
    if (f && f.timer) clearTimeout(f.timer)
    delete state.files[path]
    await loadFile(path)
    markWaiting(true)
    refreshPreview()
  }

  return {
    title: 'History',
    preview: 'home',
    async render(root) {
      await flushAll()
      const choices = getPages().filter((p) => !p.archived).map((p) => ['content/pages/' + p.id + '.json', navLabel(p) + ' page', p.id])
      choices.push(['content/site.json', 'Site settings (Business info, Menu, Call band, Footer)', 'home'])
      const select = h('select', { class: 'histpick' }, ...choices.map(([path, label]) => h('option', { value: path }, label)))
      const out = h('div')
      const draw = async () => {
        const [path, , pid] = choices.find((c) => c[0] === select.value)
        setPreview(pid)
        refreshPreview()
        out.textContent = ''
        out.append(h('p', { class: 'lead' }, 'Loading the past versions...'))
        let versions
        try { versions = (await api('/.netlify/functions/history?path=' + encodeURIComponent(path))).versions } catch (err) { out.textContent = ''; out.append(h('p', { class: 'hint warn' }, err.message)); return }
        out.textContent = ''
        const reset = h('button', { type: 'button', class: 'btn plain', onclick: async () => {
          if (!(await ask('Start over on this page?', 'This throws away any changes you made that are not live yet, and puts the page back to how it is on the live site right now.', 'Yes, start over'))) return
          try {
            setStatus('Starting over...')
            await api('/.netlify/functions/draft-reset', { method: 'POST', body: JSON.stringify({ path }) })
            await afterChange(path)
            setStatus('Done. This page matches the live site again.', 'ok')
          } catch (err) { setStatus(err.message, 'bad') }
        } }, 'Start over on this page')
        out.append(
          h('div', { class: 'field' }, h('div', { class: 'lab' }, 'Changed your mind about edits that are not live yet?'), reset,
            h('p', { class: 'hint' }, 'Throws away your unpublished edits to this page only.')),
          h('div', { class: 'lab' }, 'Past versions that went live'))
        if (!versions.length) { out.append(h('p', { class: 'hint' }, 'No past versions yet. They show up here after this page has gone live.')); return }
        versions.forEach((v, i) => {
          const btn = i === 0
            ? h('span', { class: 'chip ok' }, 'Live right now')
            : h('button', { type: 'button', class: 'btn plain small', onclick: async () => {
                if (!(await ask('Put this version back?', 'The page goes back to how it was on ' + when(v.when) + '. It is not live until you click Make it live. You can still change your mind after.', 'Yes, put it back'))) return
                try {
                  setStatus('Putting it back...')
                  await api('/.netlify/functions/history', { method: 'POST', body: JSON.stringify({ path, sha: v.sha }) })
                  await afterChange(path)
                  setStatus('Done. Check the preview, then click Make it live.', 'ok')
                } catch (err) { setStatus(err.message, 'bad') }
              } }, 'Put this one back')
          out.append(h('div', { class: 'pagerow' },
            h('div', { class: 'pi' }, h('strong', {}, when(v.when)), h('span', { class: 'ptype' }, v.by ? v.note + ' by ' + v.by : v.note)), btn))
        })
      }
      select.addEventListener('change', draw)
      root.append(h('h1', {}, 'History'),
        h('p', { class: 'lead' }, 'Every time you click Make it live, that version is kept. Pick a page, then put an older version back if you need to. Photos are not included here, so deleted photos stay deleted.'),
        h('div', { class: 'field' }, h('label', {}, 'Which page?'), select), out)
      draw()
    },
  }
}
