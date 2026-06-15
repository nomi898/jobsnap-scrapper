import { JOB_STATUS, getJobStatusKey } from '../utils/jobStatus'
import { formatPostedDate } from '../utils/filterJobs'
import { formatCompanySize } from '../utils/companySize'

export default function JobTable({
  jobs,
  getStatus,
  getLinkOpens,
  onMarkViewed,
  onMarkCompanyOpened,
  onToggleApplied,
  onJobClick,
}) {
  return (
    <div className="table-wrap">
      <table className="job-table">
        <colgroup>
          <col className="col-title" />
          <col className="col-company" />
          <col className="col-company-size" />
          <col className="col-location" />
          <col className="col-posted" />
          <col className="col-keyword" />
          <col className="col-applied" />
          <col className="col-links" />
        </colgroup>
        <thead>
          <tr>
            <th>Title</th>
            <th>Company</th>
            <th>Size</th>
            <th>Location</th>
            <th>Posted</th>
            <th>Keyword</th>
            <th>Interacted</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const status = getStatus(job)
            const isApplied = status === JOB_STATUS.applied
            const isViewed = status === JOB_STATUS.viewed
            const rowClass = isApplied
              ? 'job-row-applied'
              : isViewed
                ? 'job-row-viewed'
                : ''
            const { companyOpened, postOpened } = getLinkOpens(job)

            return (
              <tr
                key={getJobStatusKey(job) || job.id}
                className={`${rowClass} job-row-clickable`.trim()}
                onClick={() => onJobClick?.(job)}
                tabIndex={onJobClick ? 0 : undefined}
                onKeyDown={(event) => {
                  if (!onJobClick) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onJobClick(job)
                  }
                }}
                role={onJobClick ? 'button' : undefined}
              >
                <td className="title-cell">
                  <div className="title-inner">
                    {(isApplied || (isViewed && !isApplied)) && (
                      <span
                        className={`status-badge ${
                          isApplied
                            ? 'status-badge-applied'
                            : 'status-badge-viewed'
                        }`}
                      >
                        {isApplied ? 'Interacted' : 'Viewed'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="title-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onJobClick?.(job)
                      }}
                    >
                      {job.title || '—'}
                    </button>
                  </div>
                </td>
                <td>
                  <span className="company-name">{job.company || '—'}</span>
                </td>
                <td className="company-size-cell">
                  {formatCompanySize(job.companySizeCount ?? job.companySize)}
                </td>
                <td className="location-cell">{job.location || '—'}</td>
                <td className="posted-cell">
                  {formatPostedDate(job.postedDate)}
                </td>
                <td className="keyword-cell">
                  <span className="keyword-badge">{job.keyword || '—'}</span>
                </td>
                <td className="applied-cell">
                  <label className="applied-check">
                    <input
                      type="checkbox"
                      checked={isApplied}
                      onChange={(e) => onToggleApplied(job, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Mark ${job.title || 'job'} as interacted`}
                    />
                  </label>
                </td>
                <td className="links-cell">
                  <div className="job-links">
                    {job.companyUrl ? (
                      <div className="job-link-item">
                        {companyOpened ? (
                          <span className="opened-badge">Opened</span>
                        ) : null}
                        <a
                          href={job.companyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`job-link${companyOpened ? ' job-link-opened' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onMarkCompanyOpened(job)
                          }}
                          aria-label={
                            companyOpened
                              ? 'Company link opened'
                              : 'Open company on LinkedIn'
                          }
                        >
                          Company Link
                        </a>
                      </div>
                    ) : null}
                    {job.url ? (
                      <div className="job-link-item">
                        {postOpened ? (
                          <span className="opened-badge">Opened</span>
                        ) : null}
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`job-link${postOpened ? ' job-link-opened' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onMarkViewed(job)
                          }}
                          aria-label={
                            postOpened ? 'Post link opened' : 'Open job post on LinkedIn'
                          }
                        >
                          Post Link
                        </a>
                      </div>
                    ) : null}
                    {!job.companyUrl && !job.url ? '—' : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
