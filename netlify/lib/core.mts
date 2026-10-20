// Shared helpers for the editor functions: login check, GitHub calls, safety checks.
import { getUser } from '@netlify/identity'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The site's own files, shipped with the functions (see included_files in netlify.toml).
const ROOT = process.env.LAMBDA_TASK_ROOT || process.cwd()
function siteJson(rel: string): any { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) }
let config: any = {}
try { config = siteJson('cms.config.json') } catch { /* settings can also come from Netlify environment variables */ }
let schemaCache: any = null
const schema = () => (schemaCache = schemaCache || siteJson('cms/blocks.json'))

const REPO = process.env.GITHUB_REPO || config.repo || ''
export const LIVE = process.env.LIVE_BRANCH || config.liveBranch || 'main'
export const DRAFT = process.env.DRAFT_BRANCH || config.draftBranch || 'drafts'

export function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

// Only people with the owner or editor role get in.
export async function requireEditor() {
  const user = await getUser()
  if (!user) return { error: reply({ error: 'Please log in again.' }, 401) }
  const roles = user.roles || []
  if (!roles.includes('owner') && !roles.includes('editor')) return { error: reply({ error: 'You do not have access yet.' }, 403) }
  return { user }
}

// Only these files can be read or written from the editor.
const OK_PATH = /^content\/(site|photos|gallery)\.json$|^content\/pages\/[a-z0-9-]+\.json$/
export function okPath(p: unknown): p is string {
  return typeof p === 'string' && OK_PATH.test(p) && !p.includes('..')
}

export async function gh(path: string, init: RequestInit = {}) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  if (!REPO) throw new Error('No GitHub repo set. Add "repo" to cms.config.json or set GITHUB_REPO.')
  return fetch('https://api.github.com/repos/' + REPO + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'cms',
      ...(init.headers || {}),
    },
  })
}

// Make sure the drafts branch exists. It starts as a copy of the live branch.
export async function ensureDraftBranch() {
  const r = await gh('/git/ref/heads/' + DRAFT)
  if (r.status === 200) return
  if (r.status !== 404) throw new Error('Could not check the drafts branch (' + r.status + ')')
  const live = await gh('/git/ref/heads/' + LIVE)
  if (live.status !== 200) throw new Error('Could not find the live branch (' + live.status + ')')
  const sha = (await live.json()).object.sha
  const c = await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + DRAFT, sha }) })
  if (c.status !== 201 && c.status !== 422) throw new Error('Could not create the drafts branch (' + c.status + ')')
}

export async function readFile(path: string, branch: string, sha?: string) {
  const ref = sha || branch
  const r = await gh('/contents/' + path + '?ref=' + encodeURIComponent(ref))
  if (r.status === 404) return null
  if (r.status !== 200) throw new Error('Could not read ' + path + ' (' + r.status + ')')
  const j = await r.json()
  return { sha: j.sha as string, text: Buffer.from(j.content, 'base64').toString('utf8') }
}

// Checks a file before it is saved. Returns a plain-English problem, or null if fine.
export function problemWith(path: string, text: string): string | null {
  if (text.length > 400000) return 'That file is too big.'
  let data: any
  try { data = JSON.parse(text) } catch { return 'That is not valid content.' }
  if (path.startsWith('content/pages/')) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.blocks)) return 'This page is missing its blocks.'
    const known = Object.keys(schema().blocks)
    for (const b of data.blocks) {
      if (!b || typeof b.type !== 'string' || !known.includes(b.type)) return 'This page has a block the editor does not know about.'
    }
    if (typeof data.title !== 'string' || !data.title.trim()) return 'Every page needs a title.'
    const name = path.slice('content/pages/'.length, -'.json'.length)
    if (data.id !== name) return 'This page has the wrong address.'
    if (data.file !== (data.id === 'home' ? 'index.html' : name + '.html')) return 'This page has the wrong file name.'
  }
  if (path === 'content/site.json') {
    if (!data || typeof data !== 'object' || !data.business || !data.menu) return 'Business info or the menu is missing.'
  }
  return null
}
