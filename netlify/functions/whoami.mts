// Tells the editor page who is logged in and what role they have.
import { getUser } from '@netlify/identity'

export default async () => {
  const user = await getUser()
  if (!user) return new Response('Not logged in', { status: 401 })
  const roles = user.roles || []
  const role = roles.includes('owner') ? 'owner' : roles.includes('editor') ? 'editor' : null
  if (!role) return new Response('No access yet', { status: 403 })
  return Response.json({ email: user.email, role })
}
