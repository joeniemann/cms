// "Start over on this page": puts the drafts copy of one file back to exactly what is live now.
// Nothing goes live from here.
import { requireEditor, reply, okPath, ensureDraftBranch, readFile, gh, DRAFT, LIVE } from '../lib/core.mts'

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const who = await requireEditor()
  if (who.error) return who.error
  let body: any
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const path = body && body.path
  if (!okPath(path)) return reply({ error: 'That file is not editable.' }, 400)
  try {
    await ensureDraftBranch()
    const live = await readFile(path, LIVE)
    if (!live) return reply({ error: 'This page has never been on the live site, so there is nothing to go back to.' }, 404)
    const cur = await readFile(path, DRAFT)
    if (cur && cur.text === live.text) return reply({ ok: true, same: true })
    const r = await gh('/contents/' + path, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Draft: start over, back to the live version of ' + path + ' (' + who.user!.email + ')',
        content: Buffer.from(live.text, 'utf8').toString('base64'),
        branch: DRAFT,
        sha: cur ? cur.sha : undefined,
      }),
    })
    if (r.status !== 200 && r.status !== 201) return reply({ error: 'Could not start over (' + r.status + ').' }, 500)
    return reply({ ok: true })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
