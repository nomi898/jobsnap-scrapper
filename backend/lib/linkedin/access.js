import { getLinkedInAccessMode } from './http.js'

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
