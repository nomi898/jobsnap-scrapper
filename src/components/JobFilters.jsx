import {
  COMPANY_SIZE_FILTER_OPTIONS,
  DISPLAY_DATE_OPTIONS,
  SORT_OPTIONS,
  WORK_TYPE_OPTIONS,
} from '../constants'

export default function JobFilters({
  filters,
  onChange,
  onClear,
  keywords,
  hasActiveFilters = false,
}) {
  const keywordOptions = [
    { value: 'all', label: 'All keywords' },
    ...keywords.map((k) => ({ value: k, label: k })),
  ]

  return (
    <section className="filters">
      <h2 className="section-label">Filters</h2>
      <div className="filters-grid">
        <label className="field">
          <span>Search title</span>
          <input
            type="search"
            placeholder="e.g. iOS Developer"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Date</span>
          <select
            value={filters.dateFilter}
            onChange={(e) => onChange({ dateFilter: e.target.value })}
          >
            {DISPLAY_DATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Country</span>
          <input
            type="search"
            placeholder="e.g. United States"
            value={filters.location}
            onChange={(e) => onChange({ location: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Company</span>
          <input
            type="search"
            placeholder="e.g. Apple"
            value={filters.company}
            onChange={(e) => onChange({ company: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Company size</span>
          <select
            value={filters.companySize}
            onChange={(e) => onChange({ companySize: e.target.value })}
          >
            {COMPANY_SIZE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Work type</span>
          <select
            value={filters.workType}
            onChange={(e) => onChange({ workType: e.target.value })}
          >
            {WORK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Keyword</span>
          <select
            value={filters.keyword}
            onChange={(e) => onChange({ keyword: e.target.value })}
          >
            {keywordOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Sort</span>
          <select
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value })}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="filters-toggles">
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={Boolean(filters.hideViewed)}
            onChange={(e) => onChange({ hideViewed: e.target.checked })}
          />
          <span>Hide viewed</span>
        </label>

        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={Boolean(filters.hideApplied)}
            onChange={(e) => onChange({ hideApplied: e.target.checked })}
          />
          <span>Hide interacted</span>
        </label>

        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={Boolean(filters.hideDuplicateTitleCompany)}
            onChange={(e) =>
              onChange({ hideDuplicateTitleCompany: e.target.checked })
            }
          />
          <span>Hide multi location duplicates</span>
        </label>
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onClear}
        disabled={!hasActiveFilters}
      >
        Clear filters
      </button>
    </section>
  )
}
