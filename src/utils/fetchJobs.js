import {
  EMPTY_MATCH_PAGE_LIMIT,
  KEYWORD_COOLDOWN_EVERY,
  KEYWORD_COOLDOWN_MAX_MS,
  KEYWORD_COOLDOWN_MIN_MS,
  KEYWORD_DELAY_MAX_MS,
  KEYWORD_DELAY_MIN_MS,
  LINKEDIN_BATCH_SIZE,
  LINKEDIN_RATE_LIMIT_ERROR,
  PAGE_DELAY_MAX_MS,
  PAGE_DELAY_MIN_MS,
  POST_BLOCK_PAGE_DELAY_MAX_MS,
  POST_BLOCK_PAGE_DELAY_MIN_MS,
  RATE_LIMIT_COOLDOWN_MAX_MS,
  RATE_LIMIT_COOLDOWN_MIN_MS,
  RATE_LIMITED_KEYWORD_RETRY_MAX_MS,
  RATE_LIMITED_KEYWORD_RETRY_MIN_MS,
  SAFETY_MAX_PAGES,
  SCRAPE_RUN_COOLDOWN_EVERY,
  SCRAPE_RUN_COOLDOWN_MAX_MS,
  SCRAPE_RUN_COOLDOWN_MIN_MS,
  resolveGeoId,
} from '../constants'
import { cleanLinkedInUrl, resolveJobUrl } from './cleanJobFields'
import { normalizeLiAtCookie } from './linkedinCookie'
import { formatScrapeError } from './scrapeErrors'
import {
  parseKeywordList,
  canonicalSearchKeyword,
} from './keywords'
import { filterJobsByScrapeRange, keywordMatchesTitle } from './filterJobs'
import {
  mergeJobWithFetchedDetails,
  normalizeJob,
} from './mergeJobRecord'

export { parseKeywordList, normalizeJob, mergeJobWithFetchedDetails }

let activeScrapeRunId = null
let scrapeRunSequence = 0
let releaseLockOnPageHide = null
const SCRAPE_LOCK_KEY = 'jobsnap-active-scrape-run'
const SCRAPE_LOCK_STALE_MS = 5 * 60 * 1000

function createScrapeRunId() {
  scrapeRunSequence += 1
  return `scrape-${Date.now()}-${scrapeRunSequence}`
}

function readStoredScrapeLock() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SCRAPE_LOCK_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStoredScrapeLock(scrapeRunId) {
  if (typeof window === 'undefined') return
  const now = Date.now()
  window.localStorage.setItem(
    SCRAPE_LOCK_KEY,
    JSON.stringify({ scrapeRunId, startedAt: now, updatedAt: now })
  )
}

function refreshStoredScrapeLock(scrapeRunId) {
  if (typeof window === 'undefined') return
  const stored = readStoredScrapeLock()
  if (stored?.scrapeRunId !== scrapeRunId) return

  window.localStorage.setItem(
    SCRAPE_LOCK_KEY,
    JSON.stringify({ ...stored, updatedAt: Date.now() })
  )
}

function clearStoredScrapeLock(scrapeRunId) {
  if (typeof window === 'undefined') return
  const stored = readStoredScrapeLock()
  if (!stored || stored.scrapeRunId === scrapeRunId) {
    window.localStorage.removeItem(SCRAPE_LOCK_KEY)
  }
}

function acquireScrapeRunLock(scrapeRunId) {
  if (activeScrapeRunId) {
    throw new Error(
      `A scrape is already running (${activeScrapeRunId}). Wait for it to finish before starting another one.`
    )
  }

  const stored = readStoredScrapeLock()
  const storedIsFresh =
    stored?.scrapeRunId &&
    Date.now() - Number(stored.updatedAt ?? stored.startedAt ?? 0) <
      SCRAPE_LOCK_STALE_MS

  if (storedIsFresh) {
    throw new Error(
      `A scrape is already running (${stored.scrapeRunId}). Wait for it to finish before starting another one.`
    )
  }

  activeScrapeRunId = scrapeRunId
  writeStoredScrapeLock(scrapeRunId)
  if (typeof window !== 'undefined') {
    releaseLockOnPageHide = () => releaseScrapeRunLock(scrapeRunId)
    window.addEventListener('pagehide', releaseLockOnPageHide, { once: true })
  }
}

