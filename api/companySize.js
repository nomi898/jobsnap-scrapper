import * as cheerio from 'cheerio'
import { cleanLinkedInUrl } from './linkedinHtmlScraper.js'
import {
  fetchLinkedInPage,
  isBlockedLinkedInResponse,
  resolveLinkedInSession,
} from './linkedinHttp.js'

const REQUEST_TIMEOUT_MS = 15000
const COMPANY_FETCH_CONCURRENCY = 1
const COMPANY_FETCH_DELAY_MS = 4000
const COMPANY_FETCH_COOLDOWN_EVERY = 10
const COMPANY_FETCH_COOLDOWN_MIN_MS = 20000
const COMPANY_FETCH_COOLDOWN_MAX_MS = 30000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function cleanText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function readAboutField($, testId) {
  return cleanText($(`[data-test-id="${testId}"]`).find('dd').first().text())
}

function isPlausibleEmployeeCount(value) {
  const count = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(count) && count > 1
}

function normalizeSizeLabel(label) {
  const text = cleanText(label).replace(/\s*employees?\s*/i, '')
  return text && /\d/.test(text) ? text : null
}

export function parseCompanySizeCountFromHtml(html) {
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
      if (isPlausibleEmployeeCount(value)) return value
    }
  }

  const textMatch = text.match(/([\d,]+)\+?\s+employees/i)
  if (textMatch) {
    const value = Number(textMatch[1].replace(/,/g, ''))
    if (isPlausibleEmployeeCount(value)) return value
  }

  return null
}

export function parseCompanySizeLabelFromHtml(html) {
  const $ = cheerio.load(String(html ?? ''))

  const aboutLabel = normalizeSizeLabel(readAboutField($, 'about-us__size'))
  if (aboutLabel) return aboutLabel

  const summaryCandidates = [
    $('.org-top-card-summary-info-list__info-item'),
    $('.org-about-company-module__company-size-definition-text'),
    $('[class*="company-size"]'),
  ]

  for (const nodes of summaryCandidates) {
    let found = null
    nodes.each((_index, element) => {
      if (found) return
      const text = cleanText($(element).text())
      const normalized = normalizeSizeLabel(text)
      if (normalized) found = normalized
    })
    if (found) return found
  }

  const bandMatch = String(html ?? '').match(
    /(\d[\d,]*\s*-\s*\d[\d,]*\+?|\d[\d,]*\+)\s+employees/i
  )
  if (bandMatch) {
    return normalizeSizeLabel(bandMatch[0])
  }

  return null
}

/** @returns {{ count: number|null, label: string|null }} */
export function parseCompanySizeFromHtml(html) {
  const count = parseCompanySizeCountFromHtml(html)
  const label = parseCompanySizeLabelFromHtml(html)

  if (count != null) {
    return { count, label: label ?? null }
  }

  if (label) {
    return { count: null, label }
  }

  return { count: null, label: null }
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

function parseSizeFromPage(page) {
  if (!page?.html) return { count: null, label: null }
  return parseCompanySizeFromHtml(page.html)
}

/**
 * Logged-in company pages often omit employeeCount in HTML.
 * If session loads but size is missing, retry as guest (public page).
 */
async function fetchCompanySize(companyUrl, liAtCookie) {
  const { url, page } = await fetchCompanyPage(companyUrl, liAtCookie)
  if (!url || !page) return { count: null, label: null, source: null }

  if (page.error || isBlockedLinkedInResponse(page.html, page.status)) {
    const guest = await fetchCompanyPage(companyUrl, liAtCookie, { forceGuest: true })
    if (!guest.page || guest.page.error) {
      return { count: null, label: null, source: null }
    }
    if (isBlockedLinkedInResponse(guest.page.html, guest.page.status)) {
      return { count: null, label: null, source: null }
    }
    const parsed = parseSizeFromPage(guest.page)
    const hasSize = parsed.count != null || parsed.label != null
    return { ...parsed, source: hasSize ? 'guest' : null }
  }

  let parsed = parseSizeFromPage(page)
  let source = page.usedCookie ? 'session' : 'guest'

  if (parsed.count == null && parsed.label == null && page.usedCookie) {
    const guest = await fetchCompanyPage(companyUrl, liAtCookie, { forceGuest: true })
    if (
      guest.page &&
      !guest.page.error &&
      !isBlockedLinkedInResponse(guest.page.html, guest.page.status)
    ) {
      const guestParsed = parseSizeFromPage(guest.page)
      if (guestParsed.count != null || guestParsed.label != null) {
        return { ...guestParsed, source: 'guest-fallback' }
      }
    }
  }

  const hasSize = parsed.count != null || parsed.label != null
  return { ...parsed, source: hasSize ? source : null }
}

function applyCompanySizePatch(jobs, companyUrl, result) {
  return jobs.map((job) => {
    if (cleanLinkedInUrl(job.companyUrl) !== companyUrl) return job

    return {
      ...job,
      companySizeCount: result.count ?? job.companySizeCount ?? null,
      companySizeLabel: result.label ?? job.companySizeLabel ?? null,
      ...(result.count != null
        ? { companySize: result.count }
        : result.label
          ? { companySize: result.label }
          : {}),
    }
  })
}

export async function enrichJobsWithCompanySize(jobs, liAtCookie, onProgress) {
  const sizeByCompanyUrl = new Map()
  let workingJobs = jobs
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
      const hasSize = result.count != null || result.label != null

      if (hasSize) {
        sizeByCompanyUrl.set(companyUrl, {
          companySizeCount: result.count,
          companySizeLabel: result.label,
        })
        workingJobs = applyCompanySizePatch(workingJobs, companyUrl, result)
        enrichment.loaded += 1

        if (result.source === 'session') enrichment.viaSession += 1
        else if (result.source === 'guest-fallback') enrichment.viaGuestFallback += 1
        else if (result.source === 'guest') enrichment.viaGuest += 1
      }

      onProgress?.({
        jobs: workingJobs,
        completed: Math.min(index + results.length, uniqueUrls.length),
        total: uniqueUrls.length,
        companyUrl,
        loaded: enrichment.loaded,
        enrichment: { ...enrichment },
      })
    }

    if (index + COMPANY_FETCH_CONCURRENCY < uniqueUrls.length) {
      const completed = index + COMPANY_FETCH_CONCURRENCY
      if (completed % COMPANY_FETCH_COOLDOWN_EVERY === 0) {
        await sleep(
          randomBetween(
            COMPANY_FETCH_COOLDOWN_MIN_MS,
            COMPANY_FETCH_COOLDOWN_MAX_MS
          )
        )
      } else {
        await sleep(COMPANY_FETCH_DELAY_MS)
      }
    }
  }

  const enrichedJobs = jobs.map((job) => {
    const companyUrl = cleanLinkedInUrl(job.companyUrl)
    const patch = companyUrl ? sizeByCompanyUrl.get(companyUrl) : null
    if (!patch) return job

    return {
      ...job,
      companySizeCount: patch.companySizeCount ?? job.companySizeCount ?? null,
      companySizeLabel: patch.companySizeLabel ?? job.companySizeLabel ?? null,
      ...(patch.companySizeCount != null
        ? { companySize: patch.companySizeCount }
        : patch.companySizeLabel
          ? { companySize: patch.companySizeLabel }
          : {}),
    }
  })

  return { jobs: enrichedJobs, enrichment }
}
