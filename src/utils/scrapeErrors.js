import { SCRAPE_TIMEOUT_ERROR } from '../constants'

function isTimeoutStatus(status) {
  return status === 524 || status === 504 || status === 408
}

export function formatScrapeError(status, data) {
  if (data?.timeout || isTimeoutStatus(status)) {
    return data?.details ?? SCRAPE_TIMEOUT_ERROR
  }

  if (data?.rateLimited) {
    return (
      data.error ??
      'LinkedIn is rate limiting requests. Wait 15–30 minutes, then try again with 2–3 pages per keyword.'
    )
  }

  const detail = data?.error ?? data?.details ?? 'Unknown error'

  if (status === 400) {
    return detail
  }

  if (status === 502 || status === 503) {
    return `${detail}${data?.details ? ` ${data.details}` : ''}`
  }

  return `Scrape failed (${status}): ${detail}`
}