function releaseScrapeRunLock(scrapeRunId) {
  if (activeScrapeRunId === scrapeRunId) {
    activeScrapeRunId = null
  }
  if (typeof window !== 'undefined' && releaseLockOnPageHide) {
    window.removeEventListener('pagehide', releaseLockOnPageHide)
    releaseLockOnPageHide = null
  }
  clearStoredScrapeLock(scrapeRunId)
}

export function clearActiveScrapeRunLock() {
  const stored = readStoredScrapeLock()
  activeScrapeRunId = null
  if (typeof window !== 'undefined' && releaseLockOnPageHide) {
    window.removeEventListener('pagehide', releaseLockOnPageHide)
    releaseLockOnPageHide = null
  }
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SCRAPE_LOCK_KEY)
  }
  return stored?.scrapeRunId ?? null
}

function createAbortError() {
  return new DOMException('Scrape stopped by user', 'AbortError')
}

function isAbortError(err) {
  return err?.name === 'AbortError'
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

function sleep(ms, signal) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(createAbortError())
      },
      { once: true }
    )
  })
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

async function sleepWithCountdown(totalMs, signal, onTick) {
  const startedAt = Date.now()
  let remainingMs = totalMs

  while (remainingMs > 0) {
    onTick?.(Math.ceil(remainingMs / 1000))
    await sleep(Math.min(1000, remainingMs), signal)
    remainingMs = totalMs - (Date.now() - startedAt)
  }
}

async function delayBeforeKeyword(
  index,
  {
    afterRateLimit = false,
    keyword,
    keywordIndex,
    keywordCount,
    onProgress,
    signal,
  } = {}
) {
  if (index === 0) return

  const minMs = afterRateLimit ? RATE_LIMIT_COOLDOWN_MIN_MS : KEYWORD_DELAY_MIN_MS
  const maxMs = afterRateLimit ? RATE_LIMIT_COOLDOWN_MAX_MS : KEYWORD_DELAY_MAX_MS

  await sleepWithCountdown(
    randomBetween(minMs, maxMs),
    signal,
    (remainingSeconds) => {
      onProgress?.({
        keyword,
        keywordIndex,
        keywordCount,
        currentKeyword: keyword,
        phase: 'keyword-delay',
        afterRateLimit,
        remainingSeconds,
      })
    }
  )

  if (index % KEYWORD_COOLDOWN_EVERY === 0) {
    await sleepWithCountdown(
      randomBetween(KEYWORD_COOLDOWN_MIN_MS, KEYWORD_COOLDOWN_MAX_MS),
      signal,
      (remainingSeconds) => {
        onProgress?.({
          keyword,
          keywordIndex,
          keywordCount,
          currentKeyword: keyword,
          phase: 'keyword-cooldown',
          remainingSeconds,
        })
      }
    )
  }
}

async function delayBeforeNextKeywordPage({
  keyword,
  previousKeyword,
  keywordIndex,
  keywordCount,
  pageIndex,
  nextOffset,
  accumulated,
  scrapeRunId,
  dateFilter,
  afterRateLimit,
  signal,
  onProgress,
}) {
  refreshStoredScrapeLock(scrapeRunId)
  const delayMs =
    afterRateLimit ?
      randomBetween(POST_BLOCK_PAGE_DELAY_MIN_MS, POST_BLOCK_PAGE_DELAY_MAX_MS)
    : randomBetween(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS)
  await sleepWithCountdown(delayMs, signal, (remainingSeconds) => {
    refreshStoredScrapeLock(scrapeRunId)
    onProgress?.({
      keyword,
      keywordIndex,
      keywordCount,
      currentKeyword: keyword,
      pageIndex,
      nextOffset,
      scrapeRunId,
      dateFilter,
      jobs: [...accumulated],
      jobsLoaded: accumulated.length,
      phase: 'page-delay',
      delayMs,
      afterRateLimit,
      remainingSeconds,
    })
  })
  refreshStoredScrapeLock(scrapeRunId)
}

