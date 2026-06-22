import * as cheerio from 'cheerio'
import {
  LINKEDIN_BATCH_SIZE,
  LINKEDIN_WORK_TYPE,
  PAGE_DELAY_MAX_MS,
  PAGE_DELAY_MIN_MS,
  SAFETY_MAX_PAGES,
} from '../src/constants.js'
import {
  extractCompanyId,
  parseLocationParts,
  toRemoteBoolean,
} from '../src/utils/jobSchema.js'
import { fetchLinkedInPage, isBlockedLinkedInResponse } from './linkedinHttp.js'

const EXCLUDED_LOCATIONS = [
  'india',
  'bangalore',
  'bengaluru',
  'mumbai',
  'delhi',
  'hyderabad',
  'chennai',
  'pune',
  'kolkata',
  'ahmedabad',
  'noida',
  'gurugram',
  'bangladesh',
  'dhaka',
  'pakistan',
  'karachi',
  'lahore',
  'islamabad',
  'sri lanka',
  'colombo',
  'nepal',
  'kathmandu',
  'egypt',
  'cairo',
  'nigeria',
  'lagos',
  'philippines',
  'manila',
  'indonesia',
  'jakarta',
]

const DATE_FILTER_MAP = {
  '1d': 'r86400',
  '3d': 'r259200',
  '7d': 'r604800',
  '30d': 'r2592000',
  all: '',
}

export const JOBS_PER_PAGE = LINKEDIN_BATCH_SIZE
const REQUEST_TIMEOUT_MS = 20000
const MIN_HTML_LENGTH = 1000
const MAX_CONSECUTIVE_EMPTY_PAGES = 5
const GUEST_JOBS_API_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function cleanText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
}

function cleanCompany(value) {
  return cleanText(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\[\s*\]?/g, '')
    .trim()
}

export function cleanLinkedInUrl(url) {
  return String(url ?? '')
    .replace(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com/i, 'https://www.linkedin.com')
    .split('?')[0]
    .replace(/\/+$/, '')
    .trim()
}

function isExcludedLocation(location) {
  const normalized = String(location ?? '').toLowerCase()
  return EXCLUDED_LOCATIONS.some((keyword) => normalized.includes(keyword))
}

function isEmptyResponseHtml(html) {
  const text = String(html ?? '')
  return (
    text.length < MIN_HTML_LENGTH ||
    (!text.includes('base-search-card') &&
      !text.includes('job-result-card') &&
      !text.includes('jobs-search__results-list'))
  )
}

