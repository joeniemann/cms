// Sorts out a "clash" when the live branch and the drafts both changed the same files.
// The editor's version (the drafts) wins wherever both changed the same setting.
// Everything else from both sides is kept. The result is written into the drafts as a normal merge commit.

const stable = (v: any): string => {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  return v === undefined ? 'undefined' : JSON.stringify(v)
}
const same = (a: any, b: any) => stable(a) === stable(b)
const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v)

// Three-way merge of two edited copies of the same JSON. `live` came from the live branch, `mine` from the editor.
export function mergeJson(base: any, live: any, mine: any, overlaps: string[] = [], at = ''): any {
  if (same(mine, base)) return live
  if (same(live, base)) return mine
  if (same(live, mine)) return live
  if (isObj(live) && isObj(mine)) {
    const b = isObj(base) ? base : {}
    const out: any = {}
    const keys = [...Object.keys(mine), ...Object.keys(live).filter((k) => !(k in mine))]
    for (const k of keys) {
      const v = mergeJson(b[k], live[k], mine[k], overlaps, at ? at + '.' + k : k)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  overlaps.push(at || '(whole file)')
  return mine
}

type Deps = {
  gh: (path: string, init?: RequestInit) => Promise<Response>
  okPath: (p: unknown) => boolean
  problemWith: (path: string, text: string) => string | null
  LIVE: string
  DRAFT: string
}

async function json(r: Response, what: string) {
  if (r.status < 200 || r.status > 299) throw new Error(what + ' (' + r.status + ')')
  return r.json()
}

// Files that changed between two points, handling GitHub's paging. Gives up above 300 files.
async function changedFiles(d: Deps, base: string, head: string) {
  const out: any[] = []
  for (let page = 1; page <= 3; page++) {
    const j = await json(await d.gh('/compare/' + base + '...' + head + '?per_page=100&page=' + page), 'Could not compare the versions')
    out.push(...(j.files || []))
    if ((j.files || []).length < 100) return out
  }
  throw new Error('Too many files changed to combine automatically')
}

async function textAt(d: Deps, path: string, ref: string): Promise<string | null> {
  const r = await d.gh('/contents/' + path + '?ref=' + encodeURIComponent(ref))
  if (r.status === 404) return null
  const j = await json(r, 'Could not read ' + path)
  return Buffer.from(j.content, 'base64').toString('utf8')
}

// Returns { combined: true, overlaps } when the drafts now include everything on live. Throws with a plain message if it cannot.
export async function combine(d: Deps, who: string) {
  const live = (await json(await d.gh('/git/ref/heads/' + d.LIVE), 'Could not find the live branch')).object.sha as string
  const draft = (await json(await d.gh('/git/ref/heads/' + d.DRAFT), 'Could not find the drafts branch')).object.sha as string
  const cmp = await json(await d.gh('/compare/' + live + '...' + draft), 'Could not compare the versions')
  const base = cmp.merge_base_commit.sha as string
  const mine = await changedFiles(d, base, draft)
  const theirs = await changedFiles(d, base, live)
  const liveBy = new Map<string, any>()
  for (const f of theirs) {
    liveBy.set(f.filename, f)
    if (f.previous_filename) liveBy.set(f.previous_filename, { filename: f.previous_filename, status: 'removed', sha: null })
  }
  const overlaps: string[] = []
  const entries: any[] = []
  const put = (path: string, sha: string | null) => entries.push({ path, mode: '100644', type: 'blob', sha })

  for (const f of mine) {
    const path = f.filename as string
    if (f.previous_filename && !liveBy.has(f.previous_filename)) put(f.previous_filename, null)
    const l = liveBy.get(path)
    if (!l) { put(path, f.status === 'removed' ? null : f.sha); continue }
    if (f.status === 'removed') { put(path, null); continue }
    if (l.status === 'removed' || !d.okPath(path) || !path.endsWith('.json')) { put(path, f.sha); continue }
    if (l.sha === f.sha) continue
    const [b, lt, mt] = await Promise.all([textAt(d, path, base), textAt(d, path, live), textAt(d, path, draft)])
    if (lt == null || mt == null) { put(path, f.sha); continue }
    const merged = mergeJson(b == null ? undefined : JSON.parse(b), JSON.parse(lt), JSON.parse(mt), overlaps, path.replace(/^content\//, '').replace(/\.json$/, ''))
    const text = JSON.stringify(merged, null, 2) + '\n'
    const bad = d.problemWith(path, text)
    if (bad) throw new Error('Could not combine ' + path + ': ' + bad)
    const blob = await json(await d.gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: Buffer.from(text, 'utf8').toString('base64'), encoding: 'base64' }) }), 'Could not save the combined file')
    put(path, blob.sha)
  }

  const liveCommit = await json(await d.gh('/git/commits/' + live), 'Could not read the live version')
  const tree = await json(await d.gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: liveCommit.tree.sha, tree: entries }) }), 'Could not build the combined version')
  const commit = await json(await d.gh('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: 'Draft: combine the live changes with your drafts (' + who + ')', tree: tree.sha, parents: [draft, live] }),
  }), 'Could not save the combined version')
  const up = await d.gh('/git/refs/heads/' + d.DRAFT, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) })
  if (up.status !== 200) throw new Error('Someone saved at the same moment. Try again.')
  return { combined: true, overlaps }
}
