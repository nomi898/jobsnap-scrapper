import { LINKEDIN_RATE_LIMIT_ERROR, resolveGeoId } from '../constants'
import { cleanLinkedInUrl, resolveJobUrl } from './cleanJobFields'
import { normalizeLiAtCookie } from './linkedinCookie'
import { formatScrapeError } from './scrapeErrors'
import { parseKeywordList } from './keywords'
import {
  mergeJobWithFetchedDetails,
  normalizeJob,
} from './mergeJobRecord'

export { parseKeywordList, normalizeJob, mergeJobWithFetchedDetails }

function extractJobsFromResponse(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.jobs)) return data.jobs
  if (Array.isArray(data?.data?.jobs)) return data.data.jobs
  return []
}

function buildScrapePayload(settings, keywords, startPage, fetchMeta) {
  const cookie = normalizeLiAtCookie(settings.liAtCookie)
  return {
    keywords,
    startPage,
    append: startPage > 1,
    settings,
    ...(startPage > 1 && fetchMeta?.nextStartOffset != null
      ? { startOffset: fetchMeta.nextStartOffset }
      : {}),
    dateFilter: settings.scrapeDateFilter,
    geoId: resolveGeoId(settings),
    workTypeFilter: settings.workTypeFilter ?? 'all',
    fetchCompanySize: settings.fetchCompanySize !== false,
    ...(cookie ? { liAtCookie: cookie } : {}),
  }
}

async function fetchKeywordBatch(settings, keywords, startPage, fetchMeta = null) {
  const payload = buildScrapePayload(settings, keywords, startPage, fetchMeta)

  let response
  try {
    response = await fetch('/api/fetch-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error(
      'Network error — could not reach the scraper API. Restart the dev server and try again.'
    )
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(formatScrapeError(response.status, data))
  }

  const rawJobs = extractJobsFromResponse(data)
  const jobs = rawJobs.map(normalizeJob)
  const rateLimited =
    Boolean(data.rateLimited) ||
    (jobs.length === 0 && Number(data.meta?.rateLimitedPages) > 0)

  if (rateLimited) {
    throw new Error(data.error || LINKEDIN_RATE_LIMIT_ERROR)
  }

  return {
    jobs,
    hasMore: data.hasMore ?? jobs.length > 0,
    nextStartPage: data.nextStartPage ?? startPage + 1,
    meta: data.meta ?? null,
    warning: data.warning ?? null,
    rateLimited: false,
  }
}

export async function fetchJobsFromScraper(settings, startPage = 1, fetchMeta = null) {
  const keywords = parseKeywordList(settings.keywords)
  if (keywords.length === 0) {
    throw new Error('Add at least one keyword in Settings.')
  }

  return fetchKeywordBatch(settings, keywords, startPage, fetchMeta)
}

export function mergeCompanySizes(existingJobs, enrichedJobs) {
  const sizeByCompanyUrl = new Map()

  for (const job of enrichedJobs) {
    const companyUrl = cleanLinkedInUrl(job.companyUrl)
    if (companyUrl && job.companySize != null) {
      sizeByCompanyUrl.set(companyUrl, job.companySize)
    }
  }

  return existingJobs.map((job) => {
    const companyUrl = cleanLinkedInUrl(job.companyUrl)
    const companySize =
      (companyUrl ? sizeByCompanyUrl.get(companyUrl) : null) ?? job.companySize
    return companySize == null ? job : { ...job, companySize }
  })
}

export async function enrichJobsCompanySize(jobs, settings) {
  if (jobs.length === 0) return jobs

  let response
  try {
    const cookie = normalizeLiAtCookie(settings.liAtCookie)
    response = await fetch('/api/enrich-company-size', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs,
        ...(cookie ? { liAtCookie: cookie } : {}),
      }),
    })
  } catch {
    throw new Error(
      'Network error — could not reach the company size API. Restart the dev server and try again.'
    )
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.error ||
        data.details ||
        'Failed to load company sizes from LinkedIn.'
    )
  }

  const enriched = (data.jobs ?? []).map(normalizeJob)
  return mergeCompanySizes(jobs, enriched)
}

export function dedupeJobs(existingJobs, newJobs) {
  const seen = new Set(
    existingJobs.map((job) => resolveJobUrl(job) || job.id).filter(Boolean)
  )
  const unique = newJobs.filter((job) => {
    const key = resolveJobUrl(job) || job.id
    return key && !seen.has(key)
  })
  return [...existingJobs, ...unique]
}
