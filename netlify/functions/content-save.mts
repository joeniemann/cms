// Saves one content file to the drafts branch. Nothing goes live from here.
import { requireEditor, reply, okPath, ensureDraftBranch, gh, problemWith, DRAFT, LIVE } from '../lib/core.mts'

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const who = await requireEditor()
  if (who.error) return who.error
  let body: any
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const { path, content, sha } = body || {}
  if (!okPath(path)) return reply({ error: 'That file is not editable.' }, 400)
  // Only the owner can change the SEO settings. Editors can save everything else in site.json.
  if (path === 'content/site.json' && !(who.user!.roles || []).includes('owner')) {
    const cur = await gh('/contents/' + path + '?ref=' + DRAFT)
    const live = cur.status === 200 ? cur : await gh('/contents/' + path + '?ref=' + LIVE)
    if (live.status !== 200) return reply({ error: 'Could not check the settings. Try again.' }, 500)
    const j0 = await live.json()
    const before = JSON.parse(Buffer.from(j0.content, 'base64').toString('utf8'))
    if (JSON.stringify(before.seo ?? null) !== JSON.stringify((content && content.seo) ?? null)) return reply({ error: 'Only the owner can change the SEO settings.' }, 403)
  }
  const text = JSON.stringify(content, null, 2) + '\n'
  const bad = problemWith(path, text)
  if (bad) return reply({ error: bad }, 400)
  try {
    await ensureDraftBranch()
    const r = await gh('/contents/' + path, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Draft: update ' + path + ' (' + who.user!.email + ')',
        content: Buffer.from(text, 'utf8').toString('base64'),
        branch: DRAFT,
        sha,
      }),
    })
    if (r.status === 409 || r.status === 422) return reply({ error: 'Someone else saved this at the same time. Reload and try again.' }, 409)
    if (r.status !== 200 && r.status !== 201) return reply({ error: 'Save failed (' + r.status + ').' }, 500)
    const j = await r.json()
    return reply({ ok: true, sha: j.content.sha })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
