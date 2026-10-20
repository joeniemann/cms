// Removes one photo (both files) from the drafts branch.
import { requireEditor, reply, ensureDraftBranch, gh, DRAFT } from '../lib/core.mts'

const ID = /^g\d{3,5}$/

async function remove(path: string, message: string) {
  const r = await gh('/contents/' + path + '?ref=' + encodeURIComponent(DRAFT))
  if (r.status === 404) return
  if (r.status !== 200) throw new Error('Could not find the photo (' + r.status + ').')
  const sha = (await r.json()).sha
  const d = await gh('/contents/' + path, { method: 'DELETE', body: JSON.stringify({ message, sha, branch: DRAFT }) })
  if (d.status !== 200) throw new Error('Could not delete the photo (' + d.status + ').')
}

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const who = await requireEditor()
  if (who.error) return who.error
  let body: any
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const id = body && body.id
  if (typeof id !== 'string' || !ID.test(id)) return reply({ error: 'Bad photo id.' }, 400)
  try {
    await ensureDraftBranch()
    const by = ' (' + who.user!.email + ')'
    await remove('assets/gallery/' + id + '.webp', 'Draft: delete photo ' + id + by)
    await remove('assets/gallery-thumbs/' + id + '.webp', 'Draft: delete photo thumbnail ' + id + by)
    return reply({ ok: true })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
