import {
  dedupeJobs,
  scrapeKeywordPages,
} from './linkedinHtmlScraper.js'
import { enrichJobsWithCompanySize } from './companySize.js'
import { LINKEDIN_ACCESS, resolveRequestLiAtCookie } from './linkedinHttp.js'
import {
  KEYWORD_COOLDOWN_EVERY,
  KEYWORD_COOLDOWN_MAX_MS,
  KEYWORD_COOLDOWN_MIN_MS,
  KEYWORD_DELAY_MAX_MS,
  KEYWORD_DELAY_MIN_MS,
  KEYWORD_FINAL_RETRY_DELAY_MS,
  KEYWORD_MAX_RETRIES,
  KEYWORD_RETRY_DELAY_MS,
} from '../src/constants.js'
import { normalizeSearchKeyword } from '../src/utils/keywords.js'
import {
  areAllJobsOlderThanScrapeRange,
  filterJobsByScrapeRange,
  keywordMatchesTitle,
} from '../src/utils/filterJobs.js'

const MAX_DIAGNOSTIC_EVENTS = 200
const scrapeRunRequestCounts = new Map()

function createRateLimitDiagnostics({ scrapeRunId, dateFilter } = {}) {
  const requestEvents = []
  const keywordSwitches = []
  const keywordStats = new Map()
  let requestCount = 0
  let firstBlockedRequest = null

  function updateKeywordStats(entry) {
    const keyword = entry.keyword || 'unknown'
    const existing = keywordStats.get(keyword) ?? {
      keyword,
      requests: 0,
      blockedRequests: 0,
      firstRequestNumber: entry.requestNumber,
      firstBlockedRequestNumber: null,
      pages: [],
    }

    existing.requests += 1
    existing.firstRequestNumber = Math.min(
      existing.firstRequestNumber,
      entry.requestNumber
    )
    if (entry.blocked) {
      existing.blockedRequests += 1
      existing.firstBlockedRequestNumber ??= entry.requestNumber
    }
    if (!existing.pages.includes(entry.pageNumber)) {
      existing.pages.push(entry.pageNumber)
    }

    keywordStats.set(keyword, existing)
  }

  return {
    getRequestCount() {
      return requestCount
    },
    recordKeywordSwitch(event) {
      const entry = {
        scrapeRunId,
        dateFilter,
        ...event,
        atRequestNumber: requestCount,
        time: new Date().toISOString(),
      }
      keywordSwitches.push(entry)
      console.log('[linkedin-keyword-switch]', entry)
    },
    recordRequest(event) {
      requestCount += 1
      const runRequestNumber =
        scrapeRunId ?
          (scrapeRunRequestCounts.get(scrapeRunId) ?? 0) + 1
        : requestCount
      if (scrapeRunId) {
        scrapeRunRequestCounts.set(scrapeRunId, runRequestNumber)
      }

      const context = event.requestContext ?? {}
      const entry = {
        scrapeRunId,
        dateFilter,
        requestNumber: event.globalRequestNumber ?? requestCount,
        runRequestNumber,
        keyword: context.keyword,
        pageNumber: context.pageNumber,
        offset: context.offset,
        transition: context.transition,
        retryType: context.retryType,
        retryAttempt: context.retryAttempt,
        recoveryAttempt: context.recoveryAttempt,
        status: event.status,
        blocked: Boolean(event.blocked),
        accessMode: event.accessMode,
        sessionSource: event.sessionSource,
        cookieRejected: Boolean(event.cookieRejected),
        error: event.error,
        url: event.url,
        time: new Date().toISOString(),
      }

      if (entry.blocked && !firstBlockedRequest) {
        firstBlockedRequest = entry
      }

      updateKeywordStats(entry)
      requestEvents.push(entry)
      if (requestEvents.length > MAX_DIAGNOSTIC_EVENTS) {
        requestEvents.shift()
      }

      console.log('[linkedin-request]', entry)
    },
    summary() {
      return {
        scrapeRunId,
        dateFilter,
        requestCount,
        firstBlockedRequest,
        keywordSwitches,
        keywordStats: Array.from(keywordStats.values()),
        requestEvents,
        maxStoredRequestEvents: MAX_DIAGNOSTIC_EVENTS,
      }
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function shouldRetryKeyword(result) {
  return (
    result.jobs.length === 0 &&
    !result.rateLimited &&
    result.rateLimitedPages === 0 &&
    Boolean(result.error)
  )
}

async function scrapeKeywordWithRetry(options) {
  let result = await scrapeKeywordPages(options)
  let attempt = 0

  while (shouldRetryKeyword(result) && attempt < KEYWORD_MAX_RETRIES) {
    attempt += 1
    await sleep(KEYWORD_RETRY_DELAY_MS * attempt)
    result = await scrapeKeywordPages(options)
  }

  return result
}

function applyScrapeDateFilter(result, dateFilter) {
  if (!dateFilter || dateFilter === 'all') return result

  const jobs = filterJobsByScrapeRange(result.jobs, dateFilter)

  if (
    result.jobs.length > 0 &&
    jobs.length === 0 &&
    areAllJobsOlderThanScrapeRange(result.jobs, dateFilter)
  ) {
    return {
      ...result,
      jobs,
      exhausted: true,
      hasMore: false,
    }
  }

  return { ...result, jobs }
}

async function scrapeSingleKeyword({
  keyword,
  startOffset,
  maxPages,
  dateFilter,
  geoId,
  workTypeFilter,
  liAtCookie,
  diagnostics,
  pageStartIndex,
}) {
  const normalizedKeyword = normalizeSearchKeyword(keyword)
  const options = {
    keyword: normalizedKeyword,
    startOffset,
    maxPages,
    dateFilter,
    geoId,
    workTypeFilter,
    liAtCookie,
    diagnostics,
    pageStartIndex,
  }

  const result = applyScrapeDateFilter(
    await scrapeKeywordWithRetry(options),
    dateFilter
  )
  const titleMatchedJobs = result.jobs.filter((job) =>
    keywordMatchesTitle(job.title, normalizedKeyword)
  )
  const titleFilteredCount = result.jobs.length - titleMatchedJobs.length

  return {
    keyword: normalizedKeyword,
    result: {
      ...result,
      jobs: titleMatchedJobs,
      titleFilteredCount,
    },
  }
}

function buildResponse({
  jobs,
  keywords,
  startPage,
  rateLimited,
  pagesRequested,
  rateLimitedPages = 0,
  keywordResults = [],
  exhausted = false,
  accessMode = LINKEDIN_ACCESS.guest,
  sessionSource = 'none',
  cookieRejected = false,
  companyEnrichment = null,
  rateLimitDiagnostics = null,
  scrapeRunId = null,
  dateFilter = 'all',
}) {
  const deduped = dedupeJobs(jobs)
  const isRateLimited = rateLimited && deduped.length === 0

  return {
    success: !isRateLimited,
    total: deduped.length,
    jobs: deduped,
    rateLimited: isRateLimited,
    error: isRateLimited
      ? 'LinkedIn is rate limiting requests. Wait 15–30 minutes before trying again.'
      : undefined,
    hasMore: deduped.length > 0 && !exhausted,
    nextStartPage: (Number(startPage) || 1) + 1,
    nextStartOffset: keywordResults[0]?.nextOffset ?? null,
    meta: {
      pagesRequested,
      autoPaginate: true,
      keywords,
      scrapeRunId,
      dateFilter,
      keywordResults,
      batch: Number(startPage) || 1,
      rateLimitedPages,
      accessMode,
      sessionSource,
      cookieRejected,
      companyEnrichment,
      rateLimitDiagnostics,
    },
  }
}

function mergeKeywordResult(
  allJobs,
  keywordResults,
  rateLimitedPagesRef,
  pagesRequestedRef,
  accessModeRef,
  cookieRejectedRef,
  entry
) {
  allJobs.push(...entry.result.jobs)
  rateLimitedPagesRef.value += entry.result.rateLimitedPages
  pagesRequestedRef.value += entry.result.pagesFetched ?? 0
  if (entry.result.accessMode) {
    accessModeRef.value = entry.result.accessMode
  }
  if (entry.result.cookieRejected) {
    cookieRejectedRef.value = true
  }
  keywordResults.push({
    keyword: entry.keyword,
    count: entry.result.jobs.length,
    pagesFetched: entry.result.pagesFetched ?? 0,
    rateLimited: entry.result.rateLimited,
    exhausted: Boolean(entry.result.exhausted),
    stoppedEarly: Boolean(entry.result.stoppedEarly),
    nextOffset: entry.result.nextOffset ?? 0,
    titleFilteredCount: entry.result.titleFilteredCount ?? 0,
  })
}

async function delayBeforeKeyword(index) {
  if (index === 0) return

  await sleep(randomBetween(KEYWORD_DELAY_MIN_MS, KEYWORD_DELAY_MAX_MS))

  if (index % KEYWORD_COOLDOWN_EVERY === 0) {
    await sleep(randomBetween(KEYWORD_COOLDOWN_MIN_MS, KEYWORD_COOLDOWN_MAX_MS))
  }
}

export async function scrapeJobs({
  keywords = [],
  startPage = 1,
  startOffset = 0,
  maxPages,
  dateFilter = '7d',
  geoId = '92000000',
  workTypeFilter = 'all',
  liAtCookie,
  sessionSource,
  fetchCompanySize = true,
  scrapeRunId = null,
  pageIndex,
  previousKeyword,
  keywordIndex,
  keywordCount,
}) {
  const session = liAtCookie
    ? { cookie: liAtCookie, source: sessionSource ?? 'settings' }
    : resolveRequestLiAtCookie(null)
  const resolvedCookie = session.cookie

  const keywordList = keywords
    .map((k) => normalizeSearchKeyword(k))
    .filter(Boolean)
  const requestedPageIndex = Math.max(1, Number(pageIndex) || 1)
  const requestedKeywordIndex = Math.max(1, Number(keywordIndex) || 1)
  const requestedKeywordCount =
    Math.max(1, Number(keywordCount) || keywordList.length) || keywordList.length
  const isProgressivePageRequest = Number(maxPages) === 1 && keywordList.length === 1

  if (keywordList.length === 0) {
    return { status: 400, data: { error: 'At least one keyword is required' } }
  }

  const allJobs = []
  const keywordResults = []
  const rateLimitedPagesRef = { value: 0 }
  const pagesRequestedRef = { value: 0 }
  const accessModeRef = { value: LINKEDIN_ACCESS.guest }
  const sessionSourceRef = { value: session.source }
  const cookieRejectedRef = { value: false }
  const diagnostics = createRateLimitDiagnostics({ scrapeRunId, dateFilter })
  let scrapeError = null

  const sharedOptions = {
    startOffset,
    maxPages,
    dateFilter,
    geoId,
    workTypeFilter,
    liAtCookie: resolvedCookie,
    diagnostics,
    pageStartIndex: requestedPageIndex,
  }

  const entries = []
  for (let index = 0; index < keywordList.length; index += 1) {
    if (!isProgressivePageRequest || requestedPageIndex === 1) {
      diagnostics.recordKeywordSwitch({
        fromKeyword:
          isProgressivePageRequest ?
            normalizeSearchKeyword(previousKeyword) || null
          : index === 0 ? null
          : keywordList[index - 1],
        toKeyword: keywordList[index],
        keywordIndex:
          isProgressivePageRequest ? requestedKeywordIndex : index + 1,
        keywordCount: requestedKeywordCount,
        transition:
          (isProgressivePageRequest ?
            requestedKeywordIndex === 1
          : index === 0) ?
            'first-keyword'
          : 'keyword-switch',
      })
    }
    await delayBeforeKeyword(index)
    entries.push(
      await scrapeSingleKeyword({
        keyword: keywordList[index],
        ...sharedOptions,
      })
    )
  }

  for (const entry of entries) {
    mergeKeywordResult(
      allJobs,
      keywordResults,
      rateLimitedPagesRef,
      pagesRequestedRef,
      accessModeRef,
      cookieRejectedRef,
      entry
    )

    if (entry.result.error && entry.result.jobs.length === 0 && allJobs.length === 0) {
      scrapeError = entry.result.error
    }
  }

  const failedKeywords = keywordResults
    .filter((entry) => entry.count === 0)
    .map((entry) => entry.keyword)

  if (failedKeywords.length > 0 && failedKeywords.length < keywordList.length) {
    await sleep(KEYWORD_FINAL_RETRY_DELAY_MS)

    for (const keyword of failedKeywords) {
      diagnostics.recordKeywordSwitch({
        fromKeyword: null,
        toKeyword: keyword,
        keywordIndex: keywordList.indexOf(keyword) + 1,
        keywordCount: keywordList.length,
        transition: 'final-keyword-retry',
      })
      const entry = await scrapeSingleKeyword({
        keyword,
        ...sharedOptions,
      })
      allJobs.push(...entry.result.jobs)
      rateLimitedPagesRef.value += entry.result.rateLimitedPages
      pagesRequestedRef.value += entry.result.pagesFetched ?? 0
    }
  }

  let jobs = dedupeJobs(allJobs)
  const rateLimited = rateLimitedPagesRef.value > 0
  let companyEnrichment = null

  if (fetchCompanySize && jobs.length > 0) {
    const sizeResult = await enrichJobsWithCompanySize(jobs, resolvedCookie)
    jobs = sizeResult.jobs
    companyEnrichment = sizeResult.enrichment
  }

  const hasFetchedSearchPages = keywordResults.some(
    (entry) => (entry.pagesFetched ?? 0) > 0
  )
  const canContinueAfterFiltering = keywordResults.some(
    (entry) =>
      (entry.pagesFetched ?? 0) > 0 &&
      !entry.exhausted &&
      !entry.stoppedEarly &&
      (entry.nextOffset ?? 0) > startOffset
  )

  if (jobs.length === 0 && hasFetchedSearchPages && canContinueAfterFiltering) {
    const response = buildResponse({
      jobs,
      keywords: keywordList,
      startPage,
      rateLimited,
      pagesRequested: pagesRequestedRef.value,
      rateLimitedPages: rateLimitedPagesRef.value,
      keywordResults,
      exhausted: false,
      accessMode: accessModeRef.value,
      sessionSource: sessionSourceRef.value,
      cookieRejected: cookieRejectedRef.value,
      companyEnrichment,
      rateLimitDiagnostics: diagnostics.summary(),
      scrapeRunId,
      dateFilter,
    })
    response.hasMore = true
    return { status: 200, data: response }
  }

  if (jobs.length === 0) {
    const isAuthError = String(scrapeError ?? '')
      .toLowerCase()
      .includes('authwall')

    return {
      status: 502,
      data: {
        error: rateLimited
          ? 'LinkedIn is rate limiting requests. Wait 15–30 minutes, then try again.'
          : isAuthError
            ? 'LinkedIn authentication required'
            : 'Scrape failed',
        details: isAuthError
          ? 'LinkedIn blocked the request. Wait and retry, or check your network.'
          : scrapeError ??
            'No jobs found on the search page. Job search always uses the public guest API (cookie is not sent for search).',
        rateLimited,
        nextStartOffset: keywordResults[0]?.nextOffset ?? startOffset,
        meta: {
          scrapeRunId,
          dateFilter,
          keywordResults,
          nextStartOffset: keywordResults[0]?.nextOffset ?? startOffset,
          rateLimitDiagnostics: diagnostics.summary(),
        },
      },
    }
  }

  const mergedKeywordResults = keywordList.map((keyword) => {
    const stored = keywordResults.find((entry) => entry.keyword === keyword)
    const count = jobs.filter((job) => job.keyword === keyword).length
    return {
      keyword,
      count: count || stored?.count || 0,
      pagesFetched: stored?.pagesFetched ?? 0,
      rateLimited: stored?.rateLimited ?? false,
      exhausted: stored?.exhausted ?? false,
      stoppedEarly: stored?.stoppedEarly ?? false,
      nextOffset: stored?.nextOffset ?? 0,
    }
  })

  const allKeywordsExhausted =
    mergedKeywordResults.length > 0 &&
    mergedKeywordResults.every((entry) => entry.exhausted)

  const anyHasMore = mergedKeywordResults.some(
    (entry) => !entry.exhausted && !entry.stoppedEarly
  )

  const response = buildResponse({
    jobs,
    keywords: keywordList,
    startPage,
    rateLimited,
    pagesRequested: pagesRequestedRef.value,
    rateLimitedPages: rateLimitedPagesRef.value,
    keywordResults: mergedKeywordResults,
    exhausted: allKeywordsExhausted && !anyHasMore,
    accessMode: accessModeRef.value,
    sessionSource: sessionSourceRef.value,
    cookieRejected: cookieRejectedRef.value,
    companyEnrichment,
    rateLimitDiagnostics: diagnostics.summary(),
    scrapeRunId,
    dateFilter,
  })

  response.hasMore = anyHasMore
  if (keywordList.length === 1 && mergedKeywordResults[0]) {
    response.nextStartOffset = mergedKeywordResults[0].nextOffset ?? null
  }

  const stillFailed = response.meta.keywordResults
    .filter((entry) => entry.count === 0)
    .map((entry) => entry.keyword)

  if (cookieRejectedRef.value && jobs.length > 0) {
    response.warning =
      'LinkedIn rejected the li_at cookie. Used guest search instead. Check the cookie value in Settings or leave it blank.'
  } else if (
    companyEnrichment?.hasCookie &&
    companyEnrichment.loaded > 0 &&
    companyEnrichment.viaSession === 0 &&
    jobs.length > 0
  ) {
    response.warning =
      'Company sizes loaded via public pages — your li_at cookie did not add extra size data. Job search always uses guest mode.'
  } else if (stillFailed.length > 0 && jobs.length > 0) {
    response.warning = `Could not load jobs for: ${stillFailed.join(', ')}. Add your li_at cookie in Settings and try Fetch Jobs again.`
  } else if (rateLimited && jobs.length > 0) {
    const partialKeywords = mergedKeywordResults
      .filter((entry) => entry.stoppedEarly)
      .map((entry) => entry.keyword)
    response.warning =
      partialKeywords.length > 0
        ? `LinkedIn rate-limited after partial results for: ${partialKeywords.join(', ')}. Showing ${jobs.length} jobs — wait 20–30 minutes and fetch again.`
        : `LinkedIn rate-limited part of the search. Showing ${jobs.length} jobs — wait before fetching again.`
  }

  return {
    status: 200,
    data: response,
  }
}