function inferWorkType(location = '', workplace = '') {
  const text = `${location} ${workplace}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'hybrid'
  if (/\bremote\b/.test(text)) return 'remote'
  if (/\bon[- ]?site\b/.test(text)) return 'onsite'
  return 'unknown'
}

export function buildSearchUrl({
  keyword,
  geoId,
  dateFilter,
  start,
  workTypeFilter,
}) {
  const url = new URL(GUEST_JOBS_API_URL)
  url.searchParams.set('keywords', keyword)
  url.searchParams.set('geoId', String(geoId || '92000000'))
  const dateParam = DATE_FILTER_MAP[dateFilter] ?? DATE_FILTER_MAP['7d']
  if (dateParam) {
    url.searchParams.set('f_TPR', dateParam)
  }
  const workType = LINKEDIN_WORK_TYPE[workTypeFilter]
  if (workType) {
    url.searchParams.set('f_WT', workType)
  }
  url.searchParams.set('start', String(start ?? 0))
  // Max per HTTP call — scraper loops start=0,25,50… until LinkedIn returns no jobs
  url.searchParams.set('count', String(LINKEDIN_BATCH_SIZE))
  return url.href
}

async function fetchSearchPage(url, { diagnostics, requestContext } = {}) {
  // jobs-guest search API is for anonymous access — li_at often breaks it
  const page = await fetchLinkedInPage(url, {
    referer: 'https://www.linkedin.com/jobs/search/',
    timeoutMs: REQUEST_TIMEOUT_MS,
    forceGuest: true,
    diagnostics,
    requestContext,
  })

  if (page.error) {
    return {
      html: '',
      status: 0,
      cookieRejected: false,
      accessMode: page.accessMode,
    }
  }

  return {
    html: page.html,
    status: page.status,
    cookieRejected: page.cookieRejected,
    accessMode: page.accessMode,
  }
}

function isFailedPage(html, status) {
  return (
    isBlockedLinkedInResponse(html, status) || isEmptyResponseHtml(html)
  )
}

async function fetchSearchPageOnce(
  url,
  { diagnostics, requestContext } = {}
) {
  return fetchSearchPage(url, {
    diagnostics,
    requestContext: {
      ...requestContext,
      retryAttempt: 0,
      retryType: 'initial',
    },
  })
}

function pickText($scope, selectors) {
  for (const selector of selectors) {
    const text = cleanText($scope.find(selector).first().text())
    if (text) return text
  }
  return ''
}

function pickAttr($scope, selectors, attr) {
  for (const selector of selectors) {
    const value = $scope.find(selector).first().attr(attr)
    if (value) return value
  }
  return ''
}

export function parseJobsFromHtml(html, keyword) {
  const $ = cheerio.load(html)
  const cardSelectors = [
    '.jobs-search__results-list > li',
    '.jobs-search__results-list li',
    '.two-pane-serp-page__results-list li',
    '.base-search-card',
    'li .base-search-card',
    '.base-card',
  ]

  let cards = $([])
  for (const selector of cardSelectors) {
    const found = $(selector)
    if (found.length > 0) {
      cards = found
      break
    }
  }

  const jobs = []

  cards.each((_index, element) => {
    const $card = $(element)

    const title = pickText($card, [
      '.base-search-card__title',
      '.job-result-card__title',
      '.result-card__title',
    ])
    const company = cleanCompany(
      pickText($card, [
        'h4.base-search-card__subtitle',
        '.base-search-card__subtitle',
        '.result-card__subtitle',
        '.job-result-card__subtitle',
      ])
    )
    const companyUrl = cleanLinkedInUrl(
      pickAttr($card, ['h4.base-search-card__subtitle a', '.base-search-card__subtitle a'], 'href')
    )
    const location = pickText($card, [
      '.job-search-card__location',
      '.job-result-card__location',
      '.result-card__location',
    ])
    const workplace = pickText($card, [
      '.job-search-card__benefit',
      '.job-search-card__listitem-benefit',
      '.job-result-card__benefit',
    ])
    const link = cleanLinkedInUrl(
      pickAttr(
        $card,
        ['.base-card__full-link', 'a.result-card__full-card-link', 'a.base-card__full-link'],
        'href'
      )
    )
    const postedAtIso = pickAttr($card, [
      'time.job-search-card__listdate',
      'time.job-search-card__listdate--new',
      '.job-search-card__listdate',
      '.job-result-card__listdate',
    ], 'datetime')
    const postedDate =
      pickText($card, [
        'time.job-search-card__listdate',
        'time.job-search-card__listdate--new',
        '.job-search-card__listdate',
        '.job-result-card__listdate',
      ]) || postedAtIso
    const workType = inferWorkType(location, workplace)
    const { city, country } = parseLocationParts(location)

    if (!title || !link || isExcludedLocation(location)) return

    jobs.push({
      title,
      company,
      companyUrl,
      companyId: extractCompanyId(companyUrl),
      location,
      city,
      country,
      workplace,
      workType,
      remote: toRemoteBoolean(workType, location, workplace),
      postedDate,
      postedAtIso,
      link,
      keyword: cleanText(keyword),
      scrapedAt: new Date().toISOString(),
    })
  })

  return jobs
}

export async function scrapeKeywordPages({
  keyword,
  startOffset = 0,
  maxPages,
  dateFilter,
  geoId,
  workTypeFilter,
  liAtCookie,
  diagnostics,
  pageStartIndex = 1,
}) {
  const jobs = []
  let rateLimitedPages = 0
  let lastError = null
  let pagesFetched = 0
  let hitEndOfResults = false
  let accessMode
  let cookieRejected = false
  let offset = Math.max(0, Number(startOffset) || 0)
  let stoppedEarly = false
  let consecutiveEmptyPages = 0
  const pageLimit =
    maxPages != null ? Math.max(1, Number(maxPages) || 1) : SAFETY_MAX_PAGES

  for (let page = 0; page < pageLimit; page += 1) {
    const url = buildSearchUrl({
      keyword,
      geoId,
      dateFilter,
      start: offset,
      workTypeFilter,
    })

    let html
    let status

    try {
      const pageNumber = pageStartIndex + page
      const pageResult = await fetchSearchPageOnce(url, {
        diagnostics,
        requestContext: {
          keyword,
          pageNumber,
          offset,
          transition: pageNumber === 1 ? 'keyword-start' : 'page-progress',
        },
      })
      html = pageResult.html
      status = pageResult.status
      accessMode = pageResult.accessMode ?? accessMode
      cookieRejected = cookieRejected || Boolean(pageResult.cookieRejected)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      break
    }

    if (isFailedPage(html, status)) {
      rateLimitedPages += 1
      if (jobs.length === 0) {
        lastError = 'LinkedIn is rate limiting requests'
        break
      }
      stoppedEarly = true
      break
    }

    const pageJobs = parseJobsFromHtml(html, keyword)

    if (pageJobs.length === 0) {
      consecutiveEmptyPages += 1
      offset += LINKEDIN_BATCH_SIZE

      if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
        hitEndOfResults = true
        console.log(
          `[scraper] ${keyword}: stopped after ${MAX_CONSECUTIVE_EMPTY_PAGES} consecutive empty pages at offset ${offset - LINKEDIN_BATCH_SIZE}`
        )
        break
      }

      if (page + 1 < pageLimit) {
        await sleep(randomBetween(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS))
      }
      continue
    }

    consecutiveEmptyPages = 0
    pagesFetched += 1
    jobs.push(...pageJobs)
    offset += LINKEDIN_BATCH_SIZE

    if (page + 1 < pageLimit) {
      await sleep(randomBetween(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS))
    }
  }

  const exhausted =
    !stoppedEarly && rateLimitedPages === 0 && pagesFetched > 0 && hitEndOfResults
  const hasMore = !exhausted && !stoppedEarly && !hitEndOfResults

  return {
    jobs,
    rateLimited: rateLimitedPages > 0 || stoppedEarly,
    rateLimitedPages,
    pagesFetched,
    exhausted,
    hasMore,
    nextOffset: offset,
    stoppedEarly,
    error: jobs.length === 0 ? lastError : null,
    accessMode,
    cookieRejected,
  }
}

export function dedupeJobs(jobs) {
  const deduped = []
  const seen = new Set()

  for (const job of jobs) {
    if (!job.link || seen.has(job.link)) continue
    seen.add(job.link)
    deduped.push(job)
  }

  return deduped
}
