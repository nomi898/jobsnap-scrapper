import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatCompanySize } from '../utils/companySize'
import {
  fetchCompanyDetailsForJob,
  fetchJobDetails,
  formatSalaryRange,
} from '../utils/fetchJobDetails'
import { formatPostedDate } from '../utils/filterJobs'
import { normalizeLiAtCookie } from '../utils/linkedinCookie'
import { DETAILS_SCHEMA_VERSION } from '../utils/mergeJobRecord'

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

function formatDisplayValue(value) {
  return typeof value === 'string' ? value.replace(/-/g, ' ') : value
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function getJobKey(job) {
  return job?.id || job?.url || ''
}

function mergeCompanyDisplay(currentCompany, nextCompany) {
  if (!currentCompany) return nextCompany ?? null
  if (!nextCompany) return currentCompany

  const merged = { ...currentCompany }
  for (const [key, value] of Object.entries(nextCompany)) {
    if (value != null && value !== '') {
      merged[key] = value
    }
  }
  return merged
}

function mergeDefinedValues(base = {}, next = {}) {
  const merged = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(next ?? {})) {
    if (value != null && value !== '') {
      merged[key] = value
    }
  }
  return merged
}

function mergePayloads(cachedPayload, fetchedPayload) {
  if (!cachedPayload) return fetchedPayload ?? null
  if (!fetchedPayload) return cachedPayload

  return {
    ...cachedPayload,
    ...fetchedPayload,
    details: mergeDefinedValues(cachedPayload.details, fetchedPayload.details),
    company: mergeCompanyDisplay(cachedPayload.company, fetchedPayload.company),
    companyError: fetchedPayload.companyError ?? cachedPayload.companyError,
    warning: fetchedPayload.warning ?? cachedPayload.warning,
  }
}

function summarizeCompany(company) {
  return {
    name: company?.name ?? null,
    website: company?.website ?? null,
    phone: company?.phone ?? null,
    size: company?.companySizeLabel ?? company?.companySize ?? null,
    industry: company?.industry ?? null,
    headquarters: company?.headquarters ?? null,
    type: company?.organizationType ?? null,
    founded: company?.founded ?? null,
    specialties: company?.specialties ?? null,
    hasDescription: Boolean(company?.description),
    linkedInUrl: company?.linkedInUrl ?? null,
  }
}

function hasRichCompanyDetails(company) {
  return Boolean(
    company?.website ||
      company?.description ||
      company?.headquarters ||
      company?.organizationType ||
      company?.founded ||
      company?.specialties
  )
}

function hasCurrentDetailCache(job) {
  return (
    Boolean(job?.detailsLoadedAt) &&
    job?.detailsSchemaVersion === DETAILS_SCHEMA_VERSION
  )
}

function buildPayloadFromJob(job) {
  if (!job) return null
  const hasCompanyInfo = Boolean(
    job.company ||
      job.companyUrl ||
      job.companyLinkedIn ||
      job.companyLogo ||
      job.companyWebsite ||
      job.companyPhone ||
      job.companySize ||
      job.companySizeCount ||
      job.companyDescription ||
      job.headquarters ||
      job.organizationType ||
      job.founded ||
      job.specialties ||
      job.industry
  )

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
      keyword: job.keyword,
      workplace: job.workplace,
      workType: job.workType,
      applyUrl: job.applyUrl || job.url,
    },
    company: hasCompanyInfo
      ? {
          name: job.company,
          logo: job.companyLogo,
          website: job.companyWebsite,
          phone: job.companyPhone,
          industry: job.industry,
          companySize: job.companySizeCount,
          companySizeLabel: job.companySize,
          headquarters: job.headquarters,
          organizationType: job.organizationType,
          founded: job.founded,
          specialties: job.specialties,
          description: job.companyDescription,
          linkedInUrl: job.companyLinkedIn || job.companyUrl,
        }
      : null,
    fromCache: hasCurrentDetailCache(job),
  }
}

