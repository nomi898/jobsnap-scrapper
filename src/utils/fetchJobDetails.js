import { resolveJobUrl } from './cleanJobFields'
import { normalizeLiAtCookie } from './linkedinCookie'

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
        ...(cookie ? { liAtCookie: cookie } : {}),
      }),
    })
  } catch {
    throw new Error(
      'Network error — could not reach the job details API. Restart the dev server and try again.'
    )
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.error || data.details || 'Failed to load job details from LinkedIn.'
    )
  }

  return {
    details: data.details ?? null,
    company: data.company ?? null,
    companyError: data.companyError ?? null,
    job: data.job ?? null,
    warning: data.warning ?? null,
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
