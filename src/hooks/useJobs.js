import { useCallback, useRef, useState } from 'react'
import { STORAGE_KEYS } from '../constants'
import {
  dedupeJobs,
  fetchJobsFromScraper,
  mergeJobWithFetchedDetails,
  normalizeJob,
  parseKeywordList,
} from '../utils/fetchJobs'
import { loadFromStorage, saveToStorage } from '../utils/storage'

const DEFAULT_PAGINATION = { batchesLoaded: 0, hasMore: false }

export function getEffectiveBatchesLoaded(pagination, jobsCount) {
  if (pagination.batchesLoaded > 0) return pagination.batchesLoaded
  return jobsCount > 0 ? 1 : 0
}

function repairPagination(pagination, jobsCount) {
  const batchesLoaded = getEffectiveBatchesLoaded(pagination, jobsCount)
  // Show Load More whenever jobs are loaded; hide only after an explicit end-of-results fetch
  const hasMore = jobsCount > 0

  return { batchesLoaded, hasMore }
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
  const fetchInFlight = useRef(false)

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
    (result, { append, startPage, jobsBeforeFetch = [] }) => {
      if (!append && result.jobs.length === 0) {
        if (jobsBeforeFetch.length > 0) {
          persistJobs(jobsBeforeFetch)
        }
        setError(
          `Scraper returned 0 jobs. LinkedIn may be rate limiting — wait 15–30 minutes, reduce pages per keyword, or add your li_at cookie in Settings.`
        )
        return jobsBeforeFetch.length > 0 ? jobsBeforeFetch : null
      }

      if (append && result.jobs.length === 0) {
        persistPagination({
          batchesLoaded: getEffectiveBatchesLoaded(
            { batchesLoaded: startPage - 1, hasMore: true },
            jobsBeforeFetch.length
          ),
          hasMore: Boolean(result.hasMore),
        })
        setError(
          result.hasMore
            ? `Batch ${startPage} returned no jobs. Wait a minute and try Load More again, or add your li_at cookie in Settings.`
            : `No more jobs found. Your ${jobsBeforeFetch.length} existing jobs were kept.`
        )
        return jobsBeforeFetch
      }

      const nextJobs = append
        ? dedupeJobs(jobsBeforeFetch, result.jobs)
        : result.jobs
      const addedCount = append
        ? nextJobs.length - jobsBeforeFetch.length
        : nextJobs.length

      if (append && addedCount === 0 && result.jobs.length > 0) {
        persistPagination({
          batchesLoaded: startPage,
          hasMore: Boolean(result.hasMore),
        })
        setError(
          result.hasMore
            ? `Batch ${startPage} only returned jobs you already have. Try Load More again in a minute.`
            : `No more new jobs — LinkedIn results overlap with what you already have.`
        )
        return jobsBeforeFetch
      }

      persistJobs(nextJobs)

      const batchesLoaded = startPage
      const hasMore =
        addedCount > 0 && (result.hasMore ?? true)

      persistPagination({
        batchesLoaded,
        hasMore,
      })
      persistLastFetched(new Date().toISOString())
      setFetchMeta(result.meta)
      saveToStorage(STORAGE_KEYS.fetchMeta, result.meta)

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

      fetchInFlight.current = true
      setLoading(true)
      setError(null)

      if (!append) {
        persistPagination(DEFAULT_PAGINATION)
      }

      setFetchProgress({
        step: startPage,
        append,
        keywordCount,
        jobsLoaded: append ? jobsBeforeFetch.length : jobs.length,
      })

      try {
        const result = await fetchJobsFromScraper(settings, startPage)
        applyFetchResult(result, {
          append,
          startPage,
          jobsBeforeFetch,
        })
        if (result.warning) {
          setError(result.warning)
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
        fetchInFlight.current = false
        setLoading(false)
        setFetchProgress(null)
      }
    },
    [
      applyFetchResult,
      jobs,
      persistJobs,
      persistPagination,
      pagination,
    ]
  )

  const clearJobs = useCallback(() => {
    persistJobs([])
    persistPagination(DEFAULT_PAGINATION)
    persistLastFetched(null)
    setFetchMeta(null)
    saveToStorage(STORAGE_KEYS.fetchMeta, null)
    setError(null)
    setFetchProgress(null)
  }, [persistJobs, persistPagination, persistLastFetched])

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
  const nextStep = batchesLoaded + 1
  const canLoadMore = jobs.length > 0 && pagination.hasMore

  return {
    jobs,
    pagination,
    nextStep,
    lastFetched,
    fetchMeta,
    fetchProgress,
    loading,
    error,
    fetchJobs,
    canLoadMore,
    clearJobs,
    saveJobDetails,
    setError,
  }
}
