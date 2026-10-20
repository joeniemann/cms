// Deletes one added page from the drafts branch. Only pages that were added in the editor
// and have already been removed can be deleted. Nothing goes live until "Make it live".
import { requireEditor, reply, ensureDraftBranch, gh, readFile, DRAFT } from '../lib/core.mts'

const ID = /^[a-z0-9-]+$/
const PROTECTED = ['home', 'services', 'about', 'gallery', 'contact']

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const who = await requireEditor()
  if (who.error) return who.error
  let body: any
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const id = body && body.id
  if (typeof id !== 'string' || !ID.test(id) || PROTECTED.includes(id)) return reply({ error: 'That page cannot be deleted.' }, 400)
  try {
    await ensureDraftBranch()
    const path = 'content/pages/' + id + '.json'
    const f = await readFile(path, DRAFT)
    if (!f) return reply({ error: 'That page was not found.' }, 404)
    let page: any
    try { page = JSON.parse(f.text) } catch { return reply({ error: 'That page could not be read.' }, 500) }
    if (!page.custom) return reply({ error: 'Only pages you added can be deleted.' }, 400)
    if (!page.archived) return reply({ error: 'Remove the page first, then you can delete it.' }, 400)
    const d = await gh('/contents/' + path, {
      method: 'DELETE',
      body: JSON.stringify({ message: 'Draft: delete page ' + id + ' (' + who.user!.email + ')', sha: f.sha, branch: DRAFT }),
    })
    if (d.status !== 200) return reply({ error: 'Could not delete the page (' + d.status + ').' }, 500)
    return reply({ ok: true })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
