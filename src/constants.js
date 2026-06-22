export const STORAGE_KEYS = {
  settings: 'jobsnap-scraper-settings',
  jobs: 'jobsnap-scraper-jobs',
  pagination: 'jobsnap-scraper-pagination',
  lastFetched: 'jobsnap-scraper-last-fetched',
  fetchMeta: 'jobsnap-scraper-fetch-meta',
  jobStatus: 'jobsnap-scraper-job-status',
}

export const SAFETY_MAX_PAGES = 100
export const EMPTY_MATCH_PAGE_LIMIT = 5
/** LinkedIn max jobs per HTTP request (we paginate until no more results) */
export const LINKEDIN_BATCH_SIZE = 25
/** Throttle: random delay between search pages (ms) */
export const PAGE_DELAY_MIN_MS = 12000
export const PAGE_DELAY_MAX_MS = 20000
export const CLIENT_RATE_LIMIT_RETRY_MAX = 3
/** Throttle: longer pause after sustained scraping to stay below block thresholds */
export const SCRAPE_RUN_COOLDOWN_EVERY = 25
export const SCRAPE_RUN_COOLDOWN_MIN_MS = 120000
export const SCRAPE_RUN_COOLDOWN_MAX_MS = 300000
/** Throttle: pause and retry when LinkedIn blocks mid-scrape (ms) */
export const RATE_LIMIT_COOLDOWN_MIN_MS = 90000
export const RATE_LIMIT_COOLDOWN_MAX_MS = 180000
export const RATE_LIMIT_RECOVERY_ATTEMPTS = 8
/** Throttle: random delay between keywords (ms) */
export const KEYWORD_DELAY_MIN_MS = 15000
export const KEYWORD_DELAY_MAX_MS = 20000
/** Throttle: extra cooldown every Nth keyword (ms) */
export const KEYWORD_COOLDOWN_MIN_MS = 60000
export const KEYWORD_COOLDOWN_MAX_MS = 90000
export const KEYWORD_COOLDOWN_EVERY = 3
export const KEYWORD_STAGGER_MS = 1200
export const KEYWORD_RETRY_DELAY_MS = 30000
export const KEYWORD_MAX_RETRIES = 2
export const KEYWORD_FINAL_RETRY_DELAY_MS = 30000
export const MAX_FETCH_BATCHES = Infinity

export const LINKEDIN_RATE_LIMIT_ERROR =
  'LinkedIn is rate limiting requests. Wait 15–30 minutes, then try Fetch Jobs again.'

export const SCRAPE_TIMEOUT_ERROR =
  'The scrape timed out (server took too long). Try fewer keywords or wait and retry.'

export const DASHBOARD_DEFAULT_FILTERS = {
  search: '',
  location: '',
  company: '',
  keyword: 'all',
  workType: 'all',
  dateFilter: 'all',
  sort: 'date-desc',
  hideApplied: false,
  hideViewed: false,
  hideDuplicateTitleCompany: false,
  companySize: 'all',
}

export const COMPANY_SIZE_FILTER_OPTIONS = [
  { value: 'all', label: 'All sizes' },
  { value: 'lt-100', label: 'Up to 100' },
  { value: 'lt-200', label: 'Up to 200' },
  { value: 'lt-300', label: 'Up to 300' },
  { value: 'lt-400', label: 'Up to 400' },
  { value: 'lt-500', label: 'Up to 500' },
  { value: 'gt-500', label: 'Greater than 500' },
]

export const WORK_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
]

// LinkedIn f_WT URL parameter values
export const LINKEDIN_WORK_TYPE = {
  remote: '2',
  hybrid: '3',
  onsite: '1',
}

export const DEFAULT_SETTINGS = {
  keywords: 'ios developer, android developer',
  scrapeDateFilter: '7d',
  workTypeFilter: 'all',
  regionGeoId: '92000000',
  customGeoId: '',
  liAtCookie: '',
  fetchCompanySize: true,
}

export const REGION_OPTIONS = [
  { label: 'Worldwide', geoId: '92000000' },
  { label: 'United States', geoId: '103644278' },
  { label: 'United Kingdom', geoId: '101165590' },
  { label: 'Canada', geoId: '101174742' },
  { label: 'Australia', geoId: '101452733' },
  { label: 'Singapore', geoId: '102713980' },
  { label: 'Germany', geoId: '101282230' },
  { label: 'Netherlands', geoId: '102890719' },
  { label: 'Ireland', geoId: '104738515' },
  { label: 'UAE', geoId: '104305776' },
  { label: 'India', geoId: '102221843' },
  { label: 'Custom', geoId: 'custom' },
]

export function resolveGeoId(settings) {
  if (settings.regionGeoId === 'custom') {
    return settings.customGeoId?.trim() || '92000000'
  }
  return settings.regionGeoId || '92000000'
}

export function getRegionLabel(settings) {
  const geoId = resolveGeoId(settings)
  const preset = REGION_OPTIONS.find(
    (region) => region.geoId === geoId && region.geoId !== 'custom'
  )
  return preset?.label ?? `Custom (${geoId})`
}

export const SCRAPE_DATE_OPTIONS = [
  { value: '1d', label: 'Last 24 hours' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

export function getScrapeDateLabel(scrapeDateFilter) {
  return (
    SCRAPE_DATE_OPTIONS.find((option) => option.value === scrapeDateFilter)
      ?.label ?? 'Last 7 days'
  )
}

export const DISPLAY_DATE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All' },
]

export const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Posted (newest first)' },
  { value: 'date-asc', label: 'Posted (oldest first)' },
  { value: 'company-asc', label: 'Company (A–Z)' },
  { value: 'company-desc', label: 'Company (Z–A)' },
]
