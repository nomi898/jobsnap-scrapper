import * as cheerio from 'cheerio'
import { cleanLinkedInUrl } from './linkedinHtmlScraper.js'
import {
  fetchLinkedInPage,
  isBlockedLinkedInResponse,
  resolveLinkedInSession,
} from './linkedinHttp.js'
import {
  normalizeExperienceLevel,
  parseDescriptionExtras,
  parseJobPostingJsonLd,
} from '../src/utils/jobSchema.js'

const GUEST_JOB_POSTING_URL =
  'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting'
const JOB_VIEW_URL = 'https://www.linkedin.com/jobs/view'
const REQUEST_TIMEOUT_MS = 20000
const DETAIL_AUTHWALL_COOLDOWN_MIN_MS = 45 * 1000
const DETAIL_AUTHWALL_COOLDOWN_MAX_MS = 90 * 1000

const jobDetailCooldowns = new Map()

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function startJobDetailCooldown(jobId, reason) {
  const delayMs = randomBetween(
    DETAIL_AUTHWALL_COOLDOWN_MIN_MS,
    DETAIL_AUTHWALL_COOLDOWN_MAX_MS
  )
  jobDetailCooldowns.set(jobId, {
    until: Date.now() + delayMs,
    reason,
  })
  return delayMs
}

function getJobDetailCooldown(jobId) {
  const cooldown = jobDetailCooldowns.get(jobId)
  if (!cooldown) {
    return { remainingMs: 0, reason: null }
  }

  const remainingMs = Math.max(0, cooldown.until - Date.now())
  if (remainingMs <= 0) {
    jobDetailCooldowns.delete(jobId)
    return { remainingMs: 0, reason: null }
  }

  return { remainingMs, reason: cooldown.reason }
}

function cleanText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function readJsonStringField(html, names) {
  const pattern = new RegExp(
    `"(?:${names.join('|')})"\\s*:\\s*"([^"]+)"`,
    'i'
  )
  const rawValue = String(html ?? '').match(pattern)?.[1]
  if (!rawValue) return null

  try {
    return cleanText(JSON.parse(`"${rawValue.replace(/"/g, '\\"')}"`))
  } catch {
    return cleanText(rawValue.replace(/\\u002F/g, '/'))
  }
}

