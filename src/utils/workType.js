export function inferWorkType(location = '', workplace = '') {
  const text = `${location} ${workplace}`.toLowerCase()
  if (/\bhybrid\b/.test(text)) return 'hybrid'
  if (/\bremote\b/.test(text)) return 'remote'
  if (/\bon[- ]?site\b/.test(text)) return 'onsite'
  return 'unknown'
}

export function matchesWorkTypeFilter(job, filter) {
  if (!filter || filter === 'all') return true

  const workType =
    job.workType ?? inferWorkType(job.location, job.workplace)

  if (workType === 'unknown') return false

  return workType === filter
}

export function getWorkTypeLabel(workType) {
  switch (workType) {
    case 'remote':
      return 'Remote'
    case 'hybrid':
      return 'Hybrid'
    case 'onsite':
      return 'On-site'
    default:
      return ''
  }
}
