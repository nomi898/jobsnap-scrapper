import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import JobDetailModal from '../components/JobDetailModal'
import JobFilters from '../components/JobFilters'
import JobTable from '../components/JobTable'
import Layout from '../components/Layout'
import {
  DASHBOARD_DEFAULT_FILTERS,
  getRegionLabel,
  getScrapeDateLabel,
} from '../constants'
import { useJobs } from '../hooks/useJobs'
import { useSettings } from '../hooks/useSettings'
import { useJobStatus } from '../hooks/useJobStatus'
import {
  countJobsBySearchKeyword,
  enrichJobKeywords,
  filterAndSortJobs,
  formatLastFetched,
  resolveKeywordFilter,
} from '../utils/filterJobs'
import { getJobCompanySizeRange } from '../utils/companySize'
import { countJobStatuses } from '../utils/jobStatus'
import { parseKeywordList } from '../utils/keywords'
import {
  getLinkedInAccessLabel,
  normalizeLiAtCookie,
} from '../utils/linkedinCookie'
import { resolveJobUrl } from '../utils/cleanJobFields'

function getJobIdentities(job) {
  return [job?.id, resolveJobUrl(job), job?.url]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
}

function jobsMatch(a, b) {
  const aKeys = new Set(getJobIdentities(a))
  return getJobIdentities(b).some((key) => aKeys.has(key))
}

function formatFetchProgress(progress, jobsLength = 0) {
  if (!progress) return 'Fetching…'
  const count = progress.jobsLoaded ?? jobsLength
  if (progress.phase === 'enriching') {
    if (progress.total > 0) {
      return `Loading company sizes · ${progress.completed ?? 0}/${progress.total} companies · ${count} jobs`
    }
    return `Loading company sizes · ${count} jobs`
  }
  if (progress.phase === 'keyword-delay') {
    const prefix =
      progress.keywordCount > 1
        ? `Keyword ${progress.keywordIndex}/${progress.keywordCount}: `
        : ''
    const target = progress.currentKeyword ?? 'next keyword'
    if (progress.remainingSeconds != null) {
      return `${prefix}Starting ${target} in ${progress.remainingSeconds}s`
    }
    return `${prefix}Starting ${target} soon…`
  }
  if (progress.phase === 'keyword-cooldown') {
    const prefix =
      progress.keywordCount > 1
        ? `Keyword ${progress.keywordIndex}/${progress.keywordCount}: `
        : ''
    const target = progress.currentKeyword ?? 'next keyword'
    if (progress.remainingSeconds != null) {
      return `${prefix}Starting ${target} in ${progress.remainingSeconds}s`
    }
    return `${prefix}Starting ${target} soon…`
  }
  if (progress.phase === 'run-cooldown') {
    if (progress.remainingSeconds != null) {
      return `Longer cooldown after ${progress.runRequestCount ?? 25} requests · ${progress.remainingSeconds}s`
    }
    return 'Longer cooldown before continuing…'
  }
  if (progress.phase === 'rate-limit-retry-delay') {
    const count = progress.retryCount ?? 1
    const names =
      Array.isArray(progress.retryKeywords) && progress.retryKeywords.length > 0
        ? progress.retryKeywords.join(', ')
        : `${count} rate limited keyword${count === 1 ? '' : 's'}`
    const reason = progress.hasAuthwall ? ' after authwall cooldown' : ''
    if (progress.remainingSeconds != null) {
      return `Retrying ${names}${reason} in ${progress.remainingSeconds}s`
    }
    return `Preparing to retry ${names}${reason}…`
  }
  if (progress.phase === 'retrying-rate-limited-keyword') {
    const prefix =
      progress.keywordCount > 1
        ? `Keyword ${progress.keywordIndex}/${progress.keywordCount}: `
        : ''
    return `${prefix}Retrying ${progress.currentKeyword ?? 'rate limited keyword'} after cooldown…`
  }
  if (progress.phase === 'page-delay') {
    const page = progress.pageIndex ? `page ${progress.pageIndex + 1}` : 'next page'
    const prefix =
      progress.keywordCount > 1
        ? `Keyword ${progress.keywordIndex}/${progress.keywordCount}: `
        : ''
    const slower = progress.afterRateLimit ? 'slower ' : ''
    if (progress.remainingSeconds != null) {
      return `${prefix}${progress.currentKeyword ?? 'Current keyword'} · starting ${page} in ${progress.remainingSeconds}s${slower ? ` (${slower}after block)` : ''}`
    }
    return `${prefix}${progress.currentKeyword ?? 'Current keyword'} · starting ${page} soon…`
  }
  if (progress.currentKeyword) {
    const page = progress.pageIndex ? ` · page ${progress.pageIndex}` : ''
    const prefix =
      progress.keywordCount > 1
        ? `Keyword ${progress.keywordIndex}/${progress.keywordCount}: `
        : ''
    const added =
      progress.addedThisPage > 0 && progress.phase === 'page-done'
        ? ` (+${progress.addedThisPage} new)`
        : ''
    const fetching = progress.phase === 'page' ? ' — fetching…' : ''
    const done = progress.phase === 'done' ? ' — done, next keyword…' : ''
    const lowYield =
      progress.phase === 'page-done' &&
      progress.addedThisPage === 0 &&
      progress.pageIndex > 1
        ? ' (duplicates only)'
        : ''
    return `${prefix}${progress.currentKeyword}${page} · ${count} jobs${added}${lowYield}${fetching}${done}`
  }
  return progress.keywordCount > 1
    ? `Starting ${progress.keywordCount} keywords…`
    : 'Fetching first page…'
}

