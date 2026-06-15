import { cleanLinkedInUrl, resolveJobUrl } from './cleanJobFields'

export const JOB_STATUS = {
  applied: 'applied',
  viewed: 'viewed',
}

export function extractLinkedInJobId(value) {
  const match = String(value ?? '').match(/\/jobs\/view\/(\d+)/i)
  return match?.[1] ?? null
}

export function collectJobStatusKeys(job) {
  const keys = new Set()
  const add = (value) => {
    const trimmed = String(value ?? '').trim()
    if (!trimmed) return

    keys.add(trimmed)

    const cleaned = cleanLinkedInUrl(trimmed)
    if (cleaned) keys.add(cleaned)
  }

  add(job?.url)
  add(job?.link)
  add(resolveJobUrl(job))
  add(job?.id)

  return [...keys]
}

export function getJobStatusKey(job) {
  return resolveJobUrl(job) || String(job?.id ?? '').trim() || null
}

function readStatusForEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  return entry.status ?? null
}

function statusKeysOverlap(job, statusKey) {
  const jobKeys = new Set(collectJobStatusKeys(job))
  for (const key of collectJobStatusKeys({ url: statusKey, link: statusKey, id: statusKey })) {
    if (jobKeys.has(key)) return true
  }
  return false
}

function pickStatus(current, candidate) {
  if (candidate === JOB_STATUS.applied) return JOB_STATUS.applied
  if (current === JOB_STATUS.applied) return JOB_STATUS.applied
  if (candidate === JOB_STATUS.viewed) return JOB_STATUS.viewed
  return current
}

function mergeStatusEntries(a, b) {
  if (!a) return b ?? null
  if (!b) return a

  return {
    status: pickStatus(a.status, b.status),
    postOpened: Boolean(a.postOpened || b.postOpened),
    companyOpened: Boolean(a.companyOpened || b.companyOpened),
    updatedAt:
      (a.updatedAt ?? '') >= (b.updatedAt ?? '') ? a.updatedAt : b.updatedAt,
  }
}

function resolveJobStatusEntry(statusMap, job) {
  if (!statusMap) return null

  let resolved = null
  const linkedInIds = new Set()

  for (const key of collectJobStatusKeys(job)) {
    const linkedInId = extractLinkedInJobId(key)
    if (linkedInId) linkedInIds.add(linkedInId)

    resolved = mergeStatusEntries(resolved, statusMap[key])
  }

  if (linkedInIds.size > 0) {
    for (const [key, entry] of Object.entries(statusMap)) {
      const linkedInId = extractLinkedInJobId(key)
      if (!linkedInId || !linkedInIds.has(linkedInId)) continue
      resolved = mergeStatusEntries(resolved, entry)
    }
  }

  for (const [key, entry] of Object.entries(statusMap)) {
    if (!statusKeysOverlap(job, key)) continue
    resolved = mergeStatusEntries(resolved, entry)
  }

  return resolved
}

export function resolveJobLinkOpens(statusMap, job) {
  const entry = resolveJobStatusEntry(statusMap, job)
  const status = readStatusForEntry(entry)

  return {
    postOpened:
      Boolean(entry?.postOpened) ||
      status === JOB_STATUS.viewed ||
      status === JOB_STATUS.applied,
    companyOpened: Boolean(entry?.companyOpened),
  }
}

export function resolveJobStatus(statusMap, job) {
  if (!statusMap) return null

  let resolved = null
  const linkedInIds = new Set()

  for (const key of collectJobStatusKeys(job)) {
    const linkedInId = extractLinkedInJobId(key)
    if (linkedInId) linkedInIds.add(linkedInId)

    resolved = pickStatus(resolved, readStatusForEntry(statusMap[key]))
    if (resolved === JOB_STATUS.applied) return JOB_STATUS.applied
  }

  if (linkedInIds.size > 0) {
    for (const [key, entry] of Object.entries(statusMap)) {
      const linkedInId = extractLinkedInJobId(key)
      if (!linkedInId || !linkedInIds.has(linkedInId)) continue

      resolved = pickStatus(resolved, readStatusForEntry(entry))
      if (resolved === JOB_STATUS.applied) return JOB_STATUS.applied
    }
  }

  for (const [key, entry] of Object.entries(statusMap)) {
    if (!statusKeysOverlap(job, key)) continue

    resolved = pickStatus(resolved, readStatusForEntry(entry))
    if (resolved === JOB_STATUS.applied) return JOB_STATUS.applied
  }

  return resolved
}

export function isJobHiddenByStatusFilters(statusMap, job, filters) {
  if (!statusMap) return false

  const hideViewed = Boolean(filters.hideViewed)
  const hideApplied = Boolean(filters.hideApplied)
  const status = resolveJobStatus(statusMap, job)

  if (hideViewed && status === JOB_STATUS.viewed) return true
  if (hideApplied && status === JOB_STATUS.applied) return true

  return false
}

export function normalizeStatusMap(statusMap) {
  if (!statusMap || typeof statusMap !== 'object') return {}

  const next = {}

  for (const [key, value] of Object.entries(statusMap)) {
    if (!value || typeof value !== 'object') continue

    const normalizedKey =
      resolveJobUrl({ url: key, link: key }) ||
      cleanLinkedInUrl(key) ||
      String(key).trim()
    if (!normalizedKey) continue

    const existing = next[normalizedKey]
    if (
      !existing ||
      value.status === JOB_STATUS.applied ||
      (value.updatedAt ?? '') >= (existing.updatedAt ?? '')
    ) {
      next[normalizedKey] = mergeStatusEntries(existing, value) ?? value
    }
  }

  return next
}

export function reconcileStatusMapWithJobs(jobs, statusMap) {
  const next = { ...normalizeStatusMap(statusMap) }

  for (const job of jobs) {
    const canonicalKey = getJobStatusKey(job)
    if (!canonicalKey) continue

    const keys = collectJobStatusKeys(job)
    let best = next[canonicalKey] ?? null

    for (const key of keys) {
      if (key === canonicalKey) continue

      const entry = next[key]
      if (!entry) continue

      if (
        !best ||
        entry.status === JOB_STATUS.applied ||
        (entry.updatedAt ?? '') >= (best.updatedAt ?? '')
      ) {
        best = mergeStatusEntries(best, entry)
      }

      delete next[key]
    }

    if (best) {
      next[canonicalKey] = best
    }
  }

  return next
}

export function countJobStatuses(jobs, statusMap) {
  let applied = 0
  let viewed = 0
  let unseen = 0

  for (const job of jobs) {
    const status = resolveJobStatus(statusMap, job)
    if (status === JOB_STATUS.applied) applied += 1
    else if (status === JOB_STATUS.viewed) viewed += 1
    else unseen += 1
  }

  return { applied, viewed, unseen }
}