async function delayForRunCooldown({
  runRequestCount,
  keyword,
  keywordIndex,
  keywordCount,
  accumulated,
  scrapeRunId,
  signal,
  onProgress,
}) {
  const delayMs = randomBetween(
    SCRAPE_RUN_COOLDOWN_MIN_MS,
    SCRAPE_RUN_COOLDOWN_MAX_MS
  )

  await sleepWithCountdown(delayMs, signal, (remainingSeconds) => {
    refreshStoredScrapeLock(scrapeRunId)
    onProgress?.({
      keyword,
      keywordIndex,
      keywordCount,
      currentKeyword: keyword,
      jobs: [...accumulated],
      jobsLoaded: accumulated.length,
      phase: 'run-cooldown',
      runRequestCount,
      remainingSeconds,
    })
  })
}

async function delayBeforeRateLimitedKeywordRetry({
  retryCount,
  retryKeywords,
  accumulated,
  scrapeRunId,
  signal,
  onProgress,
}) {
  const delayMs = randomBetween(
    RATE_LIMITED_KEYWORD_RETRY_MIN_MS,
    RATE_LIMITED_KEYWORD_RETRY_MAX_MS
  )

  await sleepWithCountdown(delayMs, signal, (remainingSeconds) => {
    refreshStoredScrapeLock(scrapeRunId)
    onProgress?.({
      jobs: [...accumulated],
      jobsLoaded: accumulated.length,
      phase: 'rate-limit-retry-delay',
      retryCount,
      retryKeywords,
      remainingSeconds,
    })
  })
}

function isRateLimitError(err) {
  const message = err instanceof Error ? err.message : String(err)
  return Boolean(err?.rateLimited) || /rate limit/i.test(message)
}

function buildScrapeError(status, data) {
  const error = new Error(formatScrapeError(status, data))
  error.status = status
  error.rateLimited = Boolean(data?.rateLimited)
  error.nextStartOffset =
    data?.nextStartOffset ?? data?.meta?.nextStartOffset ?? null
  return error
}

function extractJobsFromResponse(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.jobs)) return data.jobs
  if (Array.isArray(data?.data?.jobs)) return data.data.jobs
  return []
}

function buildScrapePayload(settings, keywords, startPage) {
  const cookie = normalizeLiAtCookie(settings.liAtCookie)
  return {
    keywords,
    startPage,
    dateFilter: settings.scrapeDateFilter,
    geoId: resolveGeoId(settings),
    workTypeFilter: settings.workTypeFilter ?? 'all',
    fetchCompanySize: settings.fetchCompanySize !== false,
    ...(cookie ? { liAtCookie: cookie } : {}),
  }
}

async function fetchKeywordBatch(settings, keywords, startPage, batchOptions = {}) {
  const { signal, ...payloadOptions } = batchOptions
  if (batchOptions.scrapeRunId) {
    refreshStoredScrapeLock(batchOptions.scrapeRunId)
  }
  throwIfAborted(signal)

  const payload = {
    ...buildScrapePayload(settings, keywords, startPage),
    ...payloadOptions,
  }

  let response
  try {
    response = await fetch('/api/fetch-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    if (signal?.aborted) throw createAbortError()
    if (err?.name === 'AbortError') throw createAbortError()
    throw new Error(
      'Network error — could not reach the scraper API. Restart the dev server and try again.'
    )
  }

  const data = await response.json()
  if (batchOptions.scrapeRunId) {
    refreshStoredScrapeLock(batchOptions.scrapeRunId)
  }

  if (!response.ok) {
    throw buildScrapeError(response.status, data)
  }

  const rawJobs = extractJobsFromResponse(data)
  const normalized = rawJobs.map(normalizeJob)
  const jobs = filterJobsByScrapeRange(
    normalized,
    settings.scrapeDateFilter ?? 'all'
  )
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
    nextStartOffset:
      data.nextStartOffset ?? data.meta?.nextStartOffset ?? null,
    meta: data.meta ?? null,
    warning: data.warning ?? null,
    rateLimited: false,
  }
}

