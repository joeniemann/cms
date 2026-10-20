// Adds one photo (full size + thumbnail, both already shrunk in the browser) to the drafts branch.
import { requireEditor, reply, ensureDraftBranch, gh, DRAFT } from '../lib/core.mts'

const ID = /^g\d{3,5}$/
const MAX_FULL = 1_500_000
const MAX_THUMB = 300_000

function isWebp(buf: Buffer) {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
}

async function put(path: string, buf: Buffer, message: string) {
  const existing = await gh('/contents/' + path + '?ref=' + encodeURIComponent(DRAFT))
  const sha = existing.status === 200 ? (await existing.json()).sha : undefined
  const r = await gh('/contents/' + path, {
    method: 'PUT',
    body: JSON.stringify({ message, content: buf.toString('base64'), branch: DRAFT, sha }),
  })
  if (r.status !== 200 && r.status !== 201) throw new Error('Could not save the photo (' + r.status + ').')
}

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const who = await requireEditor()
  if (who.error) return who.error
  let body: any
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const { id, full, thumb } = body || {}
  if (typeof id !== 'string' || !ID.test(id)) return reply({ error: 'Bad photo id.' }, 400)
  if (typeof full !== 'string' || typeof thumb !== 'string') return reply({ error: 'The photo did not come through.' }, 400)
  const fullBuf = Buffer.from(full, 'base64')
  const thumbBuf = Buffer.from(thumb, 'base64')
  if (!isWebp(fullBuf) || !isWebp(thumbBuf)) return reply({ error: 'That did not look like a photo.' }, 400)
  if (fullBuf.length > MAX_FULL || thumbBuf.length > MAX_THUMB) return reply({ error: 'That photo is too big. Try a smaller one.' }, 400)
  try {
    await ensureDraftBranch()
    const by = ' (' + who.user!.email + ')'
    await put('assets/gallery/' + id + '.webp', fullBuf, 'Draft: add photo ' + id + by)
    await put('assets/gallery-thumbs/' + id + '.webp', thumbBuf, 'Draft: add photo thumbnail ' + id + by)
    return reply({ ok: true })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
