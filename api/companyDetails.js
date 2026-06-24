import * as cheerio from 'cheerio'
import { cleanLinkedInUrl } from './linkedinHtmlScraper.js'
import { parseCompanySizeCountFromHtml, parseCompanySizeLabelFromHtml } from './companySize.js'
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

function decodeJsonValue(value) {
  if (!value) return null
  try {
    return JSON.parse(`"${String(value).replace(/"/g, '\\"')}"`)
  } catch {
    return value
  }
}

function readAboutField($, testId) {
  return cleanText($(`[data-test-id="${testId}"]`).find('dd').first().text())
}

function readLabeledField($, labels) {
  const normalizedLabels = labels.map((label) => label.toLowerCase())
  let value = null

  $('dt, h2, h3, h4, .text-heading-medium, .text-body-small').each((_index, element) => {
    if (value) return

    const label = cleanText($(element).text()).toLowerCase().replace(/:$/, '')
    if (!normalizedLabels.includes(label)) return

    const nextText =
      cleanText($(element).next('dd, div, p, span').text()) ||
      cleanText($(element).parent().find('dd, a, p').first().text())
    if (nextText && nextText.toLowerCase() !== label) {
      value = nextText
    }
  })

  return value
}

function readOverview($) {
  return (
    cleanText($('[data-test-id="about-us__description"]').text()) ||
    readLabeledField($, ['Overview', 'About']) ||
    cleanText(
      $('section')
        .filter((_index, element) =>
          /overview|about/i.test(cleanText($(element).find('h2, h3').first().text()))
        )
        .first()
        .find('p')
        .first()
        .text()
    ) ||
    null
  )
}

function readWebsite($, html, organization) {
  const sameAs = organization?.sameAs
  const organizationWebsite =
    Array.isArray(sameAs) ? sameAs.find(Boolean) : sameAs
  const explicitWebsite =
    cleanText($('[data-test-id="about-us__website"] a').first().text()) ||
    cleanText($('[data-test-id="about-us__website"] a').first().attr('href')) ||
    readLabeledField($, ['Website'])
  const linkedWebsite =
    $('a[href^="http"]')
      .toArray()
      .map((element) => cleanText($(element).attr('href')))
      .find((href) => href && !/linkedin\.com/i.test(href))
  const jsonWebsite = String(html ?? '').match(
    /"(?:website|websiteUrl|sameAs)"\s*:\s*"([^"]+)"/i
  )?.[1]

  return (
    cleanText(
      organizationWebsite ||
        explicitWebsite ||
        linkedWebsite ||
        decodeJsonValue(jsonWebsite)
    ) || null
  )
}

function readLinkedInTextValue(value) {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number') {
    return cleanText(value)
  }
  if (Array.isArray(value)) {
    return cleanText(value.map(readLinkedInTextValue).filter(Boolean).join(' '))
  }
  if (typeof value !== 'object') return null

  return (
    readLinkedInTextValue(value.text) ||
    readLinkedInTextValue(value.localizedName) ||
    readLinkedInTextValue(value.localizedDescription) ||
    readLinkedInTextValue(value.description) ||
    readLinkedInTextValue(value.name) ||
    readLinkedInTextValue(value.value) ||
    null
  )
}

function readJsonTextField(html, names) {
  const pattern = new RegExp(
    `"(?:${names.join('|')})"\\s*:\\s*("(?:\\\\.|[^"])*"|[0-9]+)`,
    'i'
  )
  const rawValue = String(html ?? '').match(pattern)?.[1]
  if (!rawValue) return null

  try {
    return cleanText(JSON.parse(rawValue))
  } catch {
    return cleanText(rawValue.replace(/^"|"$/g, '').replace(/\\u002F/g, '/'))
  }
}

function readJsonObjectValue(html, names) {
  for (const name of names) {
    const pattern = new RegExp(
      `"${name}"\\s*:\\s*\\{[^{}]*(?:"text"|"localizedName"|"value"|"name")\\s*:\\s*("(?:\\\\.|[^"])*"|[0-9]+)[^{}]*\\}`,
      'i'
    )
    const rawValue = String(html ?? '').match(pattern)?.[1]
    if (!rawValue) continue
    try {
      return cleanText(JSON.parse(rawValue))
    } catch {
      return cleanText(rawValue.replace(/^"|"$/g, ''))
    }
  }

  return null
}

function isRealCompanyWebsite(url) {
  return Boolean(url) && !/linkedin\.com|licdn\.com|company-logo|logo_|static\.|media\./i.test(url)
}

function extractUniversalName(companyUrl) {
  const match = cleanLinkedInUrl(companyUrl).match(/\/company\/([^/?#]+)/i)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function formatStaffCountRange(range) {
  const start = range?.start ?? range?.staffCountRangeStart
  const end = range?.end ?? range?.staffCountRangeEnd
  if (!start && !end) return null
  if (start && end) return `${start.toLocaleString()}-${end.toLocaleString()} employees`
  if (start) return `${start.toLocaleString()}+ employees`
  return null
}

function findCompanyEntity(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)

  const looksLikeCompany =
    value.staffCountRange ||
    value.companyPageUrl ||
    value.websiteUrl ||
    value.headquarter ||
    value.companyType ||
    value.industries ||
    value.specialities ||
    value.specialties

  if (looksLikeCompany) return value

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCompanyEntity(item, seen)
      if (found) return found
    }
    return null
  }

  for (const nested of Object.values(value)) {
    const found = findCompanyEntity(nested, seen)
    if (found) return found
  }

  return null
}