function mergeFetchMeta(existing, incoming, keywords) {
  if (!incoming) return existing

  const keywordResults = [
    ...(existing?.keywordResults ?? []),
    ...(incoming.keywordResults ?? []),
  ]

  return {
    ...(existing ?? {}),
    ...incoming,
    keywords,
    keywordResults,
    pagesRequested:
      (existing?.pagesRequested ?? 0) + (incoming.pagesRequested ?? 0),
    rateLimitedPages:
      (existing?.rateLimitedPages ?? 0) + (incoming.rateLimitedPages ?? 0),
    autoPaginate: true,
  }
}

async function scrapeKeywordPage(
  settings,
  {
    keyword,
    previousKeyword,
    keywordIndex,
    keywordCount,
    pageIndex,
    startOffset,
    accumulated,
    seenKeys,
    scrapeRunId,
    signal,
    onProgress,
  }
) {
  throwIfAborted(signal)
  onProgress?.({
    keyword,
    keywordIndex,
    keywordCount,
    pageIndex,
    jobs: [...accumulated],
    jobsLoaded: accumulated.length,
    phase: 'page',
  })

  const result = await fetchKeywordBatch(settings, [keyword], 1, {
    startOffset,
    maxPages: 1,
    fetchCompanySize: false,
    scrapeRunId,
    pageIndex,
    previousKeyword,
    keywordIndex,
    keywordCount,
    signal,
  })

  const keywordList = parseKeywordList(settings.keywords)
  const nextAccumulated = mergePageJobs(
    accumulated,
    result.jobs,
    seenKeys,
    keyword,
    keywordList,
    settings.scrapeDateFilter ?? 'all'
  )
  const addedCount = nextAccumulated.length - accumulated.length
  const keywordMeta = result.meta?.keywordResults?.[0]

  onProgress?.({
    keyword,
    keywordIndex,
    keywordCount,
    pageIndex,
    jobs: [...nextAccumulated],
    jobsLoaded: nextAccumulated.length,
    addedThisPage: addedCount,
    phase: 'page-done',
  })

  return {
    accumulated: nextAccumulated,
    result,
    nextOffset:
      result.nextStartOffset ??
      startOffset + LINKEDIN_BATCH_SIZE,
    hasMore: Boolean(result.hasMore) && !keywordMeta?.exhausted,
    addedCount,
    stoppedEarly: Boolean(keywordMeta?.stoppedEarly),
    rateLimited: Boolean(result.rateLimited || keywordMeta?.rateLimited),
    exhausted: Boolean(keywordMeta?.exhausted),
  }
}

