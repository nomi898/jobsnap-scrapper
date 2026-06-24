import { useEffect, useMemo, useState } from 'react'
import FieldHint from '../components/FieldHint'
import Layout from '../components/Layout'
import {
  REGION_OPTIONS,
  SCRAPE_DATE_OPTIONS,
  WORK_TYPE_OPTIONS,
  getScrapeDateLabel,
} from '../constants'
import { useSettings } from '../hooks/useSettings'
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

  useEffect(() => {
    setForm({
      ...settings,
      ...getFormRegionValues(settings),
    })
  }, [settings])

  const hasUnsavedChanges = useMemo(() => {
    const saved = {
      keywords: parseKeywordList(settings.keywords).join(', '),
      scrapeDateFilter: settings.scrapeDateFilter,
      workTypeFilter: settings.workTypeFilter ?? 'all',
      regionGeoId: settings.regionGeoId,
      customGeoId: settings.customGeoId ?? '',
      fetchCompanySize: settings.fetchCompanySize !== false,
      liAtCookie: normalizeLiAtCookie(settings.liAtCookie),
    }
    const draft = {
      keywords: parseKeywordList(form.keywords).join(', '),
      scrapeDateFilter: form.scrapeDateFilter,
      workTypeFilter: form.workTypeFilter ?? 'all',
      regionGeoId: form.regionGeoId,
      customGeoId: form.customGeoId ?? '',
      fetchCompanySize: form.fetchCompanySize !== false,
      liAtCookie: normalizeLiAtCookie(form.liAtCookie),
    }
    return JSON.stringify(saved) !== JSON.stringify(draft)
  }, [form, settings])

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
    setError('')
  }

  const validateForm = () => {
    const keywords = parseKeywordList(form.keywords)

    if (keywords.length === 0) {
      return 'Add at least one keyword.'
    }

    if (form.regionGeoId === 'custom' && !form.customGeoId.trim()) {
      return 'Enter a custom LinkedIn geo ID.'
    }

    if (form.fetchCompanySize !== false && !normalizeLiAtCookie(form.liAtCookie)) {
      return 'Add your li_at cookie to fetch company sizes from LinkedIn company profiles.'
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
      keywords: parseKeywordList(form.keywords).join(', '),
      scrapeDateFilter: form.scrapeDateFilter,
      workTypeFilter: form.workTypeFilter ?? 'all',
      regionGeoId: form.regionGeoId,
      customGeoId: form.customGeoId ?? '',
      liAtCookie: normalizeLiAtCookie(form.liAtCookie),
      fetchCompanySize: form.fetchCompanySize !== false,
    })
    setSaved(true)
    setError('')
  }

  return (
    <Layout title="Settings" showBack>
      <div className="settings-page">
        {hasUnsavedChanges && (
          <div className="banner banner-warning">
            Unsaved changes — dashboard still uses{' '}
            <strong>{getScrapeDateLabel(settings.scrapeDateFilter)}</strong> until
            you click Save Settings.
          </div>
        )}

        <form className="settings-form" onSubmit={handleSubmit}>
          <section className="settings-card">
            <h2 className="settings-section-title">Search</h2>
            <div className="settings-fields">
              <label className="field field-full">
                <span className="field-label-row">
                  Keywords
                  <FieldHint label="Keywords help">
                    Comma-separated job titles or skills. Each keyword is searched
                    separately when you fetch jobs. For safer LinkedIn guest
                    scraping, enter up to 5 keywords per run.
                  </FieldHint>
                </span>
                <input
                  type="text"
                  placeholder="ios developer, android developer"
                  value={form.keywords}
                  onChange={(e) => updateField('keywords', e.target.value)}
                />
                <span className="muted">
                  Tip: keep this to 5 keywords or fewer, then change the list for
                  the next run.
                </span>
              </label>

              <label className="field field-full">
                <span className="field-label-row">
                  Job region
                  <FieldHint label="Job region help">
                    Preset regions filter LinkedIn results.
                  </FieldHint>
                </span>
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
              </label>

              {form.regionGeoId === 'custom' && (
                <label className="field field-full">
                  <span className="field-label-row">
                    Custom geo ID
                    <FieldHint label="Custom geo ID help">
                      Passed as LinkedIn <code>geoId</code> in the search URL. Preset
                      regions are usually easier.
                    </FieldHint>
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. 103644278"
                    value={form.customGeoId}
                    onChange={(e) => updateField('customGeoId', e.target.value)}
                  />
                </label>
              )}
            </div>
          </section>

          <section className="settings-card">
            <h2 className="settings-section-title">Fetch filters</h2>
            <div className="settings-grid">
              <label className="field">
                <span className="field-label-row">
                  Scrape date range
                  <FieldHint label="Scrape date range help">
                    Applied when fetching from LinkedIn (URL + post-filter). Save
                    settings, then Fetch Jobs. Dashboard Date filter only narrows
                    loaded results.
                  </FieldHint>
                </span>
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
              </label>

              <label className="field">
                <span className="field-label-row">
                  Work type
                  <FieldHint label="Work type help">
                    Filters fetch results by Remote, Hybrid or on Site.
                  </FieldHint>
                </span>
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
              </label>
            </div>
          </section>

          <section className="settings-card">
            <h2 className="settings-section-title">Advanced</h2>
            <div className="settings-fields">
              <div
                className={`settings-toggle-card${
                  form.fetchCompanySize !== false ? ' settings-toggle-card-on' : ''
                }`}
              >
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={form.fetchCompanySize !== false}
                    onChange={(e) =>
                      updateField('fetchCompanySize', e.target.checked)
                    }
                  />
                  <span className="settings-toggle-text">
                    <span className="settings-toggle-title">
                      Fetch company size
                      <FieldHint variant="alert" label="Fetch company size help">
                        Slower — loads each company profile during fetch.
                      </FieldHint>
                    </span>
                    <span className="settings-toggle-sub">
                      Employee count from company profiles. Requires li_at cookie.
                    </span>
                  </span>
                </label>
              </div>

              <label className="field field-full">
                <span className="field-label-row">
                  <span className="field-label-text">
                    LinkedIn li_at cookie
                    <span className="field-optional">optional</span>
                    <FieldHint label="LinkedIn li_at cookie help">
                      Optional — Settings or <code>LI_AT_COOKIE</code> in{' '}
                      <code>.env</code> (Settings wins). If provided, JobSnap
                      tries authenticated job search and falls back to guest
                      search if LinkedIn rejects the session. Paste the value
                      from DevTools (not <code>li_at=</code>).
                    </FieldHint>
                  </span>
                </span>
                <input
                  type="password"
                  placeholder="Paste your li_at cookie value"
                  value={form.liAtCookie}
                  onChange={(e) => updateField('liAtCookie', e.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
          </section>

          <div className="settings-footer">
            {error && <div className="banner banner-error">{error}</div>}
            {saved && <div className="banner banner-success">Settings saved.</div>}
            <button type="submit" className="btn btn-primary btn-save">
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