function parseCompanyHintsFromJobHtml(html) {
  const text = String(html ?? '')
  const companySizeText =
    readJsonStringField(text, ['companySize', 'companySizeLabel', 'employeeCountRange']) ||
    cleanText(
      text.match(/(?:company size|employees?)["':\s<>/\\-]+([0-9,]+\s*(?:-|to)\s*[0-9,]+\s+employees?)/i)?.[1]
    ) ||
    cleanText(
      text.match(/([0-9,]+\s*(?:-|to)\s*[0-9,]+\s+employees?)/i)?.[1]
    )
  const website =
    readJsonStringField(text, ['website', 'websiteUrl', 'sameAs']) ||
    cleanText(text.match(/https?:\/\/(?![^"'\s]*linkedin\.com)[^"'\s<]+/i)?.[0])
  const validWebsite =
    website &&
    !/linkedin\.com|licdn\.com|company-logo|logo_|static\.|media\./i.test(website) ?
      website
    : null

  return {
    companySizeLabel: companySizeText || null,
    companyWebsite: validWebsite,
    headquarters:
      readJsonStringField(text, ['headquarters', 'headquarter']) || null,
    organizationType:
      readJsonStringField(text, ['organizationType', 'companyType']) || null,
    founded: readJsonStringField(text, ['founded', 'foundedOn']) || null,
  }
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
  const resolvedUrl = cleanLinkedInUrl(jobUrl)
  const jsonLd = parseJobPostingJsonLd(html)
  const title = cleanText(
    $(
      '.topcard__title, .top-card-layout__title, .jobs-unified-top-card__job-title, h1'
    ).first().text()
  )
  const company = cleanText(
    $(
      '.topcard__org-name-link, .jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name'
    ).first().text()
  )
  const companyUrl = cleanLinkedInUrl(
    $('.topcard__org-name-link, .jobs-unified-top-card__company-name a')
      .first()
      .attr('href')
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
  ) || cleanText($('.jobs-unified-top-card__bullet').first().text())
  const postedDate = cleanText(
    $('.posted-time-ago__text, .jobs-unified-top-card__posted-date').first().text()
  )

  const applicantText = cleanText($('.num-applicants__caption').first().text())
  const applicantMatch = applicantText.match(/([\d,]+)\s*applicants?/i)
  const applicantCount = applicantMatch
    ? Number(applicantMatch[1].replace(/,/g, ''))
    : null

  const descriptionHtml =
    $(
      '.show-more-less-html__markup, .jobs-description__content, .jobs-box__html-content'
    ).first().html()?.trim() ||
    jsonLd.description ||
    ''
  const description =
    cleanText(
      $(
        '.show-more-less-html__markup, .jobs-description__content, .jobs-box__html-content'
      ).first().text()
    ) ||
    cleanText(jsonLd.description)

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
  $(
    '.job-details-jobs-unified-top-card__job-insight, .jobs-unified-top-card__job-insight'
  ).each((_index, element) => {
    const text = cleanText($(element).text())
    const lower = text.toLowerCase()
    if (!text) return
    if (
      lower.includes('full-time') ||
      lower.includes('part-time') ||
      lower.includes('contract')
    ) {
      criteria.employmentType ??= text
    } else if (
      lower.includes('associate') ||
      lower.includes('entry') ||
      lower.includes('senior') ||
      lower.includes('mid')
    ) {
      criteria.experienceLevel ??= text
    }
  })

  const recruiterName =
    cleanText($('.message-the-recruiter .base-main-card__title').first().text()) ||
    null

  const descExtras = parseDescriptionExtras(description)
  const companyHints = parseCompanyHintsFromJobHtml(html)

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
    companyWebsite: companyHints.companyWebsite,
    companySizeLabel: companyHints.companySizeLabel,
    headquarters: companyHints.headquarters,
    organizationType: companyHints.organizationType,
    founded: companyHints.founded,
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

function parseUsableJobDetails(html, jobUrl) {
  const details = parseJobDetailsFromHtml(html, jobUrl)
  return {
    details,
    usable: Boolean(details.title || details.description || details.descriptionHtml),
  }
}

export async function fetchJobDetails(jobUrl, liAtCookie) {
  const resolvedUrl = cleanLinkedInUrl(jobUrl)
  const jobId = extractJobIdFromUrl(resolvedUrl)

  if (!jobId) {
    return { error: 'Could not determine LinkedIn job ID from URL' }
  }

  const session = resolveLinkedInSession(liAtCookie)
  const detailCooldown = getJobDetailCooldown(jobId)
  const cooldownRemainingMs = detailCooldown.remainingMs

  if (cooldownRemainingMs > 0) {
    console.info('[job-detail-fetch]', {
      jobId,
      status: 'skipped-cooldown',
      blocked: true,
      authwallDetected: true,
      cookieDetected: Boolean(session.cookie),
      cookieAttempted: false,
      cookieAccepted: false,
      fallbackToGuest: false,
      fallbackReason: detailCooldown.reason,
      cooldownRemainingMs,
    })
    return {
      error:
        'Job details are cooling down after LinkedIn authwall. Showing available details.',
      cooldownRemainingMs,
    }
  }

  if (session.cookie) {
    const viewUrl = `${JOB_VIEW_URL}/${jobId}`
    console.info('[job-detail-fetch]', {
      jobId,
      endpoint: 'jobs-view',
      event: 'jobsViewAttempt',
      requestUrl: viewUrl,
      referer: resolvedUrl || 'https://www.linkedin.com/jobs/',
      cookieDetected: true,
      cookieAttempted: true,
      fallbackToGuest: false,
      sessionSource: session.source,
    })
    const viewPage = await fetchLinkedInPage(viewUrl, {
      liAtCookie,
      referer: resolvedUrl || 'https://www.linkedin.com/jobs/',
      timeoutMs: REQUEST_TIMEOUT_MS,
      fallbackToGuest: false,
    })

    if (!viewPage.error && !isBlockedLinkedInResponse(viewPage.html, viewPage.status)) {
      const { details, usable } = parseUsableJobDetails(viewPage.html, resolvedUrl)
      console.info('[job-detail-fetch]', {
        jobId,
        endpoint: 'jobs-view',
        event: 'jobsViewSuccess',
        requestUrl: viewPage.requestUrl ?? viewUrl,
        responseUrl: viewPage.responseUrl ?? viewPage.finalUrl,
        redirected: Boolean(viewPage.redirected),
        status: viewPage.status,
        finalUrl: viewPage.finalUrl,
        htmlLength: String(viewPage.html ?? '').length,
        blocked: false,
        authwallDetected: false,
        cookieDetected: true,
        cookieAttempted: true,
        cookieAccepted: viewPage.accessMode === 'session' && !viewPage.cookieRejected,
        fallbackToGuest: false,
        fallbackReason: null,
        accessMode: viewPage.accessMode,
        sessionSource: viewPage.sessionSource ?? session.source,
        cookieRejected: Boolean(viewPage.cookieRejected),
        hasTitle: Boolean(details.title),
        hasDescription: Boolean(details.description || details.descriptionHtml),
        usable,
        companyUrl: details.companyUrl ?? null,
      })

      if (usable) {
        return {
          details,
          cookieRejected: viewPage.cookieRejected,
          accessMode: viewPage.accessMode,
          endpoint: 'jobs-view',
        }
      }
    } else {
      const blocked = viewPage.error ? false : isBlockedLinkedInResponse(viewPage.html, viewPage.status)
      console.info('[job-detail-fetch]', {
        jobId,
        endpoint: 'jobs-view',
        event: 'jobsViewFailure',
        requestUrl: viewPage.requestUrl ?? viewUrl,
        responseUrl: viewPage.responseUrl ?? viewPage.finalUrl ?? null,
        redirected: Boolean(viewPage.redirected),
        status: viewPage.error ? 0 : viewPage.status,
        finalUrl: viewPage.finalUrl,
        htmlLength: String(viewPage.html ?? '').length,
        blocked,
        authwallDetected: /authwall|login|uas\/login|session_redirect/i.test(
          String(viewPage.html ?? '') + String(viewPage.finalUrl ?? '')
        ),
        cookieDetected: true,
        cookieAttempted: true,
        cookieAccepted: false,
        fallbackToGuest: false,
        fallbackReason: viewPage.fallbackReason ?? null,
        accessMode: viewPage.accessMode ?? session.mode,
        sessionSource: viewPage.sessionSource ?? session.source,
        cookieRejected: Boolean(viewPage.cookieRejected),
        error: viewPage.error ?? null,
        errorName: viewPage.errorName ?? null,
        errorMessage: viewPage.errorMessage ?? null,
        errorCause: viewPage.errorCause ?? null,
      })
    }
  }

  const page = await fetchLinkedInPage(`${GUEST_JOB_POSTING_URL}/${jobId}`, {
    liAtCookie,
    referer: resolvedUrl || 'https://www.linkedin.com/jobs/search/',
    timeoutMs: REQUEST_TIMEOUT_MS,
    fallbackToGuest: !session.cookie,
  })

  if (page.error) {
    console.info('[job-detail-fetch]', {
      jobId,
      status: 0,
      blocked: false,
      authwallDetected: false,
      cookieDetected: Boolean(session.cookie),
      cookieAttempted: Boolean(session.cookie),
      cookieAccepted: false,
      fallbackToGuest: false,
      fallbackReason: page.fallbackReason ?? null,
      accessMode: page.accessMode ?? session.mode,
      sessionSource: session.source,
      cookieRejected: Boolean(page.cookieRejected),
      error: page.error,
    })
    return { error: page.error }
  }

  if (isBlockedLinkedInResponse(page.html, page.status)) {
    const cooldownMs = startJobDetailCooldown(jobId, 'authwall')
    const { details, usable } = parseUsableJobDetails(page.html, resolvedUrl)
    console.info('[job-detail-fetch]', {
      jobId,
      status: page.status,
      finalUrl: page.finalUrl,
      htmlLength: String(page.html ?? '').length,
      blocked: true,
      authwallDetected: /authwall|login|uas\/login|session_redirect/i.test(
        String(page.html ?? '') + String(page.finalUrl ?? '')
      ),
      cookieDetected: Boolean(session.cookie),
      cookieAttempted: Boolean(session.cookie),
      cookieAccepted:
        Boolean(session.cookie) &&
        page.accessMode === 'session' &&
        !page.cookieRejected,
      fallbackToGuest: Boolean(
        session.cookie && page.accessMode === 'guest'
      ),
      fallbackReason: page.fallbackReason ?? null,
      sessionAttempt: page.sessionAttempt ?? null,
      accessMode: page.accessMode,
      sessionSource: page.sessionSource ?? session.source,
      cookieRejected: Boolean(page.cookieRejected),
      cooldownMs,
      hasTitle: Boolean(details.title),
      hasDescription: Boolean(details.description || details.descriptionHtml),
      usable,
      partialDetailsReturned: usable,
    })
    if (usable) {
      return {
        details,
        cookieRejected: page.cookieRejected,
        accessMode: page.accessMode,
      }
    }
    return {
      error:
        'LinkedIn blocked or returned an empty job page. Wait a few minutes, or clear the li_at cookie in Settings and try again.',
      cooldownRemainingMs: cooldownMs,
    }
  }

  const { details } = parseUsableJobDetails(page.html, resolvedUrl)
  console.info('[job-detail-fetch]', {
    jobId,
    status: page.status,
    finalUrl: page.finalUrl,
    htmlLength: String(page.html ?? '').length,
    blocked: false,
    authwallDetected: false,
    cookieDetected: Boolean(session.cookie),
    cookieAttempted: Boolean(session.cookie),
    cookieAccepted:
      Boolean(session.cookie) &&
      page.accessMode === 'session' &&
      !page.cookieRejected,
    fallbackToGuest: Boolean(session.cookie && page.accessMode === 'guest'),
    fallbackReason: page.fallbackReason ?? null,
    sessionAttempt: page.sessionAttempt ?? null,
    accessMode: page.accessMode,
    sessionSource: page.sessionSource ?? session.source,
    cookieRejected: Boolean(page.cookieRejected),
    hasTitle: Boolean(details.title),
    hasDescription: Boolean(details.description || details.descriptionHtml),
    companyUrl: details.companyUrl ?? null,
  })
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
