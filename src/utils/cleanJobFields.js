export function cleanLinkedInUrl(url) {
  return String(url ?? '')
    .replace(
      /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com/i,
      'https://www.linkedin.com'
    )
    .split('?')[0]
    .replace(/\/+$/, '')
    .trim()
}

export function stripUrls(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim()
}

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .trim()
}

export function parseCompanyField(value, companyUrl = '') {
  const raw = String(value ?? '').trim()
  const explicitUrl = cleanLinkedInUrl(companyUrl)

  const bracketMatch = raw.match(/^(.+?)\s*\[(https?:\/\/[^\]]+)\]\s*$/i)
  if (bracketMatch) {
    return {
      company: bracketMatch[1].trim(),
      companyUrl: cleanLinkedInUrl(bracketMatch[2]),
    }
  }

  const embeddedUrlMatch = raw.match(/https?:\/\/[^\s\])]+/i)
  const company = stripUrls(stripHtml(raw))
    .replace(/\[\s*\]?/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    company,
    companyUrl: explicitUrl || cleanLinkedInUrl(embeddedUrlMatch?.[0] ?? ''),
  }
}

export function cleanCompany(value) {
  return parseCompanyField(value).company
}

export function cleanText(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim()
}

export function resolveJobUrl(job) {
  const raw = String(job?.url || job?.link || '').trim()
  return raw ? cleanLinkedInUrl(raw) : ''
}
