// "Make it live": merges the drafts branch into the live branch. Netlify then rebuilds the site.
// If the two sides clash, the editor's changes are combined with the live ones automatically.
import { requireEditor, reply, ensureDraftBranch, gh, okPath, problemWith, DRAFT, LIVE } from '../lib/core.mts'
import { combine } from '../lib/combine.mts'

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const who = await requireEditor()
  if (who.error) return who.error
  try {
    await ensureDraftBranch()
    const merge = () => gh('/merges', {
      method: 'POST',
      body: JSON.stringify({ base: LIVE, head: DRAFT, commit_message: 'Make it live (' + who.user!.email + ')' }),
    })
    let r = await merge()
    let combined = false
    if (r.status === 409) {
      try {
        await combine({ gh, okPath, problemWith, LIVE, DRAFT }, who.user!.email!)
      } catch (e: any) {
        return reply({ error: 'The live site changed in a way that could not be combined with your edits automatically. Ask Joe to sort it out. (' + e.message + ')' }, 409)
      }
      combined = true
      r = await merge()
    }
    if (r.status === 204) return reply({ ok: true, nothing: true })
    if (r.status === 201) return reply({ ok: true, combined })
    if (r.status === 409) return reply({ error: 'The live site changed in a way that clashes with your edits. Ask Joe to sort it out.' }, 409)
    return reply({ error: 'Could not publish (' + r.status + ').' }, 500)
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