async function fetchKeywordAllPages(
  settings,
  keyword,
  previousKeyword,
  keywordIndex,
  keywordCount,
  accumulated,
  scrapeRunId,
  runRequestRef,
  runRateLimitRef,
  signal,
  onProgress,
  initialStartOffset = 0
) {
  let startOffset = Math.max(0, Number(initialStartOffset) || 0)
  let pageIndex = Math.floor(startOffset / LINKEDIN_BATCH_SIZE)
  let keywordMeta = null
  let hasMore = true
  let keywordRateLimited = false
  let consecutiveEmptyMatchPages = 0
  let stoppedForEmptyMatches = false
  const warnings = []
  const seenKeys = new Set(
    accumulated.map((job) => jobDedupeKey(job)).filter(Boolean)
  )

  while (hasMore && pageIndex < SAFETY_MAX_PAGES) {
    pageIndex += 1

    let pageResult

    while (true) {
      try {
        pageResult = await scrapeKeywordPage(settings, {
          keyword,
          previousKeyword,
          keywordIndex,
          keywordCount,
          pageIndex,
          startOffset,
          accumulated,
          seenKeys,
          scrapeRunId,
          signal,
          onProgress,
        })
        break
      } catch (err) {
        if (isAbortError(err)) {
          throw err
        }

        const message = err instanceof Error ? err.message : 'Fetch failed'
        if (isRateLimitError(err)) {
          keywordRateLimited = true
          runRateLimitRef.value = true
          const retryOffset =
            Number.isFinite(Number(err.nextStartOffset)) ?
              Number(err.nextStartOffset)
            : startOffset
          startOffset = retryOffset
          warnings.push(
            `${keyword} (page ${pageIndex}): ${message}. Stopped this keyword to avoid retrying a blocked page.`
          )
          hasMore = false
          pageResult = null
          break
        }

        if (accumulated.length === 0) {
          throw err
        }
        keywordRateLimited = isRateLimitError(err)
        if (keywordRateLimited) {
          runRateLimitRef.value = true
        }
        warnings.push(`${keyword} (page ${pageIndex}): ${message}`)
        hasMore = false
        pageResult = null
        break
      }
    }

    if (!pageResult) {
      break
    }

    accumulated = pageResult.accumulated
    runRequestRef.value += 1
    keywordMeta = mergeFetchMeta(keywordMeta, pageResult.result.meta, [keyword])

    if (pageResult.rateLimited || pageResult.stoppedEarly) {
      keywordRateLimited = true
      if (pageResult.rateLimited) {
        runRateLimitRef.value = true
      }
    }

    if (pageResult.result.warning) {
      warnings.push(pageResult.result.warning)
    }

    if (pageResult.addedCount > 0) {
      consecutiveEmptyMatchPages = 0
    } else {
      consecutiveEmptyMatchPages += 1
    }

    if (pageResult.exhausted) {
      break
    }

    hasMore = pageResult.hasMore
    if (hasMore && consecutiveEmptyMatchPages >= EMPTY_MATCH_PAGE_LIMIT) {
      stoppedForEmptyMatches = true
      hasMore = false
      warnings.push(
        `${keyword}: stopped after ${EMPTY_MATCH_PAGE_LIMIT} pages with no new matching title results.`
      )
      break
    }

    if (hasMore) {
      const nextOffset = pageResult.nextOffset
      if (
        runRequestRef.value > 0 &&
        runRequestRef.value % SCRAPE_RUN_COOLDOWN_EVERY === 0
      ) {
        await delayForRunCooldown({
          runRequestCount: runRequestRef.value,
          keyword,
          keywordIndex,
          keywordCount,
          accumulated,
          scrapeRunId,
          signal,
          onProgress,
        })
      }
      await delayBeforeNextKeywordPage({
        keyword,
        keywordIndex,
        keywordCount,
        pageIndex,
        nextOffset,
        accumulated,
        scrapeRunId,
        dateFilter: settings.scrapeDateFilter ?? 'all',
        afterRateLimit: runRateLimitRef.value,
        signal,
        onProgress,
      })
      startOffset = nextOffset
    }
  }

  const pageCapReached = hasMore && pageIndex >= SAFETY_MAX_PAGES
  if (pageCapReached) {
    warnings.push(
      `${keyword}: stopped after ${SAFETY_MAX_PAGES} pages because the safety limit was reached.`
    )
  }

  const keywordExhausted =
    keywordMeta?.keywordResults?.every((entry) => entry.exhausted)

  return {
    jobs: accumulated,
    meta: keywordMeta,
    warnings,
    exhausted: pageCapReached ? false : (keywordExhausted ?? !hasMore),
    rateLimited: keywordRateLimited,
    retryOffset: keywordRateLimited ? startOffset : null,
    stoppedEarly: keywordRateLimited || pageCapReached || stoppedForEmptyMatches,
  }
}

