import * as cheerio from 'cheerio'
import { cleanLinkedInUrl } from '../scrape/html.js'
import {
  fetchLinkedInPage,
  isBlockedLinkedInResponse,
} from '../linkedin/http.js'
import {
  normalizeExperienceLevel,
  parseDescriptionExtras,
  parseJobPostingJsonLd,
} from '../../../src/utils/jobSchema.js'

const GUEST_JOB_POSTING_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting'
const REQUEST_TIMEOUT_MS = 20000

function cleanText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

export function extractJobIdFromUrl(url) {
  const raw = String(url ?? '')
  const patterns = [
    /jobs\/view\/[^/?#]*-(\d{6,})/i,
    /jobs\/view\/(\d{6,})/i,
    /jobPosting[:\/](\d{6,})/i,
    /(\d{8,})/,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

export function parseSalaryRange(text) {
  const salaryText = cleanText(text)
  if (!salaryText) {
    return {
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      currency: null,
    }
  }

  let currency = null
  if (/£/.test(salaryText)) currency = 'GBP'
  else if (/\$/.test(salaryText)) currency = 'USD'
  else if (/€/.test(salaryText)) currency = 'EUR'

  const numbers = [...salaryText.matchAll(/[\d,]+(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)

  return {
    salaryText,
    salaryMin: numbers[0] ?? null,
    salaryMax: numbers[1] ?? numbers[0] ?? null,
    currency,
  }
}

export function parseJobDetailsFromHtml(html, jobUrl) {
  const $ = cheerio.load(html)
  const title = cleanText(
    $('.topcard__title, .top-card-layout__title').first().text()
  )
  const company = cleanText($('.topcard__org-name-link').first().text())
  const companyUrl = cleanLinkedInUrl(
    $('.topcard__org-name-link').first().attr('href')
  )
  const companyLogo =
    $('img.artdeco-entity-image').first().attr('data-delayed-url') ||
    $('img.artdeco-entity-image').first().attr('src') ||
    null

  const location = cleanText(
    $('.topcard__flavor-row')
      .first()
      .find('.topcard__flavor--bullet')
      .first()
      .text()
  )
  const postedDate = cleanText($('.posted-time-ago__text').first().text())

  const applicantText = cleanText($('.num-applicants__caption').first().text())
  const applicantMatch = applicantText.match(/([\d,]+)\s*applicants?/i)
  const applicantCount = applicantMatch
    ? Number(applicantMatch[1].replace(/,/g, ''))
    : null

  const descriptionHtml =
    $('.show-more-less-html__markup').first().html()?.trim() || ''
  const description = cleanText($('.show-more-less-html__markup').first().text())

  const salary = parseSalaryRange(
    $('.salary.compensation__salary, .compensation__salary').first().text()
  )

  const criteria = {}
  $('.description__job-criteria-item').each((_index, element) => {
    const $item = $(element)
    const label = cleanText(
      $item.find('.description__job-criteria-subheader').text()
    ).toLowerCase()
    const value = cleanText(
      $item.find('.description__job-criteria-text').first().text()
    )
    if (!value) return

    if (label.includes('seniority')) criteria.experienceLevel = value
    else if (label.includes('employment')) criteria.employmentType = value
    else if (label.includes('job function')) criteria.jobFunction = value
    else if (label.includes('industr')) criteria.industry = value
    else if (label.includes('education')) criteria.educationLevel = value
  })

  const recruiterName =
    cleanText($('.message-the-recruiter .base-main-card__title').first().text()) ||
    null

  const resolvedUrl = cleanLinkedInUrl(jobUrl)
  const jsonLd = parseJobPostingJsonLd(html)
  const descExtras = parseDescriptionExtras(description)

  return {
    jobId: extractJobIdFromUrl(resolvedUrl),
    title,
    company,
    companyUrl,
    companyLogo,
    location,
    postedDate,
    postedAt: jsonLd.postedAt,
    expiresAt: jsonLd.expiresAt,
    applicantCount,
    description,
    descriptionHtml,
    salaryText: salary.salaryText,
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    currency: salary.currency,
    experienceLevel:
      normalizeExperienceLevel(criteria.experienceLevel) ?? null,
    employmentType: criteria.employmentType ?? null,
    jobFunction: criteria.jobFunction ?? null,
    industry: criteria.industry ?? null,
    educationLevel: criteria.educationLevel ?? null,
    requirements: descExtras.requirements,
    benefits: descExtras.benefits,
    skills: descExtras.skills,
    visaSponsorship: descExtras.visaSponsorship,
    recruiterName,
    applyUrl: resolvedUrl,
    jsonLd,
  }
}

export async function fetchJobDetails(jobUrl, liAtCookie) {
  const resolvedUrl = cleanLinkedInUrl(jobUrl)
  const jobId = extractJobIdFromUrl(resolvedUrl)

  if (!jobId) {
    return { error: 'Could not determine LinkedIn job ID from URL' }
  }

  // jobs-guest job detail API — always guest; li_at can cause empty/blocked pages
  const page = await fetchLinkedInPage(`${GUEST_JOB_POSTING_URL}/${jobId}`, {
    referer: 'https://www.linkedin.com/jobs/search/',
    timeoutMs: REQUEST_TIMEOUT_MS,
    forceGuest: true,
  })

  if (page.error) {
    return { error: page.error }
  }

  if (isBlockedLinkedInResponse(page.html, page.status)) {
    return {
      error:
        'LinkedIn blocked or returned an empty job page. Wait a few minutes, or clear the li_at cookie in Settings and try again.',
    }
  }

  const details = parseJobDetailsFromHtml(page.html, resolvedUrl)
  if (!details.title && !details.description) {
    return {
      error:
        'Could not parse job details from LinkedIn. If you added a li_at cookie, paste only the value (not li_at=) or leave it blank.',
    }
  }

  return {
    details,
    cookieRejected: page.cookieRejected,
    accessMode: page.accessMode,
  }
}