export default function Dashboard() {
  const { settings, isConfigured } = useSettings()
  const {
    jobs,
    lastFetched,
    loading,
    error,
    notice,
    fetchJobs,
    stopFetching,
    clearJobs,
    backfillCompanySizes,
    saveJobDetails,
    fetchMeta,
    fetchProgress,
  } = useJobs()

  const { statusMap, getStatus, getLinkOpens, markViewed, markCompanyOpened, setApplied } =
    useJobStatus(jobs)
  const [filters, setFilters] = useState(DASHBOARD_DEFAULT_FILTERS)
  const [selectedJob, setSelectedJob] = useState(null)
  const [stoppedLocally, setStoppedLocally] = useState(false)

  useEffect(() => {
    if (loading || jobs.length === 0 || settings.fetchCompanySize === false) {
      return
    }

    const needsSizes = jobs.some(
      (job) => job.companyUrl && !getJobCompanySizeRange(job)
    )
    if (!needsSizes) return

    backfillCompanySizes(settings)
  }, [
    backfillCompanySizes,
    jobs,
    loading,
    settings,
    settings.fetchCompanySize,
  ])

  const keywordList = useMemo(
    () => parseKeywordList(settings.keywords),
    [settings.keywords]
  )

  const savedCookie = useMemo(
    () => normalizeLiAtCookie(settings.liAtCookie),
    [settings.liAtCookie]
  )

  const [accessInfo, setAccessInfo] = useState(null)

  const sessionSource = savedCookie
    ? 'settings'
    : fetchMeta?.sessionSource ?? accessInfo?.source ?? 'none'

  useEffect(() => {
    fetch('/api/linkedin-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(savedCookie ? { liAtCookie: savedCookie } : {}),
    })
      .then((response) => response.json())
      .then((data) => setAccessInfo(data))
      .catch(() => setAccessInfo(null))
  }, [savedCookie])

  const activeFilters = useMemo(
    () => ({
      ...filters,
      keyword: resolveKeywordFilter(filters.keyword, keywordList),
    }),
    [filters, keywordList]
  )

  const enrichedJobs = useMemo(
    () => enrichJobKeywords(jobs, keywordList),
    [jobs, keywordList]
  )

  const visibleFetchProgress = stoppedLocally ? null : fetchProgress
  const visibleLoading = loading && !stoppedLocally
  const isLiveFetch = Boolean(
    visibleFetchProgress && !visibleFetchProgress.append
  )

  const filteredJobs = useMemo(
    () =>
      filterAndSortJobs(enrichedJobs, {
        ...activeFilters,
        availableKeywords: keywordList,
        statusMap,
      }).jobs,
    [enrichedJobs, activeFilters, keywordList, statusMap]
  )

  const tableJobs = filteredJobs

  const visibleStatusCounts = useMemo(
    () => countJobStatuses(tableJobs, statusMap),
    [tableJobs, statusMap]
  )

  const totalStatusCounts = useMemo(
    () => countJobStatuses(enrichedJobs, statusMap),
    [enrichedJobs, statusMap]
  )

  const updateFilters = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  const handleToggleApplied = (job, applied) => {
    setApplied(job, applied)
    if (applied && filters.hideApplied) {
      updateFilters({ hideApplied: false })
    }
  }

  const resetFilters = () => {
    setFilters({ ...DASHBOARD_DEFAULT_FILTERS })
  }

  const hasActiveFilters =
    filters.search !== '' ||
    filters.location !== '' ||
    filters.company !== '' ||
    filters.keyword !== 'all' ||
    filters.workType !== 'all' ||
    filters.companySize !== 'all' ||
    filters.dateFilter !== 'all' ||
    filters.hideApplied ||
    filters.hideViewed ||
    filters.hideDuplicateTitleCompany

  const handleFetch = async () => {
    setStoppedLocally(false)
    try {
      await fetchJobs(settings, { append: false })
    } catch {
      // error state handled in hook
    }
  }

  const handleStopFetch = () => {
    setStoppedLocally(true)
    stopFetching()
  }

  return (
    <Layout title="Dashboard">
      <section className="actions-bar">
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleFetch}
            disabled={visibleLoading || !isConfigured}
          >
            {visibleLoading ? 'Fetching…' : 'Fetch Jobs'}
          </button>
          {visibleLoading && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleStopFetch}
            >
              Stop Scraping
            </button>
          )}
          {jobs.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={clearJobs}
              disabled={visibleLoading}
            >
              Clear
            </button>
          )}
        </div>
        <div className="scrape-meta">
          <span className="meta-chip">
            <span className="meta-chip-label">Region</span>
            <span className="meta-chip-value">{getRegionLabel(settings)}</span>
          </span>
          <span className="meta-chip">
            <span className="meta-chip-label">Search</span>
            <span className="meta-chip-value">
                {keywordList.length} keyword{keywordList.length === 1 ? '' : 's'}
            </span>
          </span>
          <span className="meta-chip">
            <span className="meta-chip-label">Scrape range</span>
            <span className="meta-chip-value">
              {getScrapeDateLabel(settings.scrapeDateFilter)}
            </span>
          </span>
          <span className="meta-chip">
            <span className="meta-chip-label">Mode</span>
            <span className="meta-chip-value">
              {getLinkedInAccessLabel(
                fetchMeta?.accessMode ?? accessInfo?.mode ?? 'guest',
                fetchMeta?.cookieRejected,
                sessionSource
              )}
            </span>
          </span>
          {lastFetched && (
            <span className="meta-chip">
              <span className="meta-chip-label">Updated</span>
              <span className="meta-chip-value">
                {formatLastFetched(lastFetched)}
              </span>
            </span>
          )}
          {visibleFetchProgress && !visibleFetchProgress.append && (
            <span className="meta-chip meta-chip-active">
              {formatFetchProgress(visibleFetchProgress, jobs.length)}
            </span>
          )}
        </div>
      </section>

      {!isConfigured && (
        <div className="banner banner-warning">
          No keywords configured. <Link to="/settings">Configure settings</Link>{' '}
          before fetching jobs.
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-success">{notice}</div>}

      {!visibleFetchProgress &&
        fetchMeta?.rateLimitedPages > 0 &&
        enrichedJobs.length > 0 && (
          <div className="banner banner-warning">
            LinkedIn rate limited part of the search ({fetchMeta.rateLimitedPages}{' '}
            page(s)). Showing {enrichedJobs.length} jobs — wait 15–30 minutes
            and fetch again for more.
          </div>
        )}

      <JobFilters
        filters={filters}
        onChange={updateFilters}
        onClear={resetFilters}
        keywords={keywordList}
        hasActiveFilters={hasActiveFilters}
      />

      <section className="results">
        <div className="results-panel">
          {jobs.length > 0 && (
            <div className="results-summary">
              <div className="results-stats">
                <div className="stat-item">
                  <span className="stat-value">{tableJobs.length}</span>
                  <span className="stat-label">shown</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{enrichedJobs.length}</span>
                  <span className="stat-label">loaded</span>
                </div>
              </div>
              <div className="status-stats">
                <span className="status-stat status-stat-new">
                  <strong>{visibleStatusCounts.unseen}</strong> new
                </span>
                <span className="status-stat status-stat-viewed">
                  <strong>{visibleStatusCounts.viewed}</strong> viewed
                </span>
                <span className="status-stat status-stat-applied">
                  <strong>{visibleStatusCounts.applied}</strong> interacted
                </span>
                {(filters.hideViewed || filters.hideApplied) &&
                  filteredJobs.length !== enrichedJobs.length && (
                    <span className="status-stat status-stat-total muted">
                      ({totalStatusCounts.viewed} viewed ·{' '}
                      {totalStatusCounts.applied} interacted in{' '}
                      {enrichedJobs.length} loaded)
                    </span>
                  )}
              </div>
              {jobs.length > 0 &&
                keywordList.length > 1 &&
                activeFilters.keyword === 'all' && (
                  <div className="keyword-stats">
                    {keywordList.map((kw) => {
                      const isActive =
                        isLiveFetch &&
                        visibleFetchProgress?.currentKeyword &&
                        visibleFetchProgress.currentKeyword.toLowerCase() ===
                          kw.toLowerCase()
                      return (
                        <span
                          key={kw}
                          className={`keyword-stat${isActive ? ' keyword-stat-active' : ''}`}
                        >
                          <span className="keyword-stat-name">{kw}</span>
                          <span className="keyword-stat-count">
                            {countJobsBySearchKeyword(enrichedJobs, kw)}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                )}
            </div>
          )}

          {jobs.length === 0 && !visibleFetchProgress ? (
            <div className="empty-state">
              <p>No jobs loaded yet.</p>
            </div>
          ) : jobs.length === 0 && visibleFetchProgress && !visibleFetchProgress.append ? (
            <div className="empty-state">
              <p>{formatFetchProgress(visibleFetchProgress, jobs.length)}</p>
            </div>
          ) : tableJobs.length === 0 && jobs.length > 0 ? (
            <div className="empty-state">
              <p>No jobs match your filters.</p>
              <p className="muted">
                {filters.hideViewed || filters.hideApplied
                  ? 'Try turning off Hide viewed / Hide interacted or adjust other filters.'
                  : 'Try Clear filters or adjust your search.'}
              </p>
            </div>
          ) : (
            <>
              {visibleFetchProgress && !visibleFetchProgress.append && (
                <div className="live-fetch-banner" role="status" aria-live="polite">
                  <span className="live-fetch-dot" aria-hidden="true" />
                  <span>
                    {formatFetchProgress(visibleFetchProgress, jobs.length)}
                  </span>
                </div>
              )}
              <JobTable
                jobs={tableJobs}
                getStatus={getStatus}
                getLinkOpens={getLinkOpens}
                onMarkViewed={markViewed}
                onMarkCompanyOpened={markCompanyOpened}
                onToggleApplied={handleToggleApplied}
                onJobClick={(job) => setSelectedJob(job)}
              />
            </>
          )}

          {selectedJob && (
            <JobDetailModal
              key={selectedJob.id || selectedJob.url}
              job={
                jobs.find((entry) => jobsMatch(entry, selectedJob)) || selectedJob
              }
              settings={settings}
              onClose={() => setSelectedJob(null)}
              onMarkViewed={markViewed}
              onDetailsLoaded={saveJobDetails}
            />
          )}

        </div>
      </section>
    </Layout>
  )
}
