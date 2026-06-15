import { useCallback, useEffect, useMemo, useState } from 'react'
import { STORAGE_KEYS } from '../constants'
import {
  collectJobStatusKeys,
  getJobStatusKey,
  JOB_STATUS,
  normalizeStatusMap,
  reconcileStatusMapWithJobs,
  resolveJobStatus,
  resolveJobLinkOpens,
} from '../utils/jobStatus'
import { loadFromStorage, saveToStorage } from '../utils/storage'

function loadStatusMap() {
  const stored = loadFromStorage(STORAGE_KEYS.jobStatus, {})
  const normalized = normalizeStatusMap(stored)

  if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
    saveToStorage(STORAGE_KEYS.jobStatus, normalized)
  }

  return normalized
}

function commitStatusMap(next) {
  saveToStorage(STORAGE_KEYS.jobStatus, next)
  return next
}

export function useJobStatus(jobs = []) {
  const [storedStatusMap, setStoredStatusMap] = useState(loadStatusMap)

  const statusMap = useMemo(
    () => reconcileStatusMapWithJobs(jobs, storedStatusMap),
    [jobs, storedStatusMap]
  )

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.jobStatus, statusMap)
  }, [statusMap])

  const getStatus = useCallback(
    (job) => resolveJobStatus(statusMap, job),
    [statusMap]
  )

  const getLinkOpens = useCallback(
    (job) => resolveJobLinkOpens(statusMap, job),
    [statusMap]
  )

  const markViewed = useCallback((job) => {
    const key = getJobStatusKey(job)
    if (!key) return

    setStoredStatusMap((prev) => {
      const reconciled = reconcileStatusMapWithJobs(jobs, prev)
      const existing = reconciled[key]
      if (existing?.status === JOB_STATUS.applied) {
        const next = { ...reconciled }
        for (const altKey of collectJobStatusKeys(job)) {
          if (altKey !== key) delete next[altKey]
        }
        next[key] = {
          ...existing,
          postOpened: true,
          updatedAt: new Date().toISOString(),
        }
        return commitStatusMap(next)
      }

      const next = { ...reconciled }
      for (const altKey of collectJobStatusKeys(job)) {
        if (altKey !== key) delete next[altKey]
      }
      next[key] = {
        ...existing,
        status: JOB_STATUS.viewed,
        postOpened: true,
        updatedAt: new Date().toISOString(),
      }
      return commitStatusMap(next)
    })
  }, [jobs])

  const markCompanyOpened = useCallback((job) => {
    const key = getJobStatusKey(job)
    if (!key) return

    setStoredStatusMap((prev) => {
      const reconciled = reconcileStatusMapWithJobs(jobs, prev)
      const existing = reconciled[key]
      const next = { ...reconciled }

      for (const altKey of collectJobStatusKeys(job)) {
        if (altKey !== key) delete next[altKey]
      }

      next[key] = {
        ...existing,
        companyOpened: true,
        updatedAt: new Date().toISOString(),
      }
      return commitStatusMap(next)
    })
  }, [jobs])

  const setApplied = useCallback(
    (job, applied) => {
      const key = getJobStatusKey(job)
      if (!key) return

      setStoredStatusMap((prev) => {
        const reconciled = reconcileStatusMapWithJobs(jobs, prev)
        const next = { ...reconciled }

        for (const altKey of collectJobStatusKeys(job)) {
          if (altKey !== key) delete next[altKey]
        }

        if (applied) {
          next[key] = {
            ...reconciled[key],
            status: JOB_STATUS.applied,
            postOpened: true,
            updatedAt: new Date().toISOString(),
          }
        } else if (reconciled[key]?.status === JOB_STATUS.applied) {
          delete next[key]
        }

        return commitStatusMap(next)
      })
    },
    [jobs]
  )

  return {
    statusMap,
    getStatus,
    getLinkOpens,
    markViewed,
    markCompanyOpened,
    setApplied,
  }
}
