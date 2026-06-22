export function normalizeSearchKeyword(keyword) {
  return String(keyword ?? '')
    .trim()
    .replace(/\bandriod\b/gi, 'android')
}

const GENERIC_ROLE_WORDS = new Set([
  'application',
  'architect',
  'analyst',
  'consultant',
  'designer',
  'developer',
  'engineer',
  'full',
  'fullstack',
  'jr',
  'junior',
  'lead',
  'manager',
  'mid',
  'principal',
  'programmer',
  'remote',
  'senior',
  'software',
  'specialist',
  'sr',
  'staff',
  'stack',
])

const SIGNAL_ALIASES = {
  ios: ['ios', 'swift', 'iphone', 'ipad', 'xcode'],
  swift: ['swift', 'ios', 'xcode'],
  android: ['android', 'kotlin', 'jetpack'],
  kotlin: ['kotlin', 'android'],
  flutter: ['flutter', 'dart'],
  dart: ['dart', 'flutter'],
  mobile: [
    'mobile',
    'ios',
    'android',
    'swift',
    'kotlin',
    'flutter',
    'react native',
    'react-native',
  ],
  'react native': ['react native', 'react-native'],
  xamarin: ['xamarin'],
  unity: ['unity', 'game'],
}

export function extractTitleSignals(keyword) {
  const normalized = normalizeSearchKeyword(keyword).toLowerCase()
  if (!normalized) return []

  for (const [signal, aliases] of Object.entries(SIGNAL_ALIASES)) {
    if (normalized.includes(signal)) {
      return aliases
    }
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  const significant = words.filter((word) => !GENERIC_ROLE_WORDS.has(word))

  if (significant.length > 0) {
    for (const word of significant) {
      if (SIGNAL_ALIASES[word]) return SIGNAL_ALIASES[word]
    }
    return significant
  }

  return [normalized]
}

function searchKeywordKey(keyword) {
  return normalizeSearchKeyword(keyword).toLowerCase()
}

/** Map a stored/API keyword to the exact string from your settings list */
export function canonicalSearchKeyword(value, keywordList = []) {
  const key = searchKeywordKey(value)
  if (!key) return ''
  const match = keywordList.find((kw) => searchKeywordKey(kw) === key)
  return match ?? normalizeSearchKeyword(value)
}

export function parseKeywordList(keywords) {
  return keywords
    .split(/[,\n]+/)
    .map((k) => normalizeSearchKeyword(k))
    .filter(Boolean)
}