function normalizeVoyagerCompany(entity, linkedInUrl) {
  if (!entity) return null
  const website = entity.companyPageUrl || entity.websiteUrl || entity.website
  const headquarters = entity.headquarter || entity.headquarters
  const industries = entity.industries || entity.companyIndustries
  const industry = Array.isArray(industries) ? industries.map(readLinkedInTextValue).find(Boolean) : readLinkedInTextValue(industries)
  const specialties = entity.specialities || entity.specialties
  const specialtiesText = Array.isArray(specialties) ?
    specialties.map(readLinkedInTextValue).filter(Boolean).join(', ')
  : readLinkedInTextValue(specialties)

  return {
    name: readLinkedInTextValue(entity.name || entity.localizedName),
    website: isRealCompanyWebsite(website) ? website : null,
    industry,
    companySizeLabel: formatStaffCountRange(entity.staffCountRange),
    headquarters:
      headquarters?.city || headquarters?.country ?
        [headquarters.city, headquarters.country].map(cleanText).filter(Boolean).join(', ')
      : readLinkedInTextValue(headquarters),
    organizationType: readLinkedInTextValue(entity.companyType || entity.organizationType),
    founded: entity.foundedOn?.year ? String(entity.foundedOn.year) : readLinkedInTextValue(entity.foundedOn || entity.founded),
    specialties: specialtiesText || null,
    description: readLinkedInTextValue(entity.description || entity.localizedDescription),
    linkedInUrl,
  }
}

