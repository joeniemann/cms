// GET ?path=...  lists past versions of a file.
// POST {path, sha}  puts an old version back into the drafts (nothing goes live until "Make it live").
import { requireEditor, reply, okPath, ensureDraftBranch, readFile, gh, DRAFT, LIVE } from '../lib/core.mts'

export default async (req: Request) => {
  const who = await requireEditor()
  if (who.error) return who.error
  try {
    if (req.method === 'GET') {
      const path = new URL(req.url).searchParams.get('path')
      if (!okPath(path)) return reply({ error: 'That file is not editable.' }, 400)
      // Only the versions that went live: each "Make it live" counts once, however many saves came before it.
      const pull = async (extra: string) => {
        const pages = await Promise.all([1, 2, 3, 4, 5].map((n) => gh('/commits?sha=' + encodeURIComponent(LIVE) + '&per_page=100&page=' + n + extra)))
        const out: any[] = []
        for (const r of pages) {
          if (r.status === 404 || r.status === 422) continue
          if (r.status !== 200) throw new Error('Could not load history (' + r.status + ').')
          out.push(...(await r.json()))
        }
        return out
      }
      const [all, mine] = await Promise.all([pull(''), pull('&path=' + encodeURIComponent(path))])
      const email = (m: string) => { const x = /\(([^)]+)\)\s*$/.exec(m.split('\n')[0]); return x ? x[1] : '' }
      const pubs = all.filter((c: any) => c.commit.message.startsWith('Make it live'))
        .map((c: any) => ({ when: c.commit.committer.date as string, by: email(c.commit.message) }))
        .sort((a: any, b: any) => a.when.localeCompare(b.when))
      const seen = new Set<string>()
      const versions: any[] = []
      for (const c of mine) {
        const msg: string = c.commit.message
        const date: string = c.commit.committer.date
        if (!msg.startsWith('Draft:')) { versions.push({ sha: c.sha, when: date, by: '', note: 'Changed directly by Joe' }); continue }
        const pub = pubs.find((x: any) => x.when >= date)
        if (!pub) { versions.push({ sha: c.sha, when: date, by: email(msg), note: 'Made live' }); continue }
        const key = pub.when
        if (seen.has(key)) continue
        seen.add(key)
        versions.push({ sha: c.sha, when: pub.when, by: pub.by || email(msg), note: 'Made live' })
      }
      versions.sort((a, b) => b.when.localeCompare(a.when))
      return reply({ versions: versions.slice(0, 20) })
    }
    if (req.method === 'POST') {
      const { path, sha } = await req.json()
      if (!okPath(path) || typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) return reply({ error: 'Bad request.' }, 400)
      await ensureDraftBranch()
      const old = await readFile(path, LIVE, sha)
      const cur = await readFile(path, DRAFT)
      if (!old) return reply({ error: 'That version was not found.' }, 404)
      const r = await gh('/contents/' + path, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Draft: put back an older version of ' + path + ' (' + who.user!.email + ')',
          content: Buffer.from(old.text, 'utf8').toString('base64'),
          branch: DRAFT,
          sha: cur ? cur.sha : undefined,
        }),
      })
      if (r.status !== 200 && r.status !== 201) return reply({ error: 'Could not put it back (' + r.status + ').' }, 500)
      return reply({ ok: true })
    }
    return reply({ error: 'Use GET or POST.' }, 405)
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
