// Lists every page (from the drafts branch) so the editor can show them in the menu and link pickers.
import { requireEditor, reply, ensureDraftBranch, gh, readFile, DRAFT } from '../lib/core.mts'

export default async () => {
  const who = await requireEditor()
  if (who.error) return who.error
  try {
    await ensureDraftBranch()
    const r = await gh('/contents/content/pages?ref=' + encodeURIComponent(DRAFT))
    if (r.status !== 200) return reply({ error: 'Could not list the pages (' + r.status + ').' }, 500)
    const files = (await r.json()).filter((f: any) => f.type === 'file' && f.name.endsWith('.json'))
    const pages = (await Promise.all(files.map(async (f: any) => {
      const x = await readFile(f.path, DRAFT)
      if (!x) return null
      try {
        const d = JSON.parse(x.text)
        return { id: d.id, type: d.type, file: d.file, title: d.title, published: d.published !== false, archived: !!d.archived, custom: !!d.custom }
      } catch { return null }
    }))).filter(Boolean)
    return reply({ pages })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
