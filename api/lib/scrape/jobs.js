import {
  dedupeJobs,
  scrapeKeywordPages,
} from './html.js'
import { enrichJobsWithCompanySize } from './companySize.js'
import { LINKEDIN_ACCESS, resolveRequestLiAtCookie } from '../linkedin/http.js'
import {
  KEYWORD_COOLDOWN_EVERY,
  KEYWORD_COOLDOWN_MAX_MS,
  KEYWORD_COOLDOWN_MIN_MS,
  KEYWORD_DELAY_MAX_MS,
  KEYWORD_DELAY_MIN_MS,
  KEYWORD_FINAL_RETRY_DELAY_MS,
  KEYWORD_MAX_RETRIES,
  KEYWORD_RETRY_DELAY_MS,
} from '../../../src/constants.js'
import { normalizeSearchKeyword } from '../../../src/utils/keywords.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

async function sleepRandom(min, max) {
  await sleep(randomBetween(min, max))
}

async function delayBeforeKeyword(index) {
  if (index <= 0) return
  await sleepRandom(KEYWORD_DELAY_MIN_MS, KEYWORD_DELAY_MAX_MS)
  if (index % KEYWORD_COOLDOWN_EVERY === 0) {
    await sleepRandom(KEYWORD_COOLDOWN_MIN_MS, KEYWORD_COOLDOWN_MAX_MS)
  }
}

function shouldRetryKeyword(result) {
  return (
    result.jobs.length === 0 &&
    (result.rateLimited || result.error || result.rateLimitedPages > 0)
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

async function scrapeSingleKeyword({
  keyword,
  startOffset,
  dateFilter,
  geoId,
  workTypeFilter,
  liAtCookie,
}) {
  const normalizedKeyword = normalizeSearchKeyword(keyword)
  const options = {
    keyword: normalizedKeyword,
    startOffset,
    dateFilter,
    geoId,
    workTypeFilter,
    liAtCookie,
  }

  const result = await scrapeKeywordWithRetry(options)
  return {
    keyword: normalizedKeyword,
    result,
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
  nextStartOffset = 0,
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
    meta: {
      pagesRequested,
      paginationMode: 'until-empty',
      keywords,
      keywordResults,
      batch: Number(startPage) || 1,
      nextStartOffset,
      rateLimitedPages,
      accessMode,
      sessionSource,
      cookieRejected,
      companyEnrichment,
    },
  }
}

function mergeKeywordResult(
  allJobs,
  keywordResults,
  rateLimitedPagesRef,
  accessModeRef,
  cookieRejectedRef,
  entry
) {
  allJobs.push(...entry.result.jobs)
  rateLimitedPagesRef.value += entry.result.rateLimitedPages
  if (entry.result.accessMode) {
    accessModeRef.value = entry.result.accessMode
  }
  if (entry.result.cookieRejected) {
    cookieRejectedRef.value = true
  }
  keywordResults.push({
    keyword: entry.keyword,
    count: entry.result.jobs.length,
    rateLimited: entry.result.rateLimited,
    exhausted: Boolean(entry.result.exhausted),
  })
}

export async function scrapeJobs({
  keywords = [],
  startPage = 1,
  startOffset,
  dateFilter = '7d',
  geoId = '92000000',
  workTypeFilter = 'all',
  liAtCookie,
  sessionSource,
  fetchCompanySize = true,
}) {
  const session = liAtCookie
    ? { cookie: liAtCookie, source: sessionSource ?? 'settings' }
    : resolveRequestLiAtCookie(null)
  const resolvedCookie = session.cookie

  const keywordList = keywords
    .map((k) => normalizeSearchKeyword(k))
    .filter(Boolean)

  if (keywordList.length === 0) {
    return { status: 400, data: { error: 'At least one keyword is required' } }
  }

  const allJobs = []
  const keywordResults = []
  const rateLimitedPagesRef = { value: 0 }
  const accessModeRef = { value: LINKEDIN_ACCESS.guest }
  const sessionSourceRef = { value: session.source }
  const cookieRejectedRef = { value: false }
  let totalPagesFetched = 0
  const resumeOffset = Number(startOffset) || 0
  let nextStartOffset = resumeOffset
  let scrapeError = null

  for (let index = 0; index < keywordList.length; index += 1) {
    await delayBeforeKeyword(index)

    const entry = await scrapeSingleKeyword({
      keyword: keywordList[index],
      startOffset: index === 0 ? resumeOffset : 0,
      dateFilter,
      geoId,
      workTypeFilter,
      liAtCookie: resolvedCookie,
    })

    totalPagesFetched += entry.result.pagesFetched ?? 0
    if (index === 0) {
      nextStartOffset = entry.result.nextStartOffset ?? nextStartOffset
    }

    mergeKeywordResult(
      allJobs,
      keywordResults,
      rateLimitedPagesRef,
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
      await sleepRandom(KEYWORD_DELAY_MIN_MS, KEYWORD_DELAY_MAX_MS)
      const entry = await scrapeSingleKeyword({
        keyword,
        startOffset: 0,
        dateFilter,
        geoId,
        workTypeFilter,
        liAtCookie: resolvedCookie,
      })
      totalPagesFetched += entry.result.pagesFetched ?? 0
      allJobs.push(...entry.result.jobs)
      rateLimitedPagesRef.value += entry.result.rateLimitedPages
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
      },
    }
  }

  const mergedKeywordResults = keywordList.map((keyword) => {
    const stored = keywordResults.find((entry) => entry.keyword === keyword)
    const count = jobs.filter((job) => job.keyword === keyword).length
    return {
      keyword,
      count: count || stored?.count || 0,
      rateLimited: stored?.rateLimited ?? false,
      exhausted: stored?.exhausted ?? false,
    }
  })

  const allKeywordsExhausted =
    mergedKeywordResults.length > 0 &&
    mergedKeywordResults.every((entry) => entry.exhausted)

  const response = buildResponse({
    jobs,
    keywords: keywordList,
    startPage,
    rateLimited,
    pagesRequested: totalPagesFetched,
    rateLimitedPages: rateLimitedPagesRef.value,
    keywordResults: mergedKeywordResults,
    exhausted: allKeywordsExhausted,
    accessMode: accessModeRef.value,
    sessionSource: sessionSourceRef.value,
    cookieRejected: cookieRejectedRef.value,
    companyEnrichment,
    nextStartOffset,
  })

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
    response.warning = `LinkedIn rate-limited part of the search. Showing ${jobs.length} jobs — wait before fetching again.`
  }

  return {
    status: 200,
    data: response,
  }
}
