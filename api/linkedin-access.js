import { getLinkedInAccessMode } from './linkedinHttp.js'

export function getLinkedInAccessInfo(requestCookie) {
  const { source } = getLinkedInAccessMode(requestCookie)
  return {
    mode: 'guest',
    source,
    hasCookie: source !== 'none',
    companySession: source !== 'none',
    envConfigured: Boolean(
      String(process.env.LI_AT_COOKIE ?? '').trim()
    ),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.method === 'POST' ? req.body ?? {} : {}
  res.status(200).json(getLinkedInAccessInfo(body.liAtCookie))
}
