export const LINKEDIN_ACCESS = {
  guest: 'guest',
  session: 'session',
}

export function getLinkedInAccessLabel(
  mode,
  cookieRejected = false,
  source = 'none'
) {
  if (cookieRejected) return 'Guest · cookie skipped'
  if (source === 'settings') return 'Session · Settings'
  if (source === 'env') return 'Session · .env'
  if (mode === LINKEDIN_ACCESS.session) return 'Session'
  return 'Guest'
}

export function normalizeLiAtCookie(raw) {
  let value = String(raw ?? '').trim()
  if (!value) return ''

  const fromHeader = value.match(/(?:^|;\s*)li_at=([^;]+)/i)
  if (fromHeader?.[1]) {
    value = fromHeader[1].trim()
  }

  value = value.replace(/^li_at=/i, '').trim()
  value = value.replace(/^["']|["']$/g, '').trim()

  return value
}
