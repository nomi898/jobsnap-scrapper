import { resolveJobUrl } from './cleanJobFields'
import { normalizeLiAtCookie } from './linkedinCookie'

function buildFallbackCompany(job, details = {}) {
  const fallback = {
    name: details.company || job.company,
    logo: details.companyLogo || job.companyLogo,
    website: job.companyWebsite,
    phone: job.companyPhone,
    industry: details.industry || job.industry,
    companySize: job.companySizeCount,
    companySizeLabel: job.companySize,
    headquarters: job.headquarters,
    organizationType: job.organizationType,
    founded: job.founded,
    specialties: job.specialties,
    description: job.companyDescription,
    linkedInUrl: details.companyUrl || job.companyLinkedIn || job.companyUrl,
  }

  return Object.values(fallback).some(Boolean) ? fallback : null
}

export async function fetchJobDetails(job, settings = {}) {
  const jobUrl = resolveJobUrl(job)
  if (!jobUrl) {
    throw new Error('This job does not have a LinkedIn URL.')
  }

  const cookie = normalizeLiAtCookie(settings.liAtCookie)

  let response
  try {
    response = await fetch('/api/fetch-job-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobUrl,
        companyUrl: job.companyUrl,
        fallbackCompany: buildFallbackCompany(job),
        includeCompany: false,
        ...(cookie ? { liAtCookie: cookie } : {}),
      }),
    })
  } catch {
    throw new Error(
      'Network error — could not reach the job details API. Restart the dev server and try again.'
    )
  }

  const data = await response.json()
  const errorText = String(data.error || data.details || '')
  console.info('[job-detail-fetch]', {
    jobId: data.details?.jobId ?? job.id ?? null,
    jobTitle: job.title,
    status: response.status,
    blocked: /blocked|empty|rate|auth|login/i.test(errorText),
    authwallDetected: /auth|login|li_at|cookie/i.test(errorText),
    cacheHit: false,
    cacheMiss: true,
    hasDetails: Boolean(data.details),
    hasDescription: Boolean(data.details?.description || data.details?.descriptionHtml),
    cooldownRemainingMs: data.cooldownRemainingMs ?? null,
    error: errorText || null,
  })

  if (!response.ok) {
    const error = new Error(
      data.error || data.details || 'Failed to load job details from LinkedIn.'
    )
    error.cooldownRemainingMs = data.cooldownRemainingMs ?? null
    throw error
  }

  return {
    details: data.details ?? null,
    company: data.company ?? null,
    companyUrl: data.companyUrl ?? null,
    companyError: data.companyError ?? null,
    job: data.job ?? null,
    warning: data.warning ?? null,
    cookieRejected: Boolean(data.cookieRejected),
  }
}

export async function fetchCompanyDetailsForJob(job, details = {}, settings = {}) {
  const companyUrl =
    details.companyUrl ||
    details.linkedInUrl ||
    job.companyLinkedIn ||
    job.companyUrl

  if (!companyUrl) {
    return {
      company: buildFallbackCompany(job, details),
      companyError: 'Some company details are unavailable.',
    }
  }

  const cookie = normalizeLiAtCookie(settings.liAtCookie)
  let response
  try {
    response = await fetch('/api/fetch-company-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyUrl,
        fallbackCompany: buildFallbackCompany(job, details),
        ...(cookie ? { liAtCookie: cookie } : {}),
      }),
    })
  } catch {
    return {
      company: buildFallbackCompany(job, details),
      companyError: 'Company details could not be loaded right now.',
    }
  }

  const data = await response.json()
  if (!response.ok) {
    return {
      company: data.company ?? buildFallbackCompany(job, details),
      companyError: 'Company details could not be loaded right now.',
    }
  }

  return {
    company: data.company ?? buildFallbackCompany(job, details),
    companyError: data.companyError ?? null,
    cookieRejected: Boolean(data.cookieRejected),
  }
}

export function formatSalaryRange(details) {
  if (!details) return null
  if (details.salaryText) return details.salaryText

  const { salaryMin, salaryMax, currency } = details
  if (salaryMin == null && salaryMax == null) return null

  const symbol =
    currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : ''

  const format = (value) =>
    `${symbol}${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  if (salaryMin != null && salaryMax != null && salaryMin !== salaryMax) {
    return `${format(salaryMin)} - ${format(salaryMax)}`
  }

  return format(salaryMin ?? salaryMax)
}
