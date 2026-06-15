import { useState } from 'react'
import Layout from '../components/Layout'
import {
  MAX_PAGES_PER_KEYWORD,
  REGION_OPTIONS,
  SCRAPE_DATE_OPTIONS,
  WORK_TYPE_OPTIONS,
  resolveGeoId,
} from '../constants'
import { useSettings } from '../hooks/useSettings'
import { formatScrapeError } from '../utils/scrapeErrors'
import { getFormRegionValues } from '../utils/region'
import { parseKeywordList } from '../utils/keywords'
import { normalizeLiAtCookie } from '../utils/linkedinCookie'

export default function Settings() {
  const { settings, saveSettings } = useSettings()
  const [form, setForm] = useState({
    ...settings,
    ...getFormRegionValues(settings),
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [testStatus, setTestStatus] = useState('')
  const [testing, setTesting] = useState(false)

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
    setError('')
    setTestStatus('')
  }

  const validateForm = () => {
    const keywords = form.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)

    if (keywords.length === 0) {
      return 'Add at least one keyword.'
    }

    const pages = Number(form.pagesPerKeyword)
    if (!Number.isFinite(pages) || pages < 1) {
      return 'Pages per keyword must be at least 1.'
    }
    if (pages > MAX_PAGES_PER_KEYWORD) {
      return `Pages per keyword cannot exceed ${MAX_PAGES_PER_KEYWORD}.`
    }

    if (form.regionGeoId === 'custom' && !form.customGeoId.trim()) {
      return 'Enter a custom LinkedIn geo ID.'
    }

    return null
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    saveSettings({
      ...form,
      keywords: parseKeywordList(form.keywords).join(', '),
      pagesPerKeyword: Number(form.pagesPerKeyword),
      liAtCookie: normalizeLiAtCookie(form.liAtCookie),
      fetchCompanySize: form.fetchCompanySize !== false,
    })
    setSaved(true)
    setError('')
  }

  const handleTestScraper = async () => {
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setTesting(true)
    setTestStatus('')
    setError('')

    const keywords = form.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)

    try {
      const response = await fetch('/api/fetch-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: [keywords[0]],
          pagesPerKeyword: 1,
          startPage: 1,
          dateFilter: form.scrapeDateFilter,
          geoId: resolveGeoId(form),
          workTypeFilter: form.workTypeFilter ?? 'all',
          fetchCompanySize: form.fetchCompanySize !== false,
          ...(normalizeLiAtCookie(form.liAtCookie)
            ? { liAtCookie: normalizeLiAtCookie(form.liAtCookie) }
            : {}),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setTestStatus(formatScrapeError(response.status, data))
        return
      }

      const jobCount = Array.isArray(data)
        ? data.length
        : (data.jobs?.length ?? 0)
      setTestStatus(`Scraper connected. Received ${jobCount} job(s).`)
    } catch {
      setTestStatus('Network error — restart the dev server and try again.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Layout title="Settings" showBack>
      <form className="settings-form" onSubmit={handleSubmit}>
        <label className="field field-full">
          <span>Keywords (comma separated)</span>
          <input
            type="text"
            placeholder="ios developer, android developer"
            value={form.keywords}
            onChange={(e) => updateField('keywords', e.target.value)}
          />
        </label>

        <label className="field">
          <span>Pages per keyword</span>
          <input
            type="number"
            min="1"
            max={MAX_PAGES_PER_KEYWORD}
            value={form.pagesPerKeyword}
            onChange={(e) => updateField('pagesPerKeyword', e.target.value)}
          />
          <small className="hint">
            Ignored — fetch auto-paginates until LinkedIn has no more results.
          </small>
        </label>

        <label className="field field-full">
          <span>Job region</span>
          <select
            value={form.regionGeoId}
            onChange={(e) => updateField('regionGeoId', e.target.value)}
          >
            {REGION_OPTIONS.map((region) => (
              <option key={region.geoId} value={region.geoId}>
                {region.label}
              </option>
            ))}
          </select>
          <small className="hint">
            Preset regions filter LinkedIn results.
          </small>
        </label>

        {form.regionGeoId === 'custom' && (
          <label className="field field-full">
            <span>Custom geo ID</span>
            <input
              type="text"
              placeholder="e.g. 103644278"
              value={form.customGeoId}
              onChange={(e) => updateField('customGeoId', e.target.value)}
            />
            <small className="hint">
              Passed as LinkedIn <code>geoId</code> in the search URL. Preset
              regions are usually easier.
            </small>
          </label>
        )}

        <label className="field">
          <span>Scrape date range</span>
          <select
            value={form.scrapeDateFilter}
            onChange={(e) => updateField('scrapeDateFilter', e.target.value)}
          >
            {SCRAPE_DATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <small className="hint">
            Controls LinkedIn search window (f_TPR). Last 24 hours is fastest — good for
            daily fetches.
          </small>
        </label>

        <label className="field">
          <span>Work type</span>
          <select
            value={form.workTypeFilter ?? 'all'}
            onChange={(e) => updateField('workTypeFilter', e.target.value)}
          >
            {WORK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <small className="hint">
            Filters fetch results by Remote, Hybrid or on Site.
          </small>
        </label>

        <label className="field field-full">
          <span className="filter-toggle">
            <input
              type="checkbox"
              checked={form.fetchCompanySize !== false}
              onChange={(e) => updateField('fetchCompanySize', e.target.checked)}
            />
            <span>Fetch company size (employee count)</span>
          </span>
          <small className="hint">
            Slower — loads each company profile during fetch.
          </small>
        </label>

        <label className="field field-full">
          <span>LinkedIn li_at cookie (optional)</span>
          <input
            type="password"
            placeholder="Paste your li_at cookie value"
            value={form.liAtCookie}
            onChange={(e) => updateField('liAtCookie', e.target.value)}
            autoComplete="off"
          />
          <small className="hint">
            Optional — Settings or <code>LI_AT_COOKIE</code> in <code>.env</code> (Settings
            wins). Company pages only, not job search. Paste the value from DevTools (not{' '}
            <code>li_at=</code>).
          </small>
        </label>

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleTestScraper}
            disabled={testing}
          >
            {testing ? 'Testing…' : 'Test Scraper'}
          </button>
          <button type="submit" className="btn btn-primary">
            Save Settings
          </button>
        </div>

        {error && <div className="banner banner-error">{error}</div>}
        {saved && <div className="banner banner-success">Settings saved.</div>}
        {testStatus && (
          <div
            className={`banner ${
              testStatus.startsWith('Scraper connected')
                ? 'banner-success'
                : 'banner-error'
            }`}
          >
            {testStatus}
          </div>
        )}
      </form>
    </Layout>
  )
}
