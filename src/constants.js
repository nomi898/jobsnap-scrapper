export const STORAGE_KEYS = {
  settings: 'jobsnap-scraper-settings',
  jobs: 'jobsnap-scraper-jobs',
  pagination: 'jobsnap-scraper-pagination',
  lastFetched: 'jobsnap-scraper-last-fetched',
  fetchMeta: 'jobsnap-scraper-fetch-meta',
  jobStatus: 'jobsnap-scraper-job-status',
}

export const MAX_PAGES_PER_KEYWORD = 50
export const DEFAULT_PAGES_PER_KEYWORD = 3
/** Hard stop only — prevents infinite loops; normal exit is empty LinkedIn page */
export const SAFETY_MAX_PAGES = 500
/** Throttle: random delay between search pages (ms) */
export const PAGE_DELAY_MIN_MS = 1500
export const PAGE_DELAY_MAX_MS = 2500
/** Throttle: random delay between keywords (ms) */
export const KEYWORD_DELAY_MIN_MS = 2000
export const KEYWORD_DELAY_MAX_MS = 4000
/** Throttle: extra cooldown every Nth keyword (ms) */
export const KEYWORD_COOLDOWN_MIN_MS = 12000
export const KEYWORD_COOLDOWN_MAX_MS = 18000
export const KEYWORD_COOLDOWN_EVERY = 3
export const KEYWORD_STAGGER_MS = 1200
export const KEYWORD_RETRY_DELAY_MS = 3000
export const KEYWORD_MAX_RETRIES = 1
export const KEYWORD_FINAL_RETRY_DELAY_MS = 4000
export const MAX_FETCH_BATCHES = Infinity

export const LINKEDIN_RATE_LIMIT_ERROR =
  'LinkedIn is rate limiting requests. Wait 15–30 minutes, then try Fetch Jobs with 2–3 pages per keyword.'

export const SCRAPE_TIMEOUT_ERROR =
  'The scrape timed out (server took too long). In Settings, set Pages per keyword to 2–3, save, then try Fetch Jobs again.'

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
  pagesPerKeyword: DEFAULT_PAGES_PER_KEYWORD,
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

/** LinkedIn search URL f_TPR values (seconds). */
export const LINKEDIN_DATE_FILTERS = {
  '24h': 'r86400',
  '1d': 'r86400',
  '3d': 'r259200',
  '7d': 'r604800',
  '30d': 'r2592000',
  all: '',
}

export const SCRAPE_DATE_OPTIONS = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

export const DISPLAY_DATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '1d', label: 'Last 1 day' },
  { value: '2d', label: 'Last 2 days' },
  { value: '3d', label: 'Last 3 days' },
  { value: '5d', label: 'Last 5 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
]

export const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Date (newest)' },
  { value: 'date-asc', label: 'Date (oldest)' },
  { value: 'company-asc', label: 'Company (A–Z)' },
  { value: 'company-desc', label: 'Company (Z–A)' },
]
