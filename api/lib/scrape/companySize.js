import { cleanLinkedInUrl } from './html.js'
import {
  fetchLinkedInPage,
  isBlockedLinkedInResponse,
  resolveLinkedInSession,
} from '../linkedin/http.js'

const REQUEST_TIMEOUT_MS = 15000
const COMPANY_FETCH_CONCURRENCY = 4
const COMPANY_FETCH_DELAY_MS = 300

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseCompanySizeFromHtml(html) {
  const text = String(html ?? '')
  const jsonPatterns = [
    /"employeeCount":(\d+)/,
    /"numberOfEmployees":\{"value":(\d+)/,
    /Employees":\{"value":(\d+)/,
    /"staffCount":(\d+)/,
  ]

  for (const pattern of jsonPatterns) {
    const match = text.match(pattern)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) return value
    }
  }

  const textMatch = text.match(/([\d,]+)\+?\s+employees/i)
  if (textMatch) {
    const value = Number(textMatch[1].replace(/,/g, ''))
    if (Number.isFinite(value) && value > 0) return value
  }

  return null
}

async function fetchCompanyPage(companyUrl, liAtCookie, { forceGuest = false } = {}) {
  const url = cleanLinkedInUrl(companyUrl)
  if (!url) return { url: null, page: null }

  const session = resolveLinkedInSession(liAtCookie)
  const page = await fetchLinkedInPage(url, {
    liAtCookie: forceGuest ? null : session.cookie,
    timeoutMs: REQUEST_TIMEOUT_MS,
    fallbackToGuest: !forceGuest && Boolean(session.cookie),
    forceGuest,
  })

  return { url, page }
}

/**
 * Logged-in company pages often omit employeeCount in HTML.
 * If session loads but size is missing, retry as guest (public page).
 */
async function fetchCompanySize(companyUrl, liAtCookie) {
  const { url, page } = await fetchCompanyPage(companyUrl, liAtCookie)
  if (!url || !page) return { size: null, source: null }

  if (page.error || isBlockedLinkedInResponse(page.html, page.status)) {
    const guest = await fetchCompanyPage(companyUrl, liAtCookie, { forceGuest: true })
    if (!guest.page || guest.page.error) return { size: null, source: null }
    if (isBlockedLinkedInResponse(guest.page.html, guest.page.status)) {
      return { size: null, source: null }
    }
    const size = parseCompanySizeFromHtml(guest.page.html)
    return { size, source: size != null ? 'guest' : null }
  }

  let size = parseCompanySizeFromHtml(page.html)
  let source = page.usedCookie ? 'session' : 'guest'

  if (size == null && page.usedCookie) {
    const guest = await fetchCompanyPage(companyUrl, liAtCookie, { forceGuest: true })
    if (
      guest.page &&
      !guest.page.error &&
      !isBlockedLinkedInResponse(guest.page.html, guest.page.status)
    ) {
      const guestSize = parseCompanySizeFromHtml(guest.page.html)
      if (guestSize != null) {
        return { size: guestSize, source: 'guest-fallback' }
      }
    }
  }

  return { size, source: size != null ? source : null }
}

export async function enrichJobsWithCompanySize(jobs, liAtCookie) {
  const sizeByCompanyUrl = new Map()
  const enrichment = {
    attempted: 0,
    loaded: 0,
    viaSession: 0,
    viaGuest: 0,
    viaGuestFallback: 0,
    hasCookie: Boolean(resolveLinkedInSession(liAtCookie).cookie),
  }

  const uniqueUrls = [
    ...new Set(
      jobs
        .map((job) => cleanLinkedInUrl(job.companyUrl))
        .filter(Boolean)
    ),
  ]

  enrichment.attempted = uniqueUrls.length

  for (let index = 0; index < uniqueUrls.length; index += COMPANY_FETCH_CONCURRENCY) {
    const batch = uniqueUrls.slice(index, index + COMPANY_FETCH_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (companyUrl) => {
        const result = await fetchCompanySize(companyUrl, liAtCookie)
        return [companyUrl, result]
      })
    )

    for (const [companyUrl, result] of results) {
      if (result.size == null) continue

      sizeByCompanyUrl.set(companyUrl, result.size)
      enrichment.loaded += 1

      if (result.source === 'session') enrichment.viaSession += 1
      else if (result.source === 'guest-fallback') enrichment.viaGuestFallback += 1
      else if (result.source === 'guest') enrichment.viaGuest += 1
    }

    if (index + COMPANY_FETCH_CONCURRENCY < uniqueUrls.length) {
      await sleep(COMPANY_FETCH_DELAY_MS)
    }
  }

  const enrichedJobs = jobs.map((job) => {
    const companyUrl = cleanLinkedInUrl(job.companyUrl)
    const companySize = companyUrl ? sizeByCompanyUrl.get(companyUrl) ?? null : null
    return companySize == null ? job : { ...job, companySize }
  })

  return { jobs: enrichedJobs, enrichment }
}
