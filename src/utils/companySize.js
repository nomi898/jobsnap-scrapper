/** LinkedIn HTML often embeds placeholder employeeCount:1 when size is unknown. */
export function sanitizeEmployeeCount(value) {
  const count = Number(String(value ?? '').replace(/,/g, ''))
  if (!Number.isFinite(count) || count <= 1) return null
  return count
}

export function formatCompanySize(value) {
  if (value == null || value === '') return '—'
  const count = sanitizeEmployeeCount(value)
  if (count != null) return count.toLocaleString()
  const text = String(value).trim()
  if (!text) return '—'
  const range = parseCompanySizeRange(text)
  return range ? text : '—'
}

export function formatJobCompanySize(job) {
  if (!job || typeof job !== 'object') return '—'

  const count = sanitizeEmployeeCount(job.companySizeCount)
  if (count != null) return count.toLocaleString()

  const label = cleanSizeLabel(job.companySizeLabel ?? job.companySize)
  if (label && parseCompanySizeRange(label)) return label

  return '—'
}

function cleanSizeLabel(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.replace(/\s*employees?\s*/i, '').trim()
}

function parseNumericToken(value) {
  return sanitizeEmployeeCount(value)
}

function parseRangeBound(value) {
  const count = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(count) && count > 0 ? count : null
}

/** Parse a numeric count or LinkedIn band label into a min/max employee range. */
export function parseCompanySizeRange(value) {
  if (value == null || value === '') return null

  const direct = parseNumericToken(value)
  if (direct != null) {
    return { min: direct, max: direct }
  }

  const text = String(value).trim()

  const plus = text.match(/^(\d[\d,]*)\+$/)
  if (plus) {
    const min = parseRangeBound(plus[1])
    if (min != null) return { min, max: Infinity }
  }

  const range = text.match(/^(\d[\d,]*)\s*-\s*(\d[\d,]*)(?:\+)?$/)
  if (range) {
    const min = parseRangeBound(range[1])
    const max = parseRangeBound(range[2])
    if (min != null && max != null && max >= min) {
      return { min, max }
    }
  }

  return null
}

export function getJobCompanySizeRange(job) {
  if (!job || typeof job !== 'object') return null

  const count = parseNumericToken(job.companySizeCount)
  if (count != null) {
    return { min: count, max: count }
  }

  return (
    parseCompanySizeRange(job.companySize) ??
    parseCompanySizeRange(job.companySizeLabel)
  )
}

export function matchesCompanySizeFilter(jobOrValue, filter) {
  if (!filter || filter === 'all') return true

  const range =
    typeof jobOrValue === 'object' && jobOrValue !== null
      ? getJobCompanySizeRange(jobOrValue)
      : parseCompanySizeRange(jobOrValue)

  if (!range) return false

  switch (filter) {
    case 'lt-100':
      return range.max <= 100
    case 'lt-200':
      return range.max <= 200
    case 'lt-300':
      return range.max <= 300
    case 'lt-400':
      return range.max <= 400
    case 'lt-500':
    case '1-500':
      return range.max <= 500
    case 'gt-500':
    case '501+':
      return range.min >= 501
    default:
      return true
  }
}
