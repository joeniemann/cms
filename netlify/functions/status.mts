// Says how many draft changes are waiting to go live.
import { requireEditor, reply, ensureDraftBranch, gh, DRAFT, LIVE } from '../lib/core.mts'

export default async () => {
  const who = await requireEditor()
  if (who.error) return who.error
  try {
    await ensureDraftBranch()
    const r = await gh('/compare/' + encodeURIComponent(LIVE) + '...' + encodeURIComponent(DRAFT))
    if (r.status !== 200) return reply({ error: 'Could not check (' + r.status + ').' }, 500)
    const j = await r.json()
    return reply({ waiting: j.ahead_by > 0 && (j.files || []).length > 0 })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
