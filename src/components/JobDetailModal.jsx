import { useEffect, useMemo, useState } from 'react'
import { formatCompanySize } from '../utils/companySize'
import { fetchJobDetails, formatSalaryRange } from '../utils/fetchJobDetails'
import { formatPostedDate } from '../utils/filterJobs'

function DetailChip({ label, value }) {
  if (value == null || value === '') return null

  return (
    <span className="detail-chip">
      <span className="detail-chip-label">{label}</span>
      <span className="detail-chip-value">{String(value)}</span>
    </span>
  )
}

function CompanyFact({ label, value }) {
  if (!value) return null

  return (
    <div className="company-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function buildPayloadFromJob(job) {
  if (!job?.detailsLoadedAt) return null

  return {
    details: {
      title: job.title,
      company: job.company,
      companyUrl: job.companyUrl,
      companyLogo: job.companyLogo,
      location: job.location,
      postedDate: job.postedDate,
      postedAt: job.postedAt,
      expiresAt: job.expiresAt,
      applicantCount: job.applicantCount,
      description: job.description,
      descriptionHtml: job.descriptionHtml,
      employmentType: job.employmentType,
      experienceLevel: job.experienceLevel,
      jobFunction: job.jobFunction,
      industry: job.industry,
      educationLevel: job.educationLevel,
      requirements: job.requirements,
      benefits: job.benefits,
      skills: job.skills,
      visaSponsorship: job.visaSponsorship,
      recruiterName: job.recruiterName,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      currency: job.currency,
      remote: job.remote,
      city: job.city,
      country: job.country,
    },
    company: job.companyDescription
      ? {
          name: job.company,
          logo: job.companyLogo,
          website: job.companyWebsite,
          industry: job.industry,
          companySize: job.companySizeCount,
          companySizeLabel: job.companySize,
          headquarters: job.headquarters,
          organizationType: job.organizationType,
          founded: job.founded,
          specialties: job.specialties,
          description: job.companyDescription,
          linkedInUrl: job.companyLinkedIn,
        }
      : null,
    fromCache: true,
  }
}

export default function JobDetailModal({
  job,
  settings,
  onClose,
  onMarkViewed,
  onDetailsLoaded,
}) {
  const cachedPayload = useMemo(() => buildPayloadFromJob(job), [job])
  const [fetchPayload, setFetchPayload] = useState(null)
  const [loading, setLoading] = useState(() => !cachedPayload)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const payload = cachedPayload ?? fetchPayload

  useEffect(() => {
    if (!job || cachedPayload) return undefined

    let cancelled = false

    fetchJobDetails(job, settings)
      .then((result) => {
        if (cancelled) return
        setFetchPayload(result)
        setWarning(result.warning ?? '')
        if (result.details) {
          onDetailsLoaded?.(job, result.details, result.company)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [job, settings, cachedPayload, onDetailsLoaded])

  useEffect(() => {
    if (!job) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [job, onClose])

  if (!job) return null

  const details = payload?.details
  const company = payload?.company
  const salary = formatSalaryRange(details)
  const title = details?.title || job.title
  const companyName = details?.company || job.company
  const location = details?.location || job.location
  const postedLabel = details?.postedAt || details?.postedDate || job.postedAt || job.postedDate
  const logo = company?.logo || details?.companyLogo || job.companyLogo
  const skills = details?.skills?.length ? details.skills : job.skills

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-detail-title"
      >
        <header className="modal-header">
          <div className="modal-header-main">
            {logo ? (
              <img className="modal-company-logo" src={logo} alt="" />
            ) : (
              <div className="modal-company-logo modal-company-logo--placeholder" />
            )}
            <div className="modal-header-text">
              <h2 id="job-detail-title" className="modal-title">
                {title || 'Job details'}
              </h2>
              <p className="modal-subtitle">
                {companyName || '—'}
                {location ? ` · ${location}` : ''}
              </p>
              <p className="modal-meta-line">
                {formatPostedDate(postedLabel)}
                {details?.applicantCount != null
                  ? ` · ${details.applicantCount.toLocaleString()} applicants`
                  : ''}
                {payload?.fromCache ? ' · saved details' : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close job details"
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          {loading && (
            <div className="modal-loading">Loading job and company details…</div>
          )}

          {warning && !loading && !error && (
            <div className="banner banner-warning">{warning}</div>
          )}

          {error && !loading && <div className="banner banner-error">{error}</div>}

          {!loading && !error && details && (
            <>
              <section className="modal-section">
                <h3 className="modal-section-title">Overview</h3>
                <div className="detail-chips">
                  <DetailChip label="Employment" value={details.employmentType} />
                  <DetailChip label="Seniority" value={details.experienceLevel} />
                  <DetailChip label="Function" value={details.jobFunction} />
                  <DetailChip label="Industry" value={details.industry} />
                  <DetailChip label="Education" value={details.educationLevel} />
                  <DetailChip label="Salary" value={salary} />
                  <DetailChip
                    label="Remote"
                    value={
                      details.remote == null ? null : details.remote ? 'Yes' : 'No'
                    }
                  />
                  <DetailChip
                    label="City"
                    value={details.city || job.city}
                  />
                  <DetailChip
                    label="Country"
                    value={details.country || job.country}
                  />
                  <DetailChip label="Posted" value={details.postedAt || job.postedAt} />
                  <DetailChip label="Expires" value={details.expiresAt || job.expiresAt} />
                  <DetailChip
                    label="Visa sponsorship"
                    value={
                      details.visaSponsorship == null
                        ? null
                        : details.visaSponsorship
                          ? 'Yes'
                          : 'No'
                    }
                  />
                </div>
              </section>

              {skills?.length > 0 && (
                <section className="modal-section">
                  <h3 className="modal-section-title">Skills</h3>
                  <div className="detail-chips">
                    {skills.map((skill) => (
                      <span key={skill} className="skill-chip">
                        {skill}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {details.descriptionHtml ? (
                <section className="modal-section">
                  <h3 className="modal-section-title">Description</h3>
                  <div
                    className="job-description-html"
                    dangerouslySetInnerHTML={{ __html: details.descriptionHtml }}
                  />
                </section>
              ) : details.description ? (
                <section className="modal-section">
                  <h3 className="modal-section-title">Description</h3>
                  <p className="job-description-text">{details.description}</p>
                </section>
              ) : null}

              {details.requirements && (
                <section className="modal-section">
                  <h3 className="modal-section-title">Requirements</h3>
                  <p className="job-description-text">{details.requirements}</p>
                </section>
              )}

              {details.benefits && (
                <section className="modal-section">
                  <h3 className="modal-section-title">Benefits</h3>
                  <p className="job-description-text">{details.benefits}</p>
                </section>
              )}

              {details.recruiterName && (
                <section className="modal-section">
                  <h3 className="modal-section-title">Recruiter</h3>
                  <p className="modal-plain-text">{details.recruiterName}</p>
                </section>
              )}

              <section className="modal-section">
                <h3 className="modal-section-title">Company</h3>
                {payload.companyError && !company && (
                  <p className="modal-muted">
                    Company details could not be loaded: {payload.companyError}
                  </p>
                )}
                {company ? (
                  <>
                    <dl className="company-facts">
                      <CompanyFact label="Name" value={company.name} />
                      <CompanyFact
                        label="Size"
                        value={
                          company.companySizeLabel ||
                          formatCompanySize(company.companySize) ||
                          null
                        }
                      />
                      <CompanyFact label="Industry" value={company.industry} />
                      <CompanyFact
                        label="Headquarters"
                        value={company.headquarters}
                      />
                      <CompanyFact label="Type" value={company.organizationType} />
                      <CompanyFact label="Founded" value={company.founded} />
                      <CompanyFact label="Specialties" value={company.specialties} />
                      <CompanyFact
                        label="Website"
                        value={
                          company.website ? (
                            <a
                              href={
                                company.website.startsWith('http')
                                  ? company.website
                                  : `https://${company.website}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {company.website}
                            </a>
                          ) : null
                        }
                      />
                    </dl>
                    {company.description && (
                      <p className="company-about">{company.description}</p>
                    )}
                  </>
                ) : (
                  !payload.companyError && (
                    <p className="modal-muted">No company page linked.</p>
                  )
                )}
              </section>
            </>
          )}
        </div>

        <footer className="modal-footer">
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              onClick={() => onMarkViewed?.(job)}
            >
              Open on LinkedIn
            </a>
          )}
          {(company?.linkedInUrl || job.companyUrl) && (
            <a
              href={company?.linkedInUrl || job.companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              Company Page
            </a>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
