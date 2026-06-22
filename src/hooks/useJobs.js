import { useCallback, useRef, useState } from 'react'
import { STORAGE_KEYS } from '../constants'
import { getJobCompanySizeRange } from '../utils/companySize'
import {
  clearActiveScrapeRunLock,
  dedupeJobs,
  enrichJobsCompanySize,
  fetchJobsFromScraper,
  mergeJobWithFetchedDetails,
  normalizeJob,
  parseKeywordList,
} from '../utils/fetchJobs'
import { filterJobsByScrapeRange } from '../utils/filterJobs'
import { loadFromStorage, saveToStorage } from '../utils/storage'

const DEFAULT_PAGINATION = { batchesLoaded: 0, hasMore: false }

function isAbortError(err) {
  return err?.name === 'AbortError'
}

function splitScrapeWarning(message) {
  const text = String(message ?? '').trim()
  if (!text) return { info: null, error: null }

  const infoMatches = [
    ...text.matchAll(
      /[^.]+?: stopped after \d+ pages with no new matching title results\./gi
    ),
  ].map((match) => match[0].trim())

  const error = text
    .replace(
      /[^.]+?: stopped after \d+ pages with no new matching title results\./gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()

  return {
    info:
      infoMatches.length > 0
        ? `Scrape completed. ${infoMatches.join(' ')}`
        : null,
    error: error || null,
  }
}

function jobNeedsCompanySize(job) {
  return Boolean(job?.companyUrl) && !getJobCompanySizeRange(job)
}

export function getEffectiveBatchesLoaded(pagination, jobsCount) {
  if (pagination.batchesLoaded > 0) return pagination.batchesLoaded
  return jobsCount > 0 ? 1 : 0
}

function repairPagination(pagination, jobsCount) {
  const batchesLoaded = getEffectiveBatchesLoaded(pagination, jobsCount)
  return {
    batchesLoaded,
    hasMore: Boolean(pagination?.hasMore),
  }
}

function normalizePagination(stored) {
  if (!stored || typeof stored !== 'object') return DEFAULT_PAGINATION

  if (typeof stored.batchesLoaded === 'number') {
    return {
      batchesLoaded: stored.batchesLoaded,
      hasMore: Boolean(stored.hasMore),
    }
  }

  const legacyNext = Number(stored.nextStartPage) || 2
  return {
    batchesLoaded: Math.max(0, legacyNext - 1),
    hasMore: Boolean(stored.hasMore),
  }
}

export function useJobs() {
  const [jobs, setJobs] = useState(() =>
    loadFromStorage(STORAGE_KEYS.jobs, []).map(normalizeJob)
  )
  const [pagination, setPagination] = useState(() => {
    const storedJobs = loadFromStorage(STORAGE_KEYS.jobs, [])
    const storedPagination = normalizePagination(
      loadFromStorage(STORAGE_KEYS.pagination, null)
    )
    return repairPagination(storedPagination, storedJobs.length)
  })
  const [lastFetched, setLastFetched] = useState(() =>
    loadFromStorage(STORAGE_KEYS.lastFetched, null)
  )
  const [fetchMeta, setFetchMeta] = useState(() =>
    loadFromStorage(STORAGE_KEYS.fetchMeta, null)
  )
  const [fetchProgress, setFetchProgress] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const fetchInFlight = useRef(false)
  const fetchAbortController = useRef(null)
  const fetchRunToken = useRef(0)
  const enrichInFlight = useRef(false)
  const backfillAttempted = useRef('')

  const persistJobs = useCallback((nextJobs) => {
    setJobs(nextJobs)
    saveToStorage(STORAGE_KEYS.jobs, nextJobs)
  }, [])

  const persistPagination = useCallback((nextPagination) => {
    setPagination(nextPagination)
    saveToStorage(STORAGE_KEYS.pagination, nextPagination)
  }, [])

  const persistLastFetched = useCallback((timestamp) => {
    setLastFetched(timestamp)
    saveToStorage(STORAGE_KEYS.lastFetched, timestamp)
  }, [])

  const applyFetchResult = useCallback(
    (result, { append, startPage, jobsBeforeFetch = [], scrapeDateFilter = 'all' }) => {
      const scopedJobs = filterJobsByScrapeRange(result.jobs, scrapeDateFilter)
      const scopedResult = { ...result, jobs: scopedJobs }

      if (!append && scopedResult.jobs.length === 0) {
        if (jobsBeforeFetch.length > 0) {
          persistJobs(jobsBeforeFetch)
        }
        setError(
          `Scraper returned 0 jobs. LinkedIn may be rate limiting — wait 15–30 minutes or add your li_at cookie in Settings.`
        )
        return jobsBeforeFetch.length > 0 ? jobsBeforeFetch : null
      }

      if (append && scopedResult.jobs.length === 0) {
        persistPagination({
          batchesLoaded: getEffectiveBatchesLoaded(
            { batchesLoaded: startPage - 1, hasMore: true },
            jobsBeforeFetch.length
          ),
          hasMore: Boolean(scopedResult.hasMore),
        })
        setError(
          scopedResult.hasMore
            ? `Batch ${startPage} returned no jobs. Wait a minute and try Load More again, or add your li_at cookie in Settings.`
            : `No more jobs found. Your ${jobsBeforeFetch.length} existing jobs were kept.`
        )
        return jobsBeforeFetch
      }

      const nextJobs = (append
        ? dedupeJobs(jobsBeforeFetch, scopedResult.jobs)
        : scopedResult.jobs
      ).map(normalizeJob)
      const addedCount = append
        ? nextJobs.length - jobsBeforeFetch.length
        : nextJobs.length

      if (append && addedCount === 0 && scopedResult.jobs.length > 0) {
        persistPagination({
          batchesLoaded: startPage,
          hasMore: Boolean(scopedResult.hasMore),
        })
        setError(
          scopedResult.hasMore
            ? `Batch ${startPage} only returned jobs you already have. Try Load More again in a minute.`
            : `No more new jobs — LinkedIn results overlap with what you already have.`
        )
        return jobsBeforeFetch
      }

      persistJobs(nextJobs)

      persistPagination({
        batchesLoaded: append ? startPage : 1,
        hasMore: append ? addedCount > 0 && Boolean(scopedResult.hasMore) : false,
      })
      persistLastFetched(new Date().toISOString())
      setFetchMeta(scopedResult.meta)
      saveToStorage(STORAGE_KEYS.fetchMeta, scopedResult.meta)

      return nextJobs
    },
    [persistJobs, persistPagination, persistLastFetched]
  )

  const fetchJobs = useCallback(
    async (settings, { append = false } = {}) => {
      if (fetchInFlight.current) {
        return null
      }

      const paginationBeforeFetch = pagination
      const batchesLoaded = getEffectiveBatchesLoaded(pagination, jobs.length)
      const startPage = append ? batchesLoaded + 1 : 1

      const jobsBeforeFetch = jobs
      const keywordCount = parseKeywordList(settings.keywords).length
      let latestProgressJobs = append ? jobsBeforeFetch : []
      const abortController = new AbortController()
      const runToken = fetchRunToken.current + 1

      fetchRunToken.current = runToken
      fetchInFlight.current = true
      fetchAbortController.current = abortController
      setLoading(true)
      setError(null)
      setNotice(null)

      if (!append) {
        persistPagination(DEFAULT_PAGINATION)
        backfillAttempted.current = ''
      }

      setFetchProgress({
        step: startPage,
        append,
        keywordCount,
        keywordIndex: 0,
        jobsLoaded: append ? jobsBeforeFetch.length : 0,
      })

      const scrapeDateFilter = settings.scrapeDateFilter ?? 'all'

      try {
        const useProgressive = !append

        const result = await fetchJobsFromScraper(settings, startPage, {
          signal: abortController.signal,
          onProgress: useProgressive
            ? (progress) => {
                if (
                  fetchRunToken.current !== runToken ||
                  abortController.signal.aborted
                ) {
                  return
                }

                const {
                  keyword,
                  keywordIndex,
                  keywordCount,
                  pageIndex,
                  jobs: partialJobs,
                  jobsLoaded,
                  addedThisPage,
                  addedThisKeyword,
                  completed,
                  total,
                  loaded,
                  phase,
                  currentKeyword,
                  afterRateLimit,
                  remainingSeconds,
                  runRequestCount,
                  retryCount,
                  retryKeywords,
                } = progress

                setFetchProgress({
                  step: startPage,
                  append,
                  keywordCount,
                  keywordIndex,
                  pageIndex,
                  currentKeyword: currentKeyword ?? keyword,
                  jobsLoaded,
                  addedThisPage,
                  addedThisKeyword,
                  completed,
                  total,
                  loaded,
                  phase,
                  afterRateLimit,
                  remainingSeconds,
                  runRequestCount,
                  retryCount,
                  retryKeywords,
                })
                if (partialJobs?.length > 0) {
                  const scopedPartialJobs = filterJobsByScrapeRange(
                    partialJobs,
                    scrapeDateFilter
                  ).map(normalizeJob)
                  const isEnrichmentPhase =
                    phase === 'enriching' || phase === 'enriched'

                  if (
                    isEnrichmentPhase ||
                    scopedPartialJobs.length >= latestProgressJobs.length
                  ) {
                    latestProgressJobs = scopedPartialJobs
                    persistJobs(scopedPartialJobs)
                  }
                }
              }
            : undefined,
        })
        applyFetchResult(result, {
          append,
          startPage,
          jobsBeforeFetch,
          scrapeDateFilter,
        })
        if (result.warning) {
          const warning = splitScrapeWarning(result.warning)
          setNotice(warning.info)
          setError(warning.error)
        } else if (append && result.jobs.length > 0) {
          const added =
            dedupeJobs(jobsBeforeFetch, result.jobs).length -
            jobsBeforeFetch.length
          if (added > 0) {
            setError(null)
          }
        }
        return result
      } catch (err) {
        if (isAbortError(err)) {
          const newerFetchStarted =
            fetchRunToken.current !== runToken
          if (newerFetchStarted) {
            return null
          }

          const stoppedJobs =
            !append && latestProgressJobs.length > 0
              ? latestProgressJobs.map(normalizeJob)
              : jobsBeforeFetch
          persistJobs(stoppedJobs)
          persistPagination({
            batchesLoaded: stoppedJobs.length > 0 ? 1 : 0,
            hasMore: stoppedJobs.length > 0,
          })
          persistLastFetched(new Date().toISOString())
          setError(
            stoppedJobs.length > 0
              ? `Scrape stopped. Kept ${stoppedJobs.length} jobs loaded so far.`
              : 'Scrape stopped.'
          )
          return {
            jobs: stoppedJobs,
            hasMore: stoppedJobs.length > 0,
            stopped: true,
          }
        }

        if (jobsBeforeFetch.length > 0) {
          persistJobs(jobsBeforeFetch)
        }

        if (append) {
          persistPagination({
            batchesLoaded: getEffectiveBatchesLoaded(
              paginationBeforeFetch,
              jobsBeforeFetch.length
            ),
            hasMore: true,
          })
        } else if (jobsBeforeFetch.length > 0) {
          persistPagination(paginationBeforeFetch)
        }

        const message =
          err instanceof Error ? err.message : 'Failed to fetch jobs'
        setError(
          jobsBeforeFetch.length > 0
            ? `${message} Your ${jobsBeforeFetch.length} existing jobs were kept.`
            : message
        )
        throw err
      } finally {
        if (fetchRunToken.current === runToken) {
          fetchInFlight.current = false
          setLoading(false)
          setFetchProgress(null)
        }
        if (
          fetchRunToken.current === runToken &&
          fetchAbortController.current === abortController
        ) {
          fetchAbortController.current = null
        }
      }
    },
    [
      applyFetchResult,
      jobs,
      persistJobs,
      persistLastFetched,
      persistPagination,
      pagination,
    ]
  )

  const stopFetching = useCallback(() => {
    fetchRunToken.current += 1
    fetchAbortController.current?.abort()
    clearActiveScrapeRunLock()
    fetchInFlight.current = false
    fetchAbortController.current = null
    setLoading(false)
    setFetchProgress(null)
    setError('Scrape stopped.')
  }, [])

  const clearJobs = useCallback(() => {
    persistJobs([])
    persistPagination(DEFAULT_PAGINATION)
    persistLastFetched(null)
    setFetchMeta(null)
    saveToStorage(STORAGE_KEYS.fetchMeta, null)
    setError(null)
    setNotice(null)
    setFetchProgress(null)
    backfillAttempted.current = ''
  }, [persistJobs, persistPagination, persistLastFetched])

  const backfillCompanySizes = useCallback(
    async (settings) => {
      if (settings.fetchCompanySize === false) return
      if (fetchInFlight.current || enrichInFlight.current) return
      if (jobs.length === 0 || !jobs.some(jobNeedsCompanySize)) return

      const fingerprint = jobs
        .map((job) => job.id || job.companyUrl)
        .sort()
        .join('|')
      if (backfillAttempted.current === fingerprint) return

      backfillAttempted.current = fingerprint
      enrichInFlight.current = true
      setFetchProgress({
        phase: 'enriching',
        jobsLoaded: jobs.length,
        keywordCount: 0,
      })

      try {
        const enriched = await enrichJobsCompanySize(jobs, settings)
        persistJobs(enriched.map(normalizeJob))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        enrichInFlight.current = false
        setFetchProgress(null)
      }
    },
    [jobs, persistJobs]
  )

  const saveJobDetails = useCallback((job, details, company) => {
    const merged = mergeJobWithFetchedDetails(job, details, company ?? {})
    setJobs((previous) => {
      const next = previous.map((entry) =>
        entry.id === merged.id ? merged : entry
      )
      saveToStorage(STORAGE_KEYS.jobs, next)
      return next
    })
    return merged
  }, [])

  const batchesLoaded = getEffectiveBatchesLoaded(pagination, jobs.length)

  return {
    jobs,
    pagination,
    batchesLoaded,
    lastFetched,
    fetchMeta,
    fetchProgress,
    loading,
    error,
    notice,
    fetchJobs,
    stopFetching,
    clearJobs,
    backfillCompanySizes,
    saveJobDetails,
    setError,
  }
}