async function finalizeFetchJobs(
  settings,
  accumulated,
  combinedMeta,
  warnings,
  allExhausted,
  onProgress,
  signal
) {
  let jobs = accumulated

  if (settings.fetchCompanySize !== false && jobs.length > 0) {
    throwIfAborted(signal)
    onProgress?.({
      jobs: [...jobs],
      jobsLoaded: jobs.length,
      phase: 'enriching',
    })
    jobs = await enrichJobsCompanySize(
      jobs,
      settings,
      (progress) => {
        const scopedJobs = filterJobsByScrapeRange(
          progress.jobs ?? jobs,
          settings.scrapeDateFilter ?? 'all'
        )
        onProgress?.({
          ...progress,
          jobs: scopedJobs,
          jobsLoaded: scopedJobs.length,
          phase: 'enriching',
        })
      },
      signal
    )
    jobs = filterJobsByScrapeRange(jobs, settings.scrapeDateFilter ?? 'all')
    onProgress?.({
      jobs: [...jobs],
      jobsLoaded: jobs.length,
      phase: 'enriched',
    })
  }

  return {
    jobs: filterJobsByScrapeRange(jobs, settings.scrapeDateFilter ?? 'all'),
    hasMore: jobs.length > 0 && !allExhausted,
    nextStartPage: 2,
    meta: combinedMeta,
    warning: warnings.length > 0 ? warnings.join(' ') : null,
    rateLimited: false,
  }
}

async function fetchJobsProgressively(
  settings,
  keywords,
  { onProgress, scrapeRunId, signal } = {}
) {
  const keywordCount = keywords.length
  let accumulated = []
  let combinedMeta = null
  const warnings = []
  let allExhausted = true
  let afterRateLimit = false
  const runRequestRef = { value: 0 }
  const runRateLimitRef = { value: false }
  const rateLimitedRetries = []

  for (let index = 0; index < keywords.length; index += 1) {
    throwIfAborted(signal)
    const keyword = keywords[index]
    const previousKeyword = index > 0 ? keywords[index - 1] : null
    const keywordIndex = index + 1

    await delayBeforeKeyword(index, {
      afterRateLimit,
      keyword,
      keywordIndex,
      keywordCount,
      onProgress,
      signal,
    })

    onProgress?.({
      keyword,
      keywordIndex,
      keywordCount,
      currentKeyword: keyword,
      jobs: [...accumulated],
      jobsLoaded: accumulated.length,
      phase: 'fetching',
    })

    let keywordResult
    try {
      keywordResult = await fetchKeywordAllPages(
        settings,
        keyword,
        previousKeyword,
        keywordIndex,
        keywordCount,
        accumulated,
        scrapeRunId,
        runRequestRef,
        runRateLimitRef,
        signal,
        onProgress
      )
    } catch (err) {
      if (isAbortError(err)) {
        throw err
      }

      const message = err instanceof Error ? err.message : 'Fetch failed'
      if (accumulated.length === 0) {
        throw err
      }
      warnings.push(`${keyword}: ${message}`)
      onProgress?.({
        keyword,
        keywordIndex,
        keywordCount,
        currentKeyword: keyword,
        jobs: [...accumulated],
        jobsLoaded: accumulated.length,
        phase: 'skipped',
        error: message,
      })
      allExhausted = false
      afterRateLimit = isRateLimitError(err)
      continue
    }

    accumulated = keywordResult.jobs
    combinedMeta = mergeFetchMeta(combinedMeta, keywordResult.meta, keywords)

    if (keywordResult.rateLimited) {
      rateLimitedRetries.push({
        keyword,
        previousKeyword,
        keywordIndex,
        retryOffset: keywordResult.retryOffset ?? 0,
      })
    } else {
      warnings.push(...keywordResult.warnings)
    }

    if (!keywordResult.exhausted) {
      allExhausted = false
    }

    afterRateLimit = Boolean(keywordResult.rateLimited || keywordResult.stoppedEarly)

    onProgress?.({
      keyword,
      keywordIndex,
      keywordCount,
      currentKeyword: keyword,
      jobs: [...accumulated],
      jobsLoaded: accumulated.length,
      phase: 'done',
    })
  }

  if (rateLimitedRetries.length > 0) {
    await delayBeforeRateLimitedKeywordRetry({
      retryCount: rateLimitedRetries.length,
      retryKeywords: rateLimitedRetries.map((entry) => entry.keyword),
      accumulated,
      scrapeRunId,
      signal,
      onProgress,
    })

    for (const retry of rateLimitedRetries) {
      throwIfAborted(signal)
      onProgress?.({
        keyword: retry.keyword,
        keywordIndex: retry.keywordIndex,
        keywordCount,
        currentKeyword: retry.keyword,
        jobs: [...accumulated],
        jobsLoaded: accumulated.length,
        phase: 'retrying-rate-limited-keyword',
      })

      const retryResult = await fetchKeywordAllPages(
        settings,
        retry.keyword,
        retry.previousKeyword,
        retry.keywordIndex,
        keywordCount,
        accumulated,
        scrapeRunId,
        runRequestRef,
        runRateLimitRef,
        signal,
        onProgress,
        retry.retryOffset
      )

      accumulated = retryResult.jobs
      combinedMeta = mergeFetchMeta(combinedMeta, retryResult.meta, keywords)
      warnings.push(...retryResult.warnings)

      if (retryResult.rateLimited) {
        warnings.push(
          `${retry.keyword}: still rate-limited after one delayed retry.`
        )
      }
    }
  }

  return finalizeFetchJobs(
    settings,
    accumulated,
    combinedMeta,
    warnings,
    allExhausted,
    onProgress,
    signal
  )
}

