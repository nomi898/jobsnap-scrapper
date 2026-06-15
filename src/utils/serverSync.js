import { STORAGE_KEYS } from '../constants'
import { normalizeJob } from './mergeJobRecord'
import { loadFromStorage, saveToStorage } from './storage'

export async function syncSettingsToServer(settings) {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    })
  } catch {
    // local-only dev or server unavailable
  }
}

export async function loadJobsFromServer() {
  try {
    const response = await fetch('/api/jobs')
    if (!response.ok) return null

    const data = await response.json()
    if (!Array.isArray(data.jobs)) return null

    return {
      jobs: data.jobs.map(normalizeJob),
      lastFetched: data.lastFetched ?? null,
      fetchMeta: data.fetchMeta ?? null,
      pagination: data.pagination ?? null,
      cronLastRun: data.cronLastRun ?? null,
    }
  } catch {
    return null
  }
}

export function applyServerSnapshot(snapshot) {
  if (!snapshot?.jobs?.length) return false

  const localLast = loadFromStorage(STORAGE_KEYS.lastFetched, null)
  const serverLast = snapshot.lastFetched

  if (serverLast && localLast && localLast > serverLast) {
    return false
  }

  saveToStorage(STORAGE_KEYS.jobs, snapshot.jobs)
  if (snapshot.lastFetched) {
    saveToStorage(STORAGE_KEYS.lastFetched, snapshot.lastFetched)
  }
  if (snapshot.fetchMeta) {
    saveToStorage(STORAGE_KEYS.fetchMeta, snapshot.fetchMeta)
  }
  if (snapshot.pagination) {
    saveToStorage(STORAGE_KEYS.pagination, snapshot.pagination)
  }

  return true
}
