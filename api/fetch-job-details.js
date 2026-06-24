import { fetchCompanyDetails } from './companyDetails.js'
import { fetchJobDetails } from './jobDetails.js'
import { cleanLinkedInUrl } from './linkedinHtmlScraper.js'
import { resolveRequestLiAtCookie } from './linkedinHttp.js'
import { mergeToApifyJob } from '../src/utils/jobSchema.js'

function compactCompany(company = {}) {
  const fields = {
    name: company.name ?? null,
    logo: company.logo ?? null,
    website: company.website ?? null,
    industry: company.industry ?? null,
    companySize: company.companySize ?? null,
    companySizeLabel: company.companySizeLabel ?? null,
    phone: company.phone ?? null,
    headquarters: company.headquarters ?? null,
    organizationType: company.organizationType ?? null,
    founded: company.founded ?? null,
    specialties: company.specialties ?? null,
    description: company.description ?? null,
    linkedInUrl: cleanLinkedInUrl(company.linkedInUrl) || null,
  }
  const compacted = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value != null && value !== '')
  )

  return Object.values(compacted).some(Boolean) ? compacted : null
}

function mergeCompanyData(fallbackCompany, enrichedCompany, linkedInUrl) {
  const fallback = compactCompany(fallbackCompany)
  const enriched = compactCompany(enrichedCompany)
  const merged =
    fallback || enriched ?
      {
        ...(fallback ?? {}),
        ...(enriched ?? {}),
        linkedInUrl:
          enriched?.linkedInUrl ||
          fallback?.linkedInUrl ||
          cleanLinkedInUrl(linkedInUrl) ||
          null,
      }
    : null

  return compactCompany(merged)
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({ error: message }), ms)
    }),
  ])
}

export async function fetchJobAndCompanyDetails({
  jobUrl,
  companyUrl,
  liAtCookie,
  fallbackCompany,
  includeCompany = true,
}) {
  const jobResult = await fetchJobDetails(jobUrl, liAtCookie)
  if (jobResult.error) {
    return {
      status: 502,
      data: {
        error: jobResult.error,
        cooldownRemainingMs: jobResult.cooldownRemainingMs ?? null,
      },
    }
  }

  const resolvedCompanyUrl = cleanLinkedInUrl(
    companyUrl || fallbackCompany?.linkedInUrl || jobResult.details?.companyUrl
  )

  let company = mergeCompanyData(
    fallbackCompany,
    {
      name: jobResult.details?.company,
      logo: jobResult.details?.companyLogo,
      industry: jobResult.details?.industry,
      website: jobResult.details?.companyWebsite,
      companySizeLabel: jobResult.details?.companySizeLabel,
      headquarters: jobResult.details?.headquarters,
      organizationType: jobResult.details?.organizationType,
      founded: jobResult.details?.founded,
      linkedInUrl: resolvedCompanyUrl,
    },
    resolvedCompanyUrl
  )
  let companyError = company ? null : 'Some company details unavailable.'
  let companyCookieRejected = false

  if (includeCompany && resolvedCompanyUrl) {
    const companyResult = await fetchCompanyDetails(
      resolvedCompanyUrl,
      liAtCookie
    )
    if (companyResult.error) {
      companyError = company ? null : 'Some company details unavailable.'
    } else {
      company = mergeCompanyData(company, companyResult.company, resolvedCompanyUrl)
      companyError = null
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
  return {
    status: 200,
    data: {
      details: jobResult.details,
      company,
      companyUrl: resolvedCompanyUrl,
      companyError,
      job,
      warning: jobResult.warning ?? null,
      cookieRejected,
      accessMode: jobResult.accessMode,
    },
  }
}

export async function fetchCompanyDetailsForModal({
  companyUrl,
  liAtCookie,
  fallbackCompany,
}) {
  const resolvedCompanyUrl = cleanLinkedInUrl(
    companyUrl || fallbackCompany?.linkedInUrl
  )
  let company = null
  let companyError = 'Company details could not be loaded right now.'
  let companyCookieRejected = false

  if (resolvedCompanyUrl) {
    const companyResult = await withTimeout(
      fetchCompanyDetails(resolvedCompanyUrl, liAtCookie),
      20000,
      'Company details request timed out.'
    )
    company = mergeCompanyData(fallbackCompany, companyResult.company, resolvedCompanyUrl)
    if (companyResult.error) {
      companyError = company ? 'Company details could not be loaded right now.' : companyError
    } else {
      companyError = null
      companyCookieRejected = Boolean(companyResult.cookieRejected)
    }
  } else {
    company = mergeCompanyData(fallbackCompany, null, resolvedCompanyUrl)
    companyError = company ? null : companyError
  }

  return {
    status: 200,
    data: {
      company,
      companyError,
      cookieRejected: companyCookieRejected,
    },
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body ?? {}
  const session = resolveRequestLiAtCookie(body.liAtCookie)
  const { status, data } = await fetchJobAndCompanyDetails({
    jobUrl: body.jobUrl ?? body.url,
    companyUrl: body.companyUrl,
    liAtCookie: session.cookie,
    fallbackCompany: body.fallbackCompany,
    includeCompany: body.includeCompany !== false,
  })

  res.status(status).json(data)
}
