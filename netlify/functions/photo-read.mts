// Shows a photo that is only on the drafts branch (not live yet), so the editor can display it.
import { requireEditor, reply, gh, DRAFT, LIVE } from '../lib/core.mts'

const OK = /^assets\/(gallery|gallery-thumbs)\/g\d{3,5}\.webp$/

export default async (req: Request) => {
  const who = await requireEditor()
  if (who.error) return who.error
  const p = new URL(req.url).searchParams.get('p') || ''
  if (!OK.test(p)) return reply({ error: 'Not a photo.' }, 400)
  for (const ref of [DRAFT, LIVE]) {
    const r = await gh('/contents/' + p + '?ref=' + encodeURIComponent(ref), { headers: { accept: 'application/vnd.github.raw+json' } })
    if (r.status === 200) {
      return new Response(await r.arrayBuffer(), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=60' } })
    }
  }
  return reply({ error: 'Not found.' }, 404)
}
