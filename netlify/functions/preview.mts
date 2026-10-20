// Builds one page from edits that are not saved yet, so the editor can show a live preview.
import { requireEditor, reply } from '../lib/core.mts'
// @ts-ignore
import render from '../../cms/build/render.js'

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const who = await requireEditor()
  if (who.error) return who.error
  try {
    const body = await req.json()
    const root = process.env.LAMBDA_TASK_ROOT || process.cwd()
    let html: string = render.renderPreview(root, { pageId: body.pageId, site: body.site, page: body.page })
    // Make pictures and styles load, and keep clicks inside the preview from leaving it.
    html = html.replace('<head>', '<head><base href="/" target="_blank">')
    return reply({ html })
  } catch (e: any) {
    return reply({ error: e.message }, 500)
  }
}
