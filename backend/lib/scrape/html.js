import * as cheerio from 'cheerio'
import {
  LINKEDIN_DATE_FILTERS,
  LINKEDIN_WORK_TYPE,
  PAGE_DELAY_MAX_MS,
  PAGE_DELAY_MIN_MS,
  SAFETY_MAX_PAGES,
} from '../../../src/constants.js'
import {
  extractCompanyId,
  parseLocationParts,
  toRemoteBoolean,
} from '../../../src/utils/jobSchema.js'
import { fetchLinkedInPage, isBlockedLinkedInResponse } from '../linkedin/http.js'

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

const DATE_FILTER_MAP = LINKEDIN_DATE_FILTERS

export const JOBS_PER_PAGE = 10
const REQUEST_TIMEOUT_MS = 20000
const MIN_HTML_LENGTH = 1000
const FETCH_RETRIES = 2
const GUEST_JOBS_API_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

async function sleepRandom(min, max) {
  await sleep(randomBetween(min, max))
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
  return url.href
}

async function fetchSearchPage(url) {
  // jobs-guest search API is for anonymous access — li_at often breaks it
  const page = await fetchLinkedInPage(url, {
    referer: 'https://www.linkedin.com/jobs/search/',
    timeoutMs: REQUEST_TIMEOUT_MS,
    forceGuest: true,
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

async function fetchSearchPageWithRetry(url, liAtCookie) {
  let lastResult = {
    html: '',
    status: 0,
    cookieRejected: false,
    accessMode: undefined,
  }

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    lastResult = await fetchSearchPage(url)

    if (
      !isBlockedLinkedInResponse(lastResult.html, lastResult.status) &&
      !isEmptyResponseHtml(lastResult.html)
    ) {
      return lastResult
    }

    if (attempt < FETCH_RETRIES) {
      await sleep(800 * (attempt + 1))
    }
  }

  return lastResult
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
  dateFilter,
  geoId,
  workTypeFilter,
}) {
  let start = Number(startOffset) || 0
  const jobs = []
  let rateLimitedPages = 0
  let lastError = null
  let pagesFetched = 0
  let hitEndOfResults = false
  let accessMode
  let cookieRejected = false
  let duplicatePage = false

  while (pagesFetched < SAFETY_MAX_PAGES) {
    const url = buildSearchUrl({
      keyword,
      geoId,
      dateFilter,
      start,
      workTypeFilter,
    })

    let html
    let status

    try {
      const pageResult = await fetchSearchPageWithRetry(url)
      html = pageResult.html
      status = pageResult.status
      accessMode = pageResult.accessMode ?? accessMode
      cookieRejected = cookieRejected || Boolean(pageResult.cookieRejected)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      break
    }

    if (isBlockedLinkedInResponse(html, status)) {
      rateLimitedPages += 1
      if (jobs.length === 0) {
        lastError = 'LinkedIn is rate limiting requests'
      }
      break
    }

    if (isEmptyResponseHtml(html)) {
      if (pagesFetched > 0) {
        hitEndOfResults = true
        break
      }
      rateLimitedPages += 1
      lastError = 'LinkedIn returned an empty search page'
      break
    }

    const pageJobs = parseJobsFromHtml(html, keyword)

    if (pageJobs.length === 0) {
      hitEndOfResults = true
      break
    }

    const newJobs = pageJobs.filter(
      (job) => !jobs.some((existing) => existing.link === job.link)
    )
    if (pagesFetched > 0 && newJobs.length === 0) {
      duplicatePage = true
      hitEndOfResults = true
      break
    }

    pagesFetched += 1
    jobs.push(...newJobs)
    start += JOBS_PER_PAGE

    await sleepRandom(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS)
  }

  const exhausted =
    hitEndOfResults ||
    duplicatePage ||
    (pagesFetched >= SAFETY_MAX_PAGES && pagesFetched > 0)

  return {
    jobs,
    rateLimited: rateLimitedPages > 0,
    rateLimitedPages,
    pagesFetched,
    nextStartOffset: start,
    exhausted,
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
