import * as cheerio from 'cheerio'
import { cleanLinkedInUrl } from './linkedinHtmlScraper.js'
import { parseCompanySizeFromHtml } from './companySize.js'
import {
  fetchLinkedInPage,
  isBlockedLinkedInResponse,
  resolveLinkedInSession,
} from './linkedinHttp.js'
import { extractCompanyId } from '../src/utils/jobSchema.js'

const REQUEST_TIMEOUT_MS = 15000

function cleanText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function readAboutField($, testId) {
  return cleanText($(`[data-test-id="${testId}"]`).find('dd').first().text())
}

function parseOrganizationJsonLd($) {
  let organization = null

  $('script[type="application/ld+json"]').each((_index, element) => {
    if (organization) return

    try {
      const data = JSON.parse($(element).html() ?? '')
      const items = Array.isArray(data['@graph'])
        ? data['@graph']
        : Array.isArray(data)
          ? data
          : [data]

      organization =
        items.find((item) => item?.['@type'] === 'Organization') ?? organization
    } catch {
      // ignore invalid JSON-LD blocks
    }
  })

  return organization
}

function formatHeadquarters(address) {
  if (!address || typeof address !== 'object') return null

  const parts = [
    address.addressLocality,
    address.addressRegion,
    address.addressCountry,
  ]
    .map((part) => cleanText(part))
    .filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

export function parseCompanyDetailsFromHtml(html, companyUrl) {
  const $ = cheerio.load(html)
  const organization = parseOrganizationJsonLd($)

  const name =
    cleanText(organization?.name) ||
    cleanText($('h1.top-card-layout__title, h1.org-top-card-summary__title').first().text()) ||
    null

  const description =
    cleanText(organization?.description) ||
    cleanText($('[data-test-id="about-us__description"]').text()) ||
    null

  const website =
    cleanText(organization?.sameAs) ||
    cleanText($('[data-test-id="about-us__website"] a').first().text()) ||
    null

  const logo =
    organization?.logo?.contentUrl ||
    $('img.org-top-card-primary-content__logo').attr('src') ||
    $('img.top-card-layout__entity-image').attr('data-delayed-url') ||
    null

  const employeeCount = organization?.numberOfEmployees?.value
  const parsedSize = Number.isFinite(employeeCount)
    ? employeeCount
    : parseCompanySizeFromHtml(html)

  const companySizeLabel = readAboutField($, 'about-us__size') || null

  const resolvedUrl = cleanLinkedInUrl(companyUrl)

  return {
    companyId: extractCompanyId(resolvedUrl),
    name,
    companyUrl: resolvedUrl,
    website,
    logo,
    description,
    industry: readAboutField($, 'about-us__industry') || null,
    companySize: parsedSize,
    companySizeLabel,
    headquarters:
      formatHeadquarters(organization?.address) ||
      readAboutField($, 'about-us__headquarters') ||
      null,
    organizationType: readAboutField($, 'about-us__organizationType') || null,
    founded: readAboutField($, 'about-us__foundedOn') || null,
    specialties: readAboutField($, 'about-us__specialties') || null,
    linkedInUrl: resolvedUrl,
  }
}

export async function fetchCompanyDetails(companyUrl, liAtCookie) {
  const url = cleanLinkedInUrl(companyUrl)
  if (!url) {
    return { error: 'Company URL is required' }
  }

  const page = await fetchLinkedInPage(url, {
    liAtCookie,
    timeoutMs: REQUEST_TIMEOUT_MS,
    fallbackToGuest: true,
  })

  if (page.error) {
    return { error: page.error }
  }

  if (isBlockedLinkedInResponse(page.html, page.status)) {
    return {
      error:
        'LinkedIn blocked or returned an empty company page. Clear the li_at cookie in Settings and try again.',
    }
  }

  let company = parseCompanyDetailsFromHtml(page.html, url)
  let cookieRejected = page.cookieRejected
  const hasCookie = Boolean(resolveLinkedInSession(liAtCookie).cookie)

  const missingCoreDetails = !company.name && !company.description
  const missingSize = company.companySize == null

  if (hasCookie && page.usedCookie && (missingCoreDetails || missingSize)) {
    const guestPage = await fetchLinkedInPage(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      forceGuest: true,
    })

    if (
      !guestPage.error &&
      !isBlockedLinkedInResponse(guestPage.html, guestPage.status)
    ) {
      const guestCompany = parseCompanyDetailsFromHtml(guestPage.html, url)
      company = {
        ...guestCompany,
        ...company,
        companySize: company.companySize ?? guestCompany.companySize,
        companySizeLabel:
          company.companySizeLabel ?? guestCompany.companySizeLabel,
        name: company.name ?? guestCompany.name,
        description: company.description ?? guestCompany.description,
        industry: company.industry ?? guestCompany.industry,
        website: company.website ?? guestCompany.website,
        headquarters: company.headquarters ?? guestCompany.headquarters,
      }
    }
  }

  if (!company.name && !company.description) {
    return {
      error:
        'Could not parse company details from LinkedIn. Check your li_at cookie format in Settings.',
    }
  }

  return { company, cookieRejected }
}
