import fs from 'fs/promises'
import path from 'path'
import { dedupeJobs } from '../lib/scrape/html.js'
import { DEFAULT_SETTINGS } from '../../src/constants.js'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const STORE_FILE = path.join(DATA_DIR, 'store.json')

const EMPTY_STORE = {
  jobs: [],
  settings: null,
  lastFetched: null,
  fetchMeta: null,
  pagination: { batchesLoaded: 0, hasMore: false },
  cronLastRun: null,
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

export async function readStore() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...EMPTY_STORE, ...parsed }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { ...EMPTY_STORE }
    }
    throw err
  }
}

export async function writeStore(patch) {
  const current = await readStore()
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await ensureDataDir()
  await fs.writeFile(STORE_FILE, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function resolveServerSettings(store) {
  return {
    ...DEFAULT_SETTINGS,
    ...(store.settings && typeof store.settings === 'object' ? store.settings : {}),
    fetchCompanySize:
      store.settings && 'fetchCompanySize' in store.settings
        ? store.settings.fetchCompanySize !== false
        : DEFAULT_SETTINGS.fetchCompanySize,
  }
}

export async function saveSettings(settings) {
  return writeStore({ settings })
}

export async function saveFetchResult(data, { append = false } = {}) {
  const store = await readStore()
  const incoming = Array.isArray(data?.jobs) ? data.jobs : []
  const jobs = append ? dedupeJobs(store.jobs ?? [], incoming) : incoming

  return writeStore({
    jobs,
    lastFetched: new Date().toISOString(),
    fetchMeta: data?.meta ?? null,
    pagination: {
      batchesLoaded: append
        ? Math.max(1, Number(store.pagination?.batchesLoaded) || 0) + 1
        : 1,
      hasMore: Boolean(data?.hasMore),
    },
  })
}

export async function markCronRun(result) {
  return writeStore({
    cronLastRun: {
      at: new Date().toISOString(),
      status: result.status,
      jobCount: Array.isArray(result.data?.jobs) ? result.data.jobs.length : 0,
      error: result.status !== 200 ? result.data?.error : null,
    },
  })
}
