import { isJobHiddenByStatusFilters } from './jobStatus'
import { matchesWorkTypeFilter } from './workType'
import { matchesCompanySizeFilter } from './companySize'

function parseRelativePostedDate(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return null

  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )

  if (text === 'just now' || text === 'today') return startOfToday
  if (text === 'yesterday') {
    const date = new Date(startOfToday)
    date.setDate(date.getDate() - 1)
    return date
  }

  const minuteMatch = text.match(/(\d+)\s+minutes?\s+ago/)
  if (minuteMatch) {
    const date = new Date(now)
    date.setMinutes(date.getMinutes() - Number(minuteMatch[1]))
    return date
  }

  const hourMatch = text.match(/(\d+)\s+hours?\s+ago/)
  if (hourMatch) {
    const date = new Date(now)
    date.setHours(date.getHours() - Number(hourMatch[1]))
    return date
  }

  const dayMatch = text.match(/(\d+)\s+days?\s+ago/)
  if (dayMatch) {
    const date = new Date(startOfToday)
    date.setDate(date.getDate() - Number(dayMatch[1]))
    return date
  }

  const weekMatch = text.match(/(\d+)\s+weeks?\s+ago/)
  if (weekMatch) {
    const date = new Date(startOfToday)
    date.setDate(date.getDate() - Number(weekMatch[1]) * 7)
    return date
  }

  const monthMatch = text.match(/(\d+)\s+months?\s+ago/)
  if (monthMatch) {
    const date = new Date(startOfToday)
    date.setMonth(date.getMonth() - Number(monthMatch[1]))
    return date
  }

  if (text.includes('recently')) return startOfToday
  if (text.match(/\b(a|1)\s+week\s+ago\b/)) {
    const date = new Date(startOfToday)
    date.setDate(date.getDate() - 7)
    return date
  }
  if (text.match(/\b(a|1)\s+month\s+ago\b/)) {
    const date = new Date(startOfToday)
    date.setMonth(date.getMonth() - 1)
    return date
  }

  return null
}

