import { normalizeLiAtCookie } from '../src/utils/linkedinCookie.js'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const LINKEDIN_ACCESS = {
  guest: 'guest',
  session: 'session',
}

export { normalizeLiAtCookie }

/**
 * Resolve li_at with priority:
 * 1. Settings / request body (website field)
 * 2. LI_AT_COOKIE in .env
 */
export function resolveLinkedInSession(requestCookie, { allowEnv = true } = {}) {
  const fromSettings = normalizeLiAtCookie(requestCookie)
  if (fromSettings) {
    return {
      cookie: fromSettings,
      mode: LINKEDIN_ACCESS.session,
      source: 'settings',
    }
  }

  if (!allowEnv) {
    return { cookie: null, mode: LINKEDIN_ACCESS.guest, source: 'none' }
  }

  const fromEnv = normalizeLiAtCookie(process.env.LI_AT_COOKIE)
  if (fromEnv) {
    return {
      cookie: fromEnv,
      mode: LINKEDIN_ACCESS.session,
      source: 'env',
    }
  }

  return { cookie: null, mode: LINKEDIN_ACCESS.guest, source: 'none' }
}

/** @deprecated alias — use resolveLinkedInSession */
export function resolveLiAtCookie(liAtCookie, { allowEnv = true } = {}) {
  return resolveLinkedInSession(liAtCookie, { allowEnv }).cookie
}

/** Cookie from API request body and/or .env (for handlers). */
export function resolveRequestLiAtCookie(requestCookie) {
  return resolveLinkedInSession(requestCookie, { allowEnv: true })
}

/**
 * session — li_at available, send Cookie header
 * guest   — no li_at, public jobs-guest endpoints only
 */
export function getLinkedInAccessMode(liAtCookie) {
  const session = resolveLinkedInSession(liAtCookie, { allowEnv: true })
  return {
    mode: session.mode,
    cookie: session.cookie,
    source: session.source,
  }
}

export function buildLinkedInHeaders({
  liAtCookie,
  referer,
  allowEnv = true,
} = {}) {
  const liAt = resolveLinkedInSession(liAtCookie, { allowEnv }).cookie
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  }

  if (referer) {
    headers.Referer = referer
  }

  if (liAt) {
    headers.Cookie = `li_at=${liAt}`
  }

  return { headers, liAt, mode: liAt ? LINKEDIN_ACCESS.session : LINKEDIN_ACCESS.guest }
}

export function isBlockedLinkedInResponse(html, status) {
  if (status === 429) return true
  const text = String(html ?? '')
  if (text.length < 500) return true
  const lower = text.toLowerCase()
  return (
    lower.includes('authwall') ||
    lower.includes('too many requests') ||
    lower.includes('receiving too many requests')
  )
}

export async function fetchLinkedInPage(url, options = {}) {
  const {
    liAtCookie,
    referer,
    timeoutMs = 20000,
    fallbackToGuest = true,
    forceGuest = false,
  } = options

  const {
    mode: requestedMode,
    cookie,
    source: sessionSource,
  } = forceGuest
    ? { mode: LINKEDIN_ACCESS.guest, cookie: null, source: 'none' }
    : resolveLinkedInSession(liAtCookie, { allowEnv: true })

  async function attemptGuest() {
    const { headers } = buildLinkedInHeaders({
      liAtCookie: null,
      referer,
      allowEnv: false,
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      })
      const html = await response.text()
      return { response, html }
    } finally {
      clearTimeout(timeout)
    }
  }

  async function attemptSession() {
    const { headers } = buildLinkedInHeaders({
      liAtCookie: cookie,
      referer,
      allowEnv: false,
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      })
      const html = await response.text()
      return { response, html }
    } finally {
      clearTimeout(timeout)
    }
  }

  try {
    if (requestedMode === LINKEDIN_ACCESS.guest) {
      const result = await attemptGuest()
      return {
        html: result.html,
        status: result.response.status,
        accessMode: LINKEDIN_ACCESS.guest,
        sessionSource: 'none',
        cookieRejected: false,
        usedCookie: false,
      }
    }

    let result = await attemptSession()
    let accessMode = LINKEDIN_ACCESS.session
    let cookieRejected = false
    let activeSource = sessionSource

    if (fallbackToGuest && isBlockedLinkedInResponse(result.html, result.response.status)) {
      result = await attemptGuest()
      accessMode = LINKEDIN_ACCESS.guest
      cookieRejected = true
      activeSource = 'none'
    }

    return {
      html: result.html,
      status: result.response.status,
      accessMode,
      sessionSource: activeSource,
      cookieRejected,
      usedCookie: !cookieRejected,
    }
  } catch (err) {
    if (requestedMode === LINKEDIN_ACCESS.session && fallbackToGuest) {
      try {
        const result = await attemptGuest()
        return {
          html: result.html,
          status: result.response.status,
          accessMode: LINKEDIN_ACCESS.guest,
          sessionSource: 'none',
          cookieRejected: true,
          usedCookie: false,
        }
      } catch (retryErr) {
        const message =
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        return {
          error:
            message.includes('abort') ?
              'Request timed out'
            : message.includes('redirect') ?
              'LinkedIn rejected the li_at cookie. Clear it in Settings or paste only the value (not li_at=).'
            : message,
        }
      }
    }

    const message = err instanceof Error ? err.message : String(err)
    return {
      error:
        message.includes('abort') ? 'Request timed out'
        : message.includes('redirect') ?
          'LinkedIn rejected the li_at cookie. Paste only the value from DevTools, without li_at=.'
        : message,
    }
  }
}
