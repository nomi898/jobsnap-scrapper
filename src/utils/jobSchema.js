import { cleanLinkedInUrl, cleanText } from './cleanJobFields.js'
import { sanitizeEmployeeCount } from './companySize.js'

export function extractCompanyId(companyUrl) {
  const url = cleanLinkedInUrl(companyUrl)
  const match = url.match(/\/company\/([^/?#]+)/i)
  return match?.[1] ?? null
}

export function parseLocationParts(location) {
  const text = cleanText(location)
  if (!text) return { city: null, country: null }
  if (/^remote$/i.test(text)) return { city: null, country: 'Remote' }

  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return { city: null, country: null }
  if (parts.length === 1) return { city: parts[0], country: null }

  return {
    city: parts[0],
    country: parts[parts.length - 1],
  }
}

export function normalizeExperienceLevel(value) {
  const text = cleanText(value)
  if (!text) return null

  return text
    .replace(/\s+level$/i, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function toRemoteBoolean(workType, location = '', workplace = '') {
  const text = `${workType} ${location} ${workplace}`.toLowerCase()
  if (/\bremote\b/.test(text)) return true
  if (/\b(on[- ]?site|hybrid)\b/.test(text)) return false
  return null
}

export function formatCompanySizeBand(count, label) {
  const bandLabel = cleanText(label).replace(/\s*employees?\s*/i, '')
  if (bandLabel && /\d/.test(bandLabel)) return bandLabel

  const value = Number(count)
  if (!Number.isFinite(value) || value <= 0) return null
  if (value >= 10000) return '10000+'
  if (value >= 5001) return '5001-10000'
  if (value >= 1001) return '1001-5000'
  if (value >= 501) return '501-1000'
  if (value >= 201) return '201-500'
  if (value >= 51) return '51-200'
  if (value >= 11) return '11-50'
  return '1-10'
}

export function normalizePostedAt({ postedAt, postedAtIso, postedDate }) {
  const iso = cleanText(postedAt ?? postedAtIso)
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}/.test(cleanText(postedDate))) {
    return cleanText(postedDate).slice(0, 10)
  }
  return null
}

export function parseDescriptionExtras(description) {
  const text = String(description ?? '').trim()
  if (!text) {
    return {
      requirements: null,
      benefits: null,
      skills: [],
      visaSponsorship: null,
    }
  }

  let visaSponsorship = null
  if (
    /\b(no|not offering|without|does not offer|don't offer)\s+visa\s+sponsorship\b/i.test(
      text
    ) ||
    /\bvisa sponsorship\s+(is\s+)?not\s+(available|provided|offered)\b/i.test(text) ||
    /\bno\s+sponsorship\b/i.test(text)
  ) {
    visaSponsorship = false
  } else if (
    /\bvisa\s+sponsorship\b/i.test(text) ||
    /\bsponsor(s|ed|ing)?\b[^.]{0,40}\bvisa\b/i.test(text) ||
    /\bh-1b\b/i.test(text)
  ) {
    visaSponsorship = true
  }

  const skills = new Set()
  const techStackMatch = text.match(/tech\s*stack[:\s-]+([^.(\n]+)/i)
  if (techStackMatch) {
    techStackMatch[1].split(/[,;|]/).forEach((part) => {
      const skill = part.replace(/[()]/g, '').trim()
      if (skill.length > 1 && skill.length < 40) skills.add(skill)
    })
  }

  const parenGroups = text.match(/\(([^)]+)\)/g) ?? []
  for (const group of parenGroups) {
    group
      .replace(/[()]/g, '')
      .split(',')
      .forEach((part) => {
        const skill = part.trim()
        if (
          skill.length > 1 &&
          skill.length < 40 &&
          !/developer|engineer|architect|programmer/i.test(skill)
        ) {
          skills.add(skill)
        }
      })
  }

  function extractSection(patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match?.[1]) return cleanText(match[1].slice(0, 2000))
    }
    return null
  }

  const requirements = extractSection([
    /(?:requirements|qualifications|what you(?:'ll| will) need|must have)[:\s-]+([\s\S]{40,2000}?)(?=(?:benefits|we offer|about the role|responsibilities|equal opportunity|$))/i,
  ])

  const benefits = extractSection([
    /(?:benefits|we offer|perks|what we offer|compensation package)[:\s-]+([\s\S]{20,1500}?)(?=(?:requirements|qualifications|apply|about|$))/i,
  ])

  return {
    requirements,
    benefits,
    skills: [...skills].slice(0, 25),
    visaSponsorship,
  }
}

function readJsonLdBlocks(html) {
  const blocks = []
  const pattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

  let match = pattern.exec(html)
  while (match) {
    try {
      blocks.push(JSON.parse(match[1]))
    } catch {
      // ignore invalid JSON-LD
    }
    match = pattern.exec(html)
  }

  return blocks
}

export function parseJobPostingJsonLd(html) {
  const blocks = readJsonLdBlocks(html)
  const items = blocks.flatMap((block) =>
    Array.isArray(block['@graph']) ? block['@graph'] : [block]
  )

  const posting = items.find(
    (item) =>
      item?.['@type'] === 'JobPosting' ||
      (Array.isArray(item?.['@type']) && item['@type'].includes('JobPosting'))
  )

  if (!posting) return {}

  const address = posting.jobLocation?.address ?? posting.applicantLocationRequirements
  const locationAddress =
    Array.isArray(posting.jobLocation) ?
      posting.jobLocation[0]?.address
    : address

  return {
    postedAt: posting.datePosted ? String(posting.datePosted).slice(0, 10) : null,
    expiresAt: posting.validThrough ? String(posting.validThrough).slice(0, 10) : null,
    city: locationAddress?.addressLocality ?? null,
    country:
      locationAddress?.addressCountry ??
      locationAddress?.addressRegion ??
      null,
  }
}

export function mergeToApifyJob(job = {}, details = {}, company = {}) {
  const location = cleanText(details.location || job.location)
  const parsedLocation = parseLocationParts(location)
  const workType = job.workType ?? ''
  const companyUrl = cleanLinkedInUrl(details.companyUrl || job.companyUrl)
  const companyId = job.companyId ?? extractCompanyId(companyUrl)
  const jsonLd = details.jsonLd ?? {}
  const descExtras = parseDescriptionExtras(details.description)
  const companySizeNum = sanitizeEmployeeCount(
    company.companySize ?? job.companySizeCount ?? job.companySize
  )
  const companySizeBand =
    job.companySizeBand ??
    formatCompanySizeBand(companySizeNum, company.companySizeLabel)

  const city = job.city ?? jsonLd.city ?? parsedLocation.city
  const country = job.country ?? jsonLd.country ?? parsedLocation.country
  const postedAt =
    normalizePostedAt({
      postedAt: job.postedAt ?? details.postedAt ?? jsonLd.postedAt,
      postedAtIso: job.postedAtIso,
      postedDate: details.postedDate || job.postedDate,
    }) ?? null

  return {
    id: String(details.jobId || job.id || ''),
    title: cleanText(details.title || job.title),
    company: cleanText(details.company || job.company),
    companyId,
    companySize: companySizeBand,
    companySizeCount: companySizeNum,
    location,
    country,
    city,
    salaryMin: details.salaryMin ?? job.salaryMin ?? null,
    salaryMax: details.salaryMax ?? job.salaryMax ?? null,
    currency: details.currency ?? job.currency ?? null,
    employmentType: details.employmentType ?? job.employmentType ?? null,
    experienceLevel:
      normalizeExperienceLevel(details.experienceLevel ?? job.experienceLevel) ??
      null,
    remote: job.remote ?? toRemoteBoolean(workType, location, job.workplace),
    description: details.description ?? job.description ?? null,
    requirements: details.requirements ?? descExtras.requirements ?? job.requirements ?? null,
    skills:
      details.skills?.length > 0 ? details.skills
      : descExtras.skills.length > 0 ? descExtras.skills
      : job.skills ?? [],
    benefits: details.benefits ?? descExtras.benefits ?? job.benefits ?? null,
    industry: details.industry ?? company.industry ?? job.industry ?? null,
    postedAt: postedAt || job.postedDate || details.postedDate || null,
    expiresAt: details.expiresAt ?? jsonLd.expiresAt ?? job.expiresAt ?? null,
    applyUrl: cleanLinkedInUrl(details.applyUrl || job.url),
    companyWebsite: company.website ?? job.companyWebsite ?? null,
    companyLogo: company.logo || details.companyLogo || job.companyLogo || null,
    companyLinkedIn: companyUrl || null,
    applicantCount: details.applicantCount ?? job.applicantCount ?? null,
    jobFunction: details.jobFunction ?? job.jobFunction ?? null,
    educationLevel: details.educationLevel ?? job.educationLevel ?? null,
    visaSponsorship:
      details.visaSponsorship ??
      descExtras.visaSponsorship ??
      job.visaSponsorship ??
      null,
    keyword: job.keyword ?? null,
    url: job.url ?? null,
    workType,
    workplace: job.workplace ?? null,
    postedDate: job.postedDate || details.postedDate || null,
    postedAtIso: job.postedAtIso ?? null,
    recruiterName: details.recruiterName ?? job.recruiterName ?? null,
    descriptionHtml: details.descriptionHtml ?? job.descriptionHtml ?? null,
    detailsLoadedAt: job.detailsLoadedAt ?? new Date().toISOString(),
    companyDescription: company.description ?? job.companyDescription ?? null,
    headquarters: company.headquarters ?? job.headquarters ?? null,
    organizationType: company.organizationType ?? job.organizationType ?? null,
    founded: company.founded ?? job.founded ?? null,
    specialties: company.specialties ?? job.specialties ?? null,
  }
}
