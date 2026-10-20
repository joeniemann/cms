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
// Checks the SEO settings so a typo cannot break the site.
export function seoProblem(seo: any): string | null {
  if (seo === undefined || seo === null) return null
  if (typeof seo !== 'object' || Array.isArray(seo)) return 'The SEO settings are not valid.'
  if (seo.siteUrl && !/^https:\/\/[^\/\s]+$/.test(seo.siteUrl)) return 'The main web address needs to start with https:// and have no slash at the end.'
  if (seo.serviceRegion !== undefined && (typeof seo.serviceRegion !== 'string' || seo.serviceRegion.length > 60)) return 'The region name is not valid.'
  const area = seo.serviceArea
  if (area !== undefined && area !== '') {
    if (typeof area === 'string') { if (area.length > 60) return 'The service area is too long.' }
    else if (!Array.isArray(area) || area.length > 60 || area.some((x: unknown) => typeof x !== 'string' || x.length > 40)) return 'The list of cities is not valid. Use up to 60 names.'
  }
  if (seo.redirects !== undefined) {
    if (!Array.isArray(seo.redirects) || seo.redirects.length > 100) return 'The redirects list is not valid.'
    const seen = new Set<string>()
    for (const r of seo.redirects) {
      if (!r || typeof r.from !== 'string' || typeof r.to !== 'string') return 'Every redirect needs an old and a new address.'
      if (!r.from && !r.to) continue
      if (!/^\/[^\s*:]*$/.test(r.from)) return 'An old address needs to start with / and have no spaces, like /old-page.'
      if (!/^(\/[^\s]*|https:\/\/[^\s]+)$/.test(r.to)) return 'A new address needs to start with / or https://.'
      if (r.from === r.to) return 'A redirect cannot point to itself: ' + r.from
      if (seen.has(r.from)) return 'You have two redirects for ' + r.from + '. Keep one.'
      seen.add(r.from)
      if (r.status !== undefined && !['301', '302', 301, 302].includes(r.status)) return 'A redirect type has to be 301 or 302.'
    }
  }
  if (seo.allowAiCrawlers !== undefined && typeof seo.allowAiCrawlers !== 'boolean') return 'The AI tools switch is not valid.'
  return null
}

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
    const bad = seoProblem(data.seo)
    if (bad) return bad
  }
  return null
}