export async function fetchJobsFromScraper(
  settings,
  startPage = 1,
  { onProgress, signal } = {}
) {
  throwIfAborted(signal)
  const settingsSnapshot = {
    ...settings,
    scrapeDateFilter: settings.scrapeDateFilter ?? 'all',
  }
  const keywords = parseKeywordList(settingsSnapshot.keywords)
  if (keywords.length === 0) {
    throw new Error('Add at least one keyword in Settings.')
  }

  const scrapeRunId = createScrapeRunId()
  const useProgressive = Boolean(onProgress) && startPage === 1
  acquireScrapeRunLock(scrapeRunId)

  try {
    if (useProgressive) {
      return await fetchJobsProgressively(settingsSnapshot, keywords, {
        onProgress,
        scrapeRunId,
        signal,
      })
    }

    return await fetchKeywordBatch(settingsSnapshot, keywords, startPage, {
      scrapeRunId,
      signal,
    })
  } finally {
    releaseScrapeRunLock(scrapeRunId)
  }
}

export function mergeCompanySizes(existingJobs, enrichedJobs) {
  const sizeByCompanyUrl = new Map()

  for (const job of enrichedJobs) {
    const companyUrl = cleanLinkedInUrl(job.companyUrl)
    if (!companyUrl) continue

    const rawCount =
      job.companySizeCount ??
      (typeof job.companySize === 'number' ? job.companySize : null)
    const rawLabel = job.companySizeLabel ?? null
    const rawBand =
      typeof job.companySize === 'string' &&
      /\d/.test(job.companySize) &&
      !Number.isFinite(Number(job.companySize))
        ? job.companySize
        : null

    if (rawCount == null && rawLabel == null && rawBand == null) continue

    sizeByCompanyUrl.set(companyUrl, {
      companySizeCount: rawCount,
      companySizeLabel: rawLabel,
      companySize: rawBand,
    })
  }

  return existingJobs.map((job) => {
    const companyUrl = cleanLinkedInUrl(job.companyUrl)
    const patch = companyUrl ? sizeByCompanyUrl.get(companyUrl) : null
    if (!patch) return job

    return normalizeJob({
      ...job,
      companySizeCount: patch.companySizeCount ?? job.companySizeCount,
      companySizeLabel: patch.companySizeLabel ?? job.companySizeLabel,
      companySize: patch.companySize ?? patch.companySizeLabel ?? job.companySize,
    })
  })
}