function formatRelativeFromDate(date) {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )
  const jobDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor(
    (startOfToday.getTime() - jobDay.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return '1 day ago'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function parsePostedDate(value) {
  if (!value) return null

  const relative = parseRelativePostedDate(value)
  if (relative) return relative

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isWithinDisplayRange(postedDate, filter) {
  if (filter === 'all') return true
  const date = parsePostedDate(postedDate)
  if (!date) return true

  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )

  if (filter === 'today') {
    return date >= startOfToday
  }

  const days = filter === '3d' ? 3 : 7
  const cutoff = new Date(startOfToday)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  return date >= cutoff
}

function compareDates(a, b, direction) {
  const dateA = parsePostedDate(a)?.getTime() ?? 0
  const dateB = parsePostedDate(b)?.getTime() ?? 0
  return direction === 'asc' ? dateA - dateB : dateB - dateA
}

function compareStrings(a, b, direction) {
  const result = (a ?? '').localeCompare(b ?? '', undefined, {
    sensitivity: 'base',
  })
  return direction === 'asc' ? result : -result
}

function normalizeMatchText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function keywordWords(keyword) {
  return normalizeMatchText(keyword).split(/\s+/).filter(Boolean)
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function containsTerm(text, term) {
  const normalizedText = normalizeMatchText(text)
  const normalizedTerm = normalizeMatchText(term)
  if (!normalizedTerm) return false

  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegex(normalizedTerm)}(?:[^a-z0-9]|$)`
  )
  return pattern.test(normalizedText)
}

function titleSignals(title) {
  const text = normalizeMatchText(title)
  return {
    ios:
      containsTerm(title, 'ios') ||
      /\b(swift|iphone|ipad|xcode)\b/.test(text),
    android:
      containsTerm(title, 'android') ||
      /\b(kotlin|jetpack)\b/.test(text),
  }
}

function scoreKeywordMatch(title, keyword) {
  const words = keywordWords(keyword)
  const primary = words[0]
  const signals = titleSignals(title)
  if (!primary) return 0

  const primaryMatches =
    containsTerm(title, primary) ||
    (primary === 'ios' && signals.ios) ||
    (primary === 'android' && signals.android)

  if (!primaryMatches) return 0

  let score = 10
  for (let i = 1; i < words.length; i += 1) {
    if (containsTerm(title, words[i])) score += 1
  }
  return score
}

export function inferKeywordFromTitle(title, availableKeywords = []) {
  let bestMatch = ''
  let bestScore = 0

  for (const keyword of availableKeywords) {
    const score = scoreKeywordMatch(title, keyword)
    if (score > bestScore) {
      bestScore = score
      bestMatch = keyword
    }
  }

  return bestMatch
}

export function matchesKeywordFilter(
  job,
  filterKeyword,
  availableKeywords = []
) {
  if (!filterKeyword || filterKeyword === 'all') return true

  const filter = normalizeMatchText(filterKeyword)
  const jobKeyword = normalizeMatchText(getJobKeyword(job, availableKeywords))

  if (jobKeyword && jobKeyword === filter) return true

  const primaryTerm = keywordWords(filterKeyword)[0]
  return primaryTerm ? containsTerm(job.title, primaryTerm) : false
}

export function resolveKeywordFilter(filterKeyword, availableKeywords = []) {
  if (!filterKeyword || filterKeyword === 'all') return 'all'

  const normalizedFilter = normalizeMatchText(filterKeyword)
  const match = availableKeywords.find(
    (keyword) => normalizeMatchText(keyword) === normalizedFilter
  )

  return match ?? 'all'
}

function keywordMatchesTitle(title, keyword) {
  return scoreKeywordMatch(title, keyword) > 0
}

export function getJobKeyword(job, availableKeywords = []) {
  const stored = String(job.keyword ?? '').trim()
  const inferred = inferKeywordFromTitle(job.title, availableKeywords)

  if (!stored) return inferred
  if (!inferred) return stored

  const storedNorm = normalizeMatchText(stored)
  const inferredNorm = normalizeMatchText(inferred)
  if (storedNorm === inferredNorm) return stored

  const storedMatches = keywordMatchesTitle(job.title, stored)
  const inferredMatches = keywordMatchesTitle(job.title, inferred)

  if (inferredMatches && !storedMatches) return inferred
  if (inferredMatches && storedMatches) {
    return scoreKeywordMatch(job.title, inferred) >
      scoreKeywordMatch(job.title, stored)
      ? inferred
      : stored
  }

  return stored
}

export function enrichJobKeywords(jobs, availableKeywords = []) {
  return jobs.map((job) => ({
    ...job,
    keyword: getJobKeyword(job, availableKeywords),
  }))
}

export function countJobsByKeyword(jobs, keyword, availableKeywords = []) {
  const target = normalizeMatchText(keyword)
  return jobs.filter(
    (job) =>
      normalizeMatchText(getJobKeyword(job, availableKeywords)) === target
  ).length
}

export function buildTitleCompanyKey(job) {
  return `${normalizeMatchText(job.title)}::${normalizeMatchText(job.company)}`
}

export function collapseDuplicateTitleCompany(jobs) {
  const counts = new Map()
  for (const job of jobs) {
    const key = buildTitleCompanyKey(job)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const seen = new Set()
  return jobs.filter((job) => {
    const key = buildTitleCompanyKey(job)
    if ((counts.get(key) ?? 0) <= 1) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function filterAndSortJobs(jobs, filters) {
  const {
    search,
    location,
    company,
    keyword,
    dateFilter,
    workType,
    sort,
    availableKeywords,
    hideApplied,
    hideViewed,
    hideDuplicateTitleCompany,
    companySize,
    statusMap,
  } = filters

  const searchLower = search.trim().toLowerCase()
  const locationLower = location.trim().toLowerCase()
  const companyLower = company.trim().toLowerCase()

  let result = jobs.filter((job) => {
    if (searchLower && !job.title?.toLowerCase().includes(searchLower)) {
      return false
    }
    if (locationLower && !job.location?.toLowerCase().includes(locationLower)) {
      return false
    }
    if (companyLower && !job.company?.toLowerCase().includes(companyLower)) {
      return false
    }
    if (
      keyword !== 'all' &&
      !matchesKeywordFilter(job, keyword, availableKeywords)
    ) {
      return false
    }
    if (!isWithinDisplayRange(job.postedDate, dateFilter)) {
      return false
    }
    if (!matchesWorkTypeFilter(job, workType)) {
      return false
    }
    if (!matchesCompanySizeFilter(job, companySize)) {
      return false
    }
    if (isJobHiddenByStatusFilters(statusMap, job, { hideViewed, hideApplied })) {
      return false
    }
    return true
  })

  const [sortField, sortDirection] = sort.split('-')

  if (sortField === 'date') {
    result = [...result].sort((a, b) =>
      compareDates(a.postedDate, b.postedDate, sortDirection)
    )
  } else if (sortField === 'company') {
    result = [...result].sort((a, b) =>
      compareStrings(a.company, b.company, sortDirection)
    )
  }

  if (hideDuplicateTitleCompany) {
    result = collapseDuplicateTitleCompany(result)
  }

  return { jobs: result, availableKeywords }
}

export function formatPostedDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return '—'

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const isoDate = new Date(text)
    if (!Number.isNaN(isoDate.getTime())) {
      return formatRelativeFromDate(isoDate)
    }
  }

  const relative = parseRelativePostedDate(text)
  if (relative) return text

  const date = parsePostedDate(text)
  if (!date) return text

  return formatRelativeFromDate(date)
}

export function formatLastFetched(value) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
