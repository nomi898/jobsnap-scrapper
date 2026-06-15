import { fetchCompanyDetails } from './company.js'
import { fetchJobDetails } from './job.js'
import { cleanLinkedInUrl } from '../scrape/html.js'
import { mergeToApifyJob } from '../../../src/utils/jobSchema.js'

export async function fetchJobAndCompanyDetails({
  jobUrl,
  companyUrl,
  liAtCookie,
}) {
  const jobResult = await fetchJobDetails(jobUrl, liAtCookie)
  if (jobResult.error) {
    return { status: 502, data: { error: jobResult.error } }
  }

  const resolvedCompanyUrl = cleanLinkedInUrl(
    companyUrl || jobResult.details?.companyUrl
  )

  let company = null
  let companyError = null
  let companyCookieRejected = false

  if (resolvedCompanyUrl) {
    const companyResult = await fetchCompanyDetails(
      resolvedCompanyUrl,
      liAtCookie
    )
    if (companyResult.error) {
      companyError = companyResult.error
    } else {
      company = companyResult.company
      companyCookieRejected = Boolean(companyResult.cookieRejected)
    }
  }

  const job = mergeToApifyJob(
    { url: jobUrl, companyUrl: resolvedCompanyUrl },
    jobResult.details,
    company ?? {}
  )

  const cookieRejected = Boolean(
    jobResult.cookieRejected || companyCookieRejected
  )
  const warning =
    companyError &&
    /cookie|li_at|blocked/i.test(companyError)
      ? companyError
      : null

  return {
    status: 200,
    data: {
      details: jobResult.details,
      company,
      companyError,
      job,
      warning,
      cookieRejected,
      accessMode: jobResult.accessMode,
    },
  }
}
