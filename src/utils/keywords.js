export function normalizeSearchKeyword(keyword) {
  return String(keyword ?? '')
    .trim()
    .replace(/\bandriod\b/gi, 'android')
}

export function parseKeywordList(keywords) {
  return keywords
    .split(',')
    .map((k) => normalizeSearchKeyword(k))
    .filter(Boolean)
}
