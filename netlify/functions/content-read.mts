// Reads one content file from the drafts branch (falls back to live if there is no draft yet).
import { requireEditor, reply, okPath, ensureDraftBranch, readFile, DRAFT, LIVE } from '../lib/core.mts'

export default async (req: Request) => {
  const who = await requireEditor()
  if (who.error) return who.error
  const path = new URL(req.url).searchParams.get('path')
  if (!okPath(path)) return reply({ error: 'That file is not editable.' }, 400)
  try {
    await ensureDraftBranch()
    const f = await readFile(path, DRAFT)
    if (!f) return reply({ error: 'File not found.' }, 404)
    const live = await readFile(path, LIVE)
    return reply({ path, sha: f.sha, content: JSON.parse(f.text), changed: !live || live.text !== f.text })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
