import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import JobDetailModal from '../components/JobDetailModal'
import JobFilters from '../components/JobFilters'
import JobTable from '../components/JobTable'
import Layout from '../components/Layout'
import {
  DASHBOARD_DEFAULT_FILTERS,
  getRegionLabel,
} from '../constants'
import { useJobs } from '../hooks/useJobs'
import { useSettings } from '../hooks/useSettings'
import { useJobStatus } from '../hooks/useJobStatus'
import {
  countJobsByKeyword,
  enrichJobKeywords,
  filterAndSortJobs,
  formatLastFetched,
  resolveKeywordFilter,
} from '../utils/filterJobs'
import { countJobStatuses } from '../utils/jobStatus'
import { parseKeywordList } from '../utils/keywords'
import {
  getLinkedInAccessLabel,
  normalizeLiAtCookie,
} from '../utils/linkedinCookie'

export default function Dashboard() {
  const { settings, isConfigured } = useSettings()
  const {
    jobs,
    lastFetched,
    loading,
    error,
    fetchJobs,
    canLoadMore,
    clearJobs,
    saveJobDetails,
    fetchMeta,
    fetchProgress,
  } = useJobs()

  const { statusMap, getStatus, getLinkOpens, markViewed, markCompanyOpened, setApplied } =
    useJobStatus(jobs)
  const [filters, setFilters] = useState(DASHBOARD_DEFAULT_FILTERS)
  const [selectedJob, setSelectedJob] = useState(null)

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

  const filteredJobs = useMemo(
    () =>
      filterAndSortJobs(enrichedJobs, {
        ...activeFilters,
        availableKeywords: keywordList,
        statusMap,
      }).jobs,
    [enrichedJobs, activeFilters, keywordList, statusMap]
  )

  const visibleStatusCounts = useMemo(
    () => countJobStatuses(filteredJobs, statusMap),
    [filteredJobs, statusMap]
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
    try {
      await fetchJobs(settings, { append: false })
    } catch {
      // error state handled in hook
    }
  }

  const handleLoadMore = async () => {
    try {
      await fetchJobs(settings, { append: true })
    } catch {
      // error state handled in hook
    }
  }

  return (
    <Layout title="Dashboard">
      <section className="actions-bar">
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleFetch}
            disabled={loading || !isConfigured}
          >
            {loading ? 'Fetching…' : 'Fetch Jobs'}
          </button>
          {jobs.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={clearJobs}
              disabled={loading}
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
          {fetchProgress && !fetchProgress.append && (
            <span className="meta-chip meta-chip-active">Fetching…</span>
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

      {!fetchProgress &&
        fetchMeta?.pagesRequested > 1 &&
        enrichedJobs.length < fetchMeta.pagesRequested * 3 && (
          <div className="banner banner-warning">
            Only {enrichedJobs.length} unique jobs from{' '}
            {fetchMeta.pagesRequested} LinkedIn page requests. Increase{' '}
            <strong>Pages per keyword</strong> in Settings (try 10), ensure both
            keywords are set, and use <strong>Load More</strong> for the next
            batch.
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
                  <span className="stat-value">{filteredJobs.length}</span>
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
              {enrichedJobs.length > 0 &&
                keywordList.length > 1 &&
                activeFilters.keyword === 'all' && (
                  <div className="keyword-stats">
                    {keywordList.map((kw) => (
                      <span key={kw} className="keyword-stat">
                        <span className="keyword-stat-name">{kw}</span>
                        <span className="keyword-stat-count">
                          {countJobsByKeyword(enrichedJobs, kw, keywordList)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              {fetchProgress && !fetchProgress.append && (
                <span className="results-status">Fetching…</span>
              )}
            </div>
          )}

          {jobs.length === 0 && !fetchProgress ? (
            <div className="empty-state">
              <p>No jobs loaded yet.</p>
            </div>
          ) : jobs.length === 0 && fetchProgress && !fetchProgress.append ? (
            <div className="empty-state">
              <p>Fetching jobs…</p>
            </div>
          ) : filteredJobs.length === 0 && jobs.length > 0 ? (
            <div className="empty-state">
              <p>No jobs match your filters.</p>
              <p className="muted">
                {filters.hideViewed || filters.hideApplied
                  ? 'Try turning off Hide viewed / Hide interacted or adjust other filters.'
                  : 'Try Clear filters or adjust your search.'}
              </p>
            </div>
          ) : (
            <JobTable
              jobs={filteredJobs}
              getStatus={getStatus}
              getLinkOpens={getLinkOpens}
              onMarkViewed={markViewed}
              onMarkCompanyOpened={markCompanyOpened}
              onToggleApplied={handleToggleApplied}
              onJobClick={(job) => setSelectedJob(job)}
            />
          )}

          {selectedJob && (
            <JobDetailModal
              key={selectedJob.id || selectedJob.url}
              job={
                jobs.find((entry) => entry.id === selectedJob.id) || selectedJob
              }
              settings={settings}
              onClose={() => setSelectedJob(null)}
              onMarkViewed={markViewed}
              onDetailsLoaded={saveJobDetails}
            />
          )}

          {jobs.length > 0 &&
            (canLoadMore || (loading && fetchProgress?.append)) && (
              <div className="load-more-bar">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleLoadMore}
                  disabled={loading || !isConfigured || !canLoadMore}
                >
                  {loading && fetchProgress?.append
                    ? 'Loading…'
                    : `Load More Jobs`}
                </button>
              </div>
            )}
        </div>
      </section>
    </Layout>
  )
}