async function fetchVoyagerCompany(companyUrl, liAtCookie) {
  const universalName = extractUniversalName(companyUrl)
  if (!universalName || !liAtCookie) return null

  const url = `https://www.linkedin.com/voyager/api/organization/companies?q=universalName&universalName=${encodeURIComponent(universalName)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const aboutUrl = `${cleanLinkedInUrl(companyUrl)}/about`
    const bootstrapResponse = await fetch(aboutUrl, {
      headers: {
        Cookie: `li_at=${liAtCookie}`,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    })
    const setCookie = bootstrapResponse.headers.get('set-cookie') || ''
    const jsessionId =
      setCookie.match(/JSESSIONID="?([^";]+)"?/i)?.[1] || 'ajax:0'
    const csrfToken = jsessionId.replace(/^"|"$/g, '')

    const response = await fetch(url, {
      headers: {
        Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrfToken}"`,
        'Csrf-Token': csrfToken,
        'X-RestLi-Protocol-Version': '2.0.0',
        'X-Li-Lang': 'en_US',
        Accept: 'application/vnd.linkedin.normalized+json+2.1',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: aboutUrl,
      },
      signal: controller.signal,
    })
    const text = await response.text()
    const json = JSON.parse(text)
    const entity =
      json?.elements?.[0] ||
      findCompanyEntity(json?.data) ||
      findCompanyEntity(json?.included) ||
      findCompanyEntity(json)
    const company = normalizeVoyagerCompany(entity, cleanLinkedInUrl(companyUrl))
    if (!response.ok || !company) {
      return { error: `Voyager company request failed (${response.status})` }
    }
    return { company, cookieRejected: false }
  } catch (err) {
    console.info('[company-debug] voyager company error', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

function readCompanySizeFromVoyager(html) {
  const text = String(html ?? '')
  const sizeFromStaffCount =
    readJsonObjectValue(text, ['staffCountRange']) ||
    readJsonTextField(text, ['staffCountRange', 'companySize', 'companySizeLabel'])
  const employeeText = text.match(
    /([0-9,]+\s*(?:-|to)\s*[0-9,]+\s+employees?)/i
  )?.[1]

  return cleanText(sizeFromStaffCount || employeeText) || null
}

function parseVoyagerCompanyDetails(html) {
  const text = String(html ?? '')
  const website =
    readJsonTextField(text, ['companyPageUrl', 'websiteUrl', 'website']) ||
    null

  return {
    name: readJsonTextField(text, ['name', 'localizedName']),
    description: readJsonTextField(text, ['description', 'localizedDescription']),
    website: isRealCompanyWebsite(website) ? website : null,
    industry:
      readJsonObjectValue(text, ['companyIndustries', 'industry']) ||
      readJsonTextField(text, ['industry']),
    companySizeLabel: readCompanySizeFromVoyager(text),
    headquarters:
      readJsonObjectValue(text, ['headquarter', 'headquarters']) ||
      readJsonTextField(text, ['headquarters']),
    organizationType:
      readJsonObjectValue(text, ['companyType', 'organizationType']) ||
      readJsonTextField(text, ['companyType', 'organizationType']),
    founded: readJsonTextField(text, ['foundedOn', 'founded']),
    specialties: readJsonTextField(text, ['specialties']),
  }
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
  const voyager = parseVoyagerCompanyDetails(html)

  const name =
    cleanText(organization?.name) ||
    voyager.name ||
    cleanText($('h1.top-card-layout__title, h1.org-top-card-summary__title').first().text()) ||
    null

  const description =
    cleanText(organization?.description) ||
    voyager.description ||
    readOverview($) ||
    null

  const website = readWebsite($, html, organization) || voyager.website

  const logo =
    organization?.logo?.contentUrl ||
    $('img.org-top-card-primary-content__logo').attr('src') ||
    $('img.top-card-layout__entity-image').attr('data-delayed-url') ||
    null

  const employeeCount = organization?.numberOfEmployees?.value
  const parsedFromJson =
    Number.isFinite(employeeCount) && employeeCount > 1 ? employeeCount : null
  const parsedSize = parsedFromJson ?? parseCompanySizeCountFromHtml(html)

  const companySizeLabel =
    readAboutField($, 'about-us__size') ||
    voyager.companySizeLabel ||
    readLabeledField($, ['Company size', 'Size']) ||
    parseCompanySizeLabelFromHtml(html) ||
    null

  const resolvedUrl = cleanLinkedInUrl(companyUrl)

  return {
    companyId: extractCompanyId(resolvedUrl),
    name,
    companyUrl: resolvedUrl,
    website,
    logo,
    description,
    industry:
      readAboutField($, 'about-us__industry') ||
      voyager.industry ||
      readLabeledField($, ['Industry']) ||
      null,
    companySize: parsedSize,
    companySizeLabel,
    phone:
      readAboutField($, 'about-us__phone') ||
      readLabeledField($, ['Phone', 'Phone number']) ||
      null,
    headquarters:
      formatHeadquarters(organization?.address) ||
      readAboutField($, 'about-us__headquarters') ||
      voyager.headquarters ||
      readLabeledField($, ['Headquarters', 'Headquarter']) ||
      null,
    organizationType:
      readAboutField($, 'about-us__organizationType') ||
      voyager.organizationType ||
      readLabeledField($, ['Organization type', 'Type']) ||
      null,
    founded:
      readAboutField($, 'about-us__foundedOn') ||
      voyager.founded ||
      readLabeledField($, ['Founded']) ||
      null,
    specialties:
      readAboutField($, 'about-us__specialties') ||
      voyager.specialties ||
      readLabeledField($, ['Specialties']) ||
      null,
    linkedInUrl: resolvedUrl,
  }
}

function toCompanyAboutUrl(companyUrl) {
  const url = cleanLinkedInUrl(companyUrl)
  if (!url) return null
  if (/\/about$/i.test(url)) return url
  return `${url}/about`
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

export async function fetchCompanyDetails(companyUrl, liAtCookie) {
  const url = cleanLinkedInUrl(companyUrl)
  if (!url) {
    return { error: 'Company URL is required' }
  }
  const aboutUrl = toCompanyAboutUrl(url)

  const session = resolveLinkedInSession(liAtCookie)
  if (session.cookie) {
    const voyagerResult = await fetchVoyagerCompany(url, session.cookie)
    if (voyagerResult?.company && !voyagerResult.error) {
      return voyagerResult
    }
  }

  const page = await fetchLinkedInPage(aboutUrl || url, {
    liAtCookie,
    timeoutMs: REQUEST_TIMEOUT_MS,
    fallbackToGuest: true,
  })

  if (page.error) {
    console.info('[company-debug] fetch company page error', {
      url,
      aboutUrl,
      error: page.error,
    })
    return { error: page.error }
  }

  if (isBlockedLinkedInResponse(page.html, page.status)) {
    console.info('[company-debug] fetch company page blocked', {
      url,
      aboutUrl,
      finalUrl: page.finalUrl,
      status: page.status,
      htmlLength: String(page.html ?? '').length,
      accessMode: page.accessMode,
      cookieRejected: page.cookieRejected,
    })
    return {
      error:
        'LinkedIn blocked or returned an empty company page. Clear the li_at cookie in Settings and try again.',
    }
  }

  let company = parseCompanyDetailsFromHtml(page.html, url)
  let cookieRejected = page.cookieRejected
  const hasCookie = Boolean(session.cookie)

  const missingCoreDetails = !company.name && !company.description
  const missingSize = company.companySize == null
  const missingRichDetails =
    !company.website &&
    !company.headquarters &&
    !company.organizationType &&
    !company.founded &&
    !company.specialties

  if (
    (hasCookie && page.usedCookie && (missingCoreDetails || missingSize || missingRichDetails)) ||
    (!hasCookie && missingCoreDetails)
  ) {
    const guestPage = await fetchLinkedInPage(aboutUrl || url, {
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
        organizationType:
          company.organizationType ?? guestCompany.organizationType,
        founded: company.founded ?? guestCompany.founded,
        specialties: company.specialties ?? guestCompany.specialties,
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