export default function JobDetailModal({
  job,
  settings,
  onClose,
  onMarkViewed,
  onDetailsLoaded,
}) {
  const jobKey = getJobKey(job)
  const cachedPayload = useMemo(() => buildPayloadFromJob(job), [job])
  const [fetchPayload, setFetchPayload] = useState(null)
  const [loading, setLoading] = useState(() => !cachedPayload?.details)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [companyPayload, setCompanyPayload] = useState(null)
  const [companyLoading, setCompanyLoading] = useState(false)
  const [companyError, setCompanyError] = useState('')
  const [detailCooldownRemainingMs, setDetailCooldownRemainingMs] = useState(null)
  const mountedRef = useRef(false)
  const selectedJobKeyRef = useRef(null)
  const postedLabelRef = useRef('')
  const fetchedJobKeyRef = useRef(null)
  const companyRequestKeyRef = useRef(null)
  const companyRequestIdRef = useRef(0)
  const payload = useMemo(
    () => mergePayloads(cachedPayload, fetchPayload),
    [cachedPayload, fetchPayload]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadCompanyDetails = useCallback(
    async (details, { save = true, attempts = 3, force = false } = {}) => {
      if (!job || !jobKey) {
        return
      }

      const companyUrl = details?.companyUrl || job.companyLinkedIn || job.companyUrl
      const requestKey = `${jobKey}:${companyUrl || ''}`
      if (!force && companyRequestKeyRef.current === requestKey) {
        return
      }

      companyRequestKeyRef.current = requestKey
      const requestId = companyRequestIdRef.current + 1
      companyRequestIdRef.current = requestId

      setCompanyLoading(true)
      setCompanyError('')

      try {
        let result = null
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          result = await fetchCompanyDetailsForJob(job, details, settings)
          if (companyRequestIdRef.current !== requestId) return
          if (!result.companyError) break
          if (attempt < attempts) {
            await wait(1500 * attempt)
          }
        }

        if (companyRequestIdRef.current !== requestId) return
        setCompanyPayload((current) =>
          mergeCompanyDisplay(current, result.company)
        )
        setCompanyError(result.companyError ?? '')
        if (save && details) {
          onDetailsLoaded?.(job, details, result.company)
        }
      } catch {
        if (companyRequestIdRef.current === requestId) {
          setCompanyError('Company details could not be loaded right now.')
        }
      } finally {
        if (companyRequestIdRef.current === requestId) {
          setCompanyLoading(false)
        }
      }
    },
    [job, jobKey, settings, onDetailsLoaded]
  )

  useEffect(() => {
    if (selectedJobKeyRef.current === jobKey) return

    selectedJobKeyRef.current = jobKey
    postedLabelRef.current = job?.postedDate || job?.postedAt || ''
    fetchedJobKeyRef.current = null
    setFetchPayload(null)
    setLoading(!cachedPayload?.details)
    setError('')
    setWarning('')
  }, [jobKey])

  useEffect(() => {
    if (!job || !jobKey) return undefined
    if (hasCurrentDetailCache(job)) {
      console.info('[job-detail-fetch]', {
        jobId: job.id ?? null,
        jobKey,
        title: job.title,
        cacheHit: true,
        cacheMiss: false,
        cacheVersion: job.detailsSchemaVersion ?? null,
        expectedVersion: DETAILS_SCHEMA_VERSION,
        skipped: true,
        cachedCompany: summarizeCompany(cachedPayload.company),
      })
      if (
        cachedPayload?.details &&
        !hasRichCompanyDetails(cachedPayload.company) &&
        normalizeLiAtCookie(settings?.liAtCookie)
      ) {
        window.setTimeout(() => {
          if (!mountedRef.current || selectedJobKeyRef.current !== jobKey) return
          loadCompanyDetails(cachedPayload.details, {
            save: true,
            attempts: 1,
            force: true,
          })
        }, 0)
      }
      return undefined
    }
    if (fetchedJobKeyRef.current === jobKey) return undefined

    fetchedJobKeyRef.current = jobKey
    console.info('[job-detail-fetch]', {
      jobId: job.id ?? null,
      jobKey,
      title: job.title,
      cacheHit: false,
      cacheMiss: true,
      cacheVersion: job.detailsSchemaVersion ?? null,
      expectedVersion: DETAILS_SCHEMA_VERSION,
      status: 'start',
      companyUrl: job.companyUrl,
      companyLinkedIn: job.companyLinkedIn,
    })

    fetchJobDetails(job, settings)
      .then((result) => {
        if (!mountedRef.current || fetchedJobKeyRef.current !== jobKey) return
        console.info('[job-detail-fetch]', {
          jobId: job.id ?? null,
          jobKey,
          title: job.title,
          cacheHit: false,
          cacheMiss: true,
          status: 'success',
          companyError: result.companyError ?? null,
          company: summarizeCompany(result.company),
        })
        setFetchPayload(result)
        setWarning(
          result.warning &&
          !result.details?.description &&
          !result.details?.descriptionHtml ?
            result.warning
          : ''
        )
        setDetailCooldownRemainingMs(null)
        if (result.company) {
          setCompanyPayload((current) =>
            mergeCompanyDisplay(
              mergeCompanyDisplay(cachedPayload?.company, current),
              result.company
            )
          )
          setCompanyError('')
        } else if (result.companyError) {
          setCompanyError(result.companyError)
        }
        if (result.details) {
          onDetailsLoaded?.(job, result.details, result.company)
          window.setTimeout(() => {
            if (!mountedRef.current || fetchedJobKeyRef.current !== jobKey) return
            loadCompanyDetails(
              {
                ...result.details,
                companyUrl:
                  result.companyUrl ||
                  result.details.companyUrl ||
                  result.company?.linkedInUrl,
              },
              { save: true, attempts: 1, force: true }
            )
          }, 0)
        }
      })
      .catch((err) => {
        if (mountedRef.current && fetchedJobKeyRef.current === jobKey) {
          console.info('[job-detail-fetch]', {
            jobId: job.id ?? null,
            jobKey,
            title: job.title,
            cacheHit: false,
            cacheMiss: true,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            blocked: /blocked|empty|rate|auth|login/i.test(
              err instanceof Error ? err.message : String(err)
            ),
            authwallDetected: /auth|login|li_at|cookie/i.test(
              err instanceof Error ? err.message : String(err)
            ),
            cooldownRemainingMs: err?.cooldownRemainingMs ?? null,
          })
          const cooldownRemainingMs = err?.cooldownRemainingMs
          setDetailCooldownRemainingMs(cooldownRemainingMs ?? null)
          setWarning(
            cooldownRemainingMs ?
              `Additional LinkedIn details are temporarily unavailable. Retry available in ${formatDuration(cooldownRemainingMs)}.`
            : 'Full job details could not be loaded right now. Showing available details.'
          )
        }
      })
      .finally(() => {
        if (mountedRef.current && fetchedJobKeyRef.current === jobKey) {
          setLoading(false)
        }
      })
  }, [job, jobKey, settings, cachedPayload, onDetailsLoaded, loadCompanyDetails])

  useEffect(() => {
    setCompanyPayload(null)
    setCompanyLoading(false)
    setCompanyError('')
    setDetailCooldownRemainingMs(null)
    companyRequestKeyRef.current = null
    companyRequestIdRef.current += 1
  }, [jobKey])

  useEffect(() => {
    if (!detailCooldownRemainingMs) return undefined

    const intervalId = window.setInterval(() => {
      setDetailCooldownRemainingMs((current) => {
        if (!current) return null
        const next = Math.max(0, current - 1000)
        return next > 0 ? next : null
      })
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [detailCooldownRemainingMs])

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
  const company = companyPayload ?? payload?.company
  const salary = formatSalaryRange(details)
  const title = details?.title || job.title
  const companyName = details?.company || job.company
  const location = details?.location || job.location
  const postedLabel =
    postedLabelRef.current || job.postedDate || job.postedAt || details?.postedDate || details?.postedAt
  const logo = company?.logo || details?.companyLogo || job.companyLogo
  const skills = details?.skills?.length ? details.skills : job.skills
  const hasCookie = Boolean(normalizeLiAtCookie(settings?.liAtCookie))
  const hasFullCompanyDetails = hasRichCompanyDetails(company)
  const companyPrompt =
    company && !hasFullCompanyDetails && !companyLoading ?
      hasCookie && companyError ?
        'Company details could not be loaded. Try refreshing or re-saving your cookie in Settings.'
      : !hasCookie ?
        'Add your li_at cookie in Settings to see more company details.'
      : null
    : null

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

          {details && (
            <>
              <section className="modal-section">
                <h3 className="modal-section-title">Overview</h3>
                <div className="detail-chips">
                  <DetailChip label="Employment" value={details.employmentType} />
                  <DetailChip label="Seniority" value={formatDisplayValue(details.experienceLevel)} />
                  <DetailChip label="Function" value={details.jobFunction} />
                  <DetailChip label="Industry" value={details.industry} />
                  <DetailChip label="Education" value={details.educationLevel} />
                  <DetailChip label="Salary" value={salary} />
                  <DetailChip label="Search keyword" value={details.keyword || job.keyword} />
                  <DetailChip label="Workplace" value={details.workplace || job.workplace} />
                  <DetailChip label="Work type" value={details.workType || job.workType} />
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
                  <DetailChip label="Posted" value={postedLabel} />
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
                {payload.companyError && !company && !companyLoading && !companyError && (
                  <p className="modal-muted">
                    Some company details are unavailable.
                  </p>
                )}
                {companyLoading && !company && (
                  <p className="modal-muted">
                    Loading company details…
                  </p>
                )}
                {companyError && !company && !companyLoading && (
                  <div className="modal-muted">
                    <p>Company details could not be loaded right now.</p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => loadCompanyDetails(details, { attempts: 1, force: true })}
                    >
                      Retry Company Details
                    </button>
                  </div>
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
                      <CompanyFact label="Phone" value={company.phone} />
                    </dl>
                    {company.description && (
                      <p className="company-about">{company.description}</p>
                    )}
                    {!hasFullCompanyDetails && (companyLoading || companyError) && (
                      <div className="company-detail-status">
                        <span className="company-detail-status-text">
                          {companyLoading ?
                            'Loading more company details…'
                          : companyPrompt ||
                            'Could not load more company details right now.'}
                        </span>
                        {companyError && !companyLoading && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => loadCompanyDetails(details, { attempts: 1, force: true })}
                          >
                            Try again
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  !payload.companyError && !companyLoading && !companyError && (
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
