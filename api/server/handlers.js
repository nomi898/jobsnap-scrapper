import { enrichJobsWithCompanySize } from '../companySize.js'
import { fetchJobAndCompanyDetails } from '../fetch-job-details.js'
import { getLinkedInAccessInfo } from '../linkedin-access.js'
import { resolveRequestLiAtCookie } from '../linkedinHttp.js'
import { scrapeJobs } from '../scrapeJobs.js'
import { parseKeywordList } from '../../src/utils/keywords.js'
import { resolveGeoId } from '../../src/constants.js'
import {
  markCronRun,
  readStore,
  resolveServerSettings,
  saveFetchResult,
  saveSettings,
} from './store.js'

function scrapeOptionsFromSettings(settings, overrides = {}) {
  const session = resolveRequestLiAtCookie(settings.liAtCookie)
  const keywords = parseKeywordList(settings.keywords)

  return {
    keywords,
    dateFilter: settings.scrapeDateFilter ?? '7d',
    geoId: resolveGeoId(settings),
    workTypeFilter: settings.workTypeFilter ?? 'all',
    fetchCompanySize: settings.fetchCompanySize !== false,
    liAtCookie: session.cookie,
    sessionSource: session.source,
    startPage: 1,
    startOffset: 0,
    ...overrides,
  }
}

export async function handleHealth() {
  return { status: 200, data: { ok: true, service: 'jobsnap-scraper' } }
}

export async function handleGetJobs() {
  const store = await readStore()
  return {
    status: 200,
    data: {
      jobs: store.jobs ?? [],
      lastFetched: store.lastFetched,
      fetchMeta: store.fetchMeta,
      pagination: store.pagination,
      cronLastRun: store.cronLastRun ?? null,
    },
  }
}

export async function handleGetSettings() {
  const store = await readStore()
  const settings = resolveServerSettings(store)
  return {
    status: 200,
    data: {
      settings: {
        ...settings,
        liAtCookie: settings.liAtCookie ? '***' : '',
      },
      hasCookie: Boolean(settings.liAtCookie),
    },
  }
}

export async function handlePostSettings(body) {
  const store = await readStore()
  const previous = resolveServerSettings(store)
  const incoming = body?.settings ?? body ?? {}

  const nextSettings = {
    ...previous,
    ...incoming,
    liAtCookie:
      incoming.liAtCookie === '***' || incoming.liAtCookie === undefined
        ? previous.liAtCookie
        : incoming.liAtCookie,
  }

  await saveSettings(nextSettings)
  return { status: 200, data: { success: true } }
}

export async function handleLinkedInAccess(body) {
  return { status: 200, data: getLinkedInAccessInfo(body?.liAtCookie) }
}

export async function handleEnrichCompanySize(body) {
  const jobs = Array.isArray(body?.jobs) ? body.jobs : []
  const session = resolveRequestLiAtCookie(body?.liAtCookie)
  const { jobs: enriched, enrichment } = await enrichJobsWithCompanySize(
    jobs,
    session.cookie
  )
  return { status: 200, data: { jobs: enriched, enrichment } }
}

export async function handleFetchJobDetails(body) {
  const session = resolveRequestLiAtCookie(body?.liAtCookie)
  const { status, data } = await fetchJobAndCompanyDetails({
    jobUrl: body?.jobUrl ?? body?.url,
    companyUrl: body?.companyUrl,
    liAtCookie: session.cookie,
  })
  return { status, data }
}

export async function handleFetchJobs(body) {
  const session = resolveRequestLiAtCookie(body?.liAtCookie)
  const result = await scrapeJobs({
    keywords: body?.keywords,
    startPage: body?.startPage ?? 1,
    startOffset: body?.startOffset,
    dateFilter: body?.dateFilter ?? '7d',
    geoId: body?.geoId ?? '92000000',
    workTypeFilter: body?.workTypeFilter ?? 'all',
    fetchCompanySize: body?.fetchCompanySize !== false,
    liAtCookie: session.cookie,
    sessionSource: session.source,
  })

  if (result.status === 200 && Array.isArray(result.data?.jobs)) {
    await saveFetchResult(result.data, { append: Boolean(body?.append) })
    if (body?.settings && typeof body.settings === 'object') {
      await saveSettings(body.settings)
    }
  }

  return result
}

export async function handleCronFetchJobs() {
  const store = await readStore()
  const settings = resolveServerSettings(store)
  const keywords = parseKeywordList(settings.keywords)

  if (keywords.length === 0) {
    const result = {
      status: 400,
      data: {
        error: 'No keywords configured',
        details: 'Save keywords in Settings before running cron',
      },
    }
    await markCronRun(result)
    return result
  }

  const result = await scrapeJobs(scrapeOptionsFromSettings(settings))

  if (result.status === 200 && Array.isArray(result.data?.jobs)) {
    await saveFetchResult(result.data, { append: false })
  }

  await markCronRun(result)
  return result
}