function parseSseEvents(buffer) {
  const events = []
  const chunks = buffer.split('\n\n')
  const remainder = chunks.pop() ?? ''

  for (const chunk of chunks) {
    const dataLines = chunk
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))

    if (dataLines.length === 0) continue
    events.push(JSON.parse(dataLines.join('\n')))
  }

  return { events, remainder }
}

async function readCompanySizeStream(response, initialJobs, onProgress, signal) {
  if (!response.body) {
    throwIfAborted(signal)
    const data = await response.json()
    return {
      jobs: data.jobs ?? initialJobs,
      enrichment: data.enrichment ?? null,
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let latestJobs = initialJobs
  let latestEnrichment = null

  signal?.addEventListener('abort', () => reader.cancel(), { once: true })

  while (true) {
    throwIfAborted(signal)
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseEvents(buffer)
    buffer = parsed.remainder

    for (const event of parsed.events) {
      if (event.error) {
        throw new Error(event.details || event.error)
      }

      if (event.jobs) {
        latestJobs = event.jobs
      }
      if (event.enrichment) {
        latestEnrichment = event.enrichment
      }

      if (!event.done) {
        onProgress?.({
          ...event,
          jobs: latestJobs,
          enrichment: latestEnrichment,
        })
      }
    }
  }

  throwIfAborted(signal)
  buffer += decoder.decode()
  const parsed = parseSseEvents(buffer)
  for (const event of parsed.events) {
    if (event.error) {
      throw new Error(event.details || event.error)
    }
    if (event.jobs) latestJobs = event.jobs
    if (event.enrichment) latestEnrichment = event.enrichment
  }

  return { jobs: latestJobs, enrichment: latestEnrichment }
}

export async function enrichJobsCompanySize(jobs, settings, onProgress, signal) {
  if (jobs.length === 0) return jobs

  let response
  try {
    throwIfAborted(signal)
    const cookie = normalizeLiAtCookie(settings.liAtCookie)
    response = await fetch('/api/enrich-company-size', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs,
        ...(cookie ? { liAtCookie: cookie } : {}),
      }),
      signal,
    })
  } catch (err) {
    if (signal?.aborted) throw createAbortError()
    if (err?.name === 'AbortError') throw createAbortError()
    throw new Error(
      'Network error — could not reach the company size API. Restart the dev server and try again.'
    )
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(
      data.error ||
        data.details ||
        'Failed to load company sizes from LinkedIn.'
    )
  }

  const { jobs: streamJobs } = await readCompanySizeStream(
    response,
    jobs,
    (progress) => {
      const enriched = (progress.jobs ?? jobs).map(normalizeJob)
      const merged = mergeCompanySizes(jobs, enriched).map(normalizeJob)
      onProgress?.({ ...progress, jobs: merged })
    },
    signal
  )
  const enriched = (streamJobs ?? []).map(normalizeJob)
  return mergeCompanySizes(jobs, enriched).map(normalizeJob)
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

function jobDedupeKey(job) {
  return resolveJobUrl(job) || job.id || null
}

function mergePageJobs(
  accumulated,
  pageJobs,
  seenKeys,
  searchKeyword,
  keywordList,
  scrapeDateFilter
) {
  const canonicalKeyword = canonicalSearchKeyword(searchKeyword, keywordList)
  const newJobs = []

  for (const rawJob of pageJobs) {
    if (!keywordMatchesTitle(rawJob.title, canonicalKeyword)) continue

    const job = normalizeJob({
      ...rawJob,
      keyword: canonicalKeyword,
      searchKeyword: canonicalKeyword,
    })
    const key = jobDedupeKey(job)
    if (!key || seenKeys.has(key)) continue
    seenKeys.add(key)
    newJobs.push(job)
  }

  return filterJobsByScrapeRange([...accumulated, ...newJobs], scrapeDateFilter)
}
