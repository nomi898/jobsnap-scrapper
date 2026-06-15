import {
  cleanLinkedInUrl,
  cleanText,
  parseCompanyField,
  resolveJobUrl,
} from './cleanJobFields.js'
import {
  extractCompanyId,
  formatCompanySizeBand,
  mergeToApifyJob,
  normalizePostedAt,
  parseLocationParts,
  toRemoteBoolean,
} from './jobSchema.js'

const APIFY_FIELDS = [
  'companyId',
  'companySize',
  'companySizeCount',
  'city',
  'country',
  'salaryMin',
  'salaryMax',
  'currency',
  'employmentType',
  'experienceLevel',
  'remote',
  'description',
  'descriptionHtml',
  'requirements',
  'skills',
  'benefits',
  'industry',
  'postedAt',
  'expiresAt',
  'applyUrl',
  'companyWebsite',
  'companyLogo',
  'companyLinkedIn',
  'applicantCount',
  'jobFunction',
  'educationLevel',
  'visaSponsorship',
  'recruiterName',
  'detailsLoadedAt',
  'companyDescription',
  'headquarters',
  'organizationType',
  'founded',
  'specialties',
  'postedAtIso',
]

function pickDefinedFields(source, fields) {
  const picked = {}
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) {
      picked[field] = source[field]
    }
  }
  return picked
}

export function enrichJobListing(job) {
  const companyUrl = cleanLinkedInUrl(job.companyUrl)
  const location = cleanText(job.location)
  const { city, country } = parseLocationParts(location)
  const rawSize = Number(job.companySizeCount ?? job.companySize)
  const companySizeCount =
    Number.isFinite(rawSize) && rawSize > 0 ? rawSize : job.companySizeCount ?? null
  const companySizeBand =
    (typeof job.companySize === 'string' &&
      /\d/.test(job.companySize) &&
      !Number.isFinite(Number(job.companySize)) &&
      job.companySize) ||
    formatCompanySizeBand(companySizeCount, job.companySizeLabel)

  return {
    ...job,
    companyId: job.companyId ?? extractCompanyId(companyUrl),
    city: job.city ?? city,
    country: job.country ?? country,
    remote:
      job.remote ?? toRemoteBoolean(job.workType, location, job.workplace),
    postedAt:
      normalizePostedAt({
        postedAt: job.postedAt,
        postedAtIso: job.postedAtIso,
        postedDate: job.postedDate,
      }) ?? job.postedAt ?? null,
    companySizeCount,
    companySize: companySizeBand,
    companyLinkedIn: job.companyLinkedIn ?? companyUrl ?? null,
    applyUrl: job.applyUrl ?? resolveJobUrl(job) ?? null,
  }
}

export function normalizeJob(job) {
  const { company, companyUrl } = parseCompanyField(
    job.company,
    job.companyUrl ?? job.companyLink ?? job.company_url
  )
  const postedDate = cleanText(
    job.postedDate ?? job.posted_date ?? job.postedDateAttr ?? job.date
  )
  const keyword = cleanText(job.keyword ?? job.keywordRaw ?? job.searchKeyword)
  const url = resolveJobUrl(job)
  const id =
    String(job.id ?? job.jobId ?? '').trim() ||
    url ||
    `${job.title}-${company}-${postedDate}`

  const base = {
    id,
    title: cleanText(job.title),
    company,
    companyUrl,
    location: cleanText(job.location),
    workplace: cleanText(job.workplace),
    workType: job.workType ?? '',
    companySize: job.companySize ?? null,
    postedDate,
    keyword,
    url,
    ...pickDefinedFields(job, APIFY_FIELDS),
  }

  return enrichJobListing(base)
}

export function mergeJobWithFetchedDetails(job, details, company) {
  const merged = mergeToApifyJob(job, details, company)
  const url = resolveJobUrl(job) || merged.applyUrl

  return normalizeJob({
    ...job,
    ...merged,
    id: job.id || merged.id,
    url,
    keyword: job.keyword,
    workplace: job.workplace ?? merged.workplace,
    workType: job.workType ?? merged.workType,
    postedDate: job.postedDate || merged.postedDate,
    detailsLoadedAt: new Date().toISOString(),
  })
}
