import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import SignalPanel from '../components/SignalPanel'

const indexOptions = ['ALL', 'FTSE100', 'FTSE250', 'FTSE SmallCap']
// Client-side "Highs" filter over analysis.notes.highs (computed by the analyser).
const HIGHS_FILTERS = {
  '':    () => true,
  '52w': (item) => !!item.notes?.highs?.at_52w_high,
  multi: (item) => !!item.notes?.highs?.multi_year_breakout,
}

const sortOptions = [
  { value: 'score_desc', label: 'Score (high → low)' },
  { value: 'score_asc',  label: 'Score (low → high)' },
  { value: 'ticker',     label: 'Alphabetical' },
]

function StatPill({ label, value, colorClass }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl border px-4 py-3 ${colorClass}`}>
      <span className="text-xs font-medium opacity-60">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value ?? '—'}</span>
    </div>
  )
}

// Dashboard state lives in App (passed in as state/setState) rather than here,
// so filters, fetched rows, table pages and the expanded panel all survive
// navigating to a stock page and back.
export const INITIAL_DASHBOARD_STATE = {
  filters: { index: 'ALL', sector: '', highs: '', sort: 'score_desc' },
  search: '',
  summary: null,
  fetchedKey: null,   // which index/sort/refreshTick `summary` was fetched for
  pages: {},          // table page per panel, e.g. { BUY: 2, 'BUY-lg': 0 }
  expanded: null,     // 'BUY' | 'HOLD' | 'SELL' while a panel is full screen
}

function Dashboard({ status, refreshTick = 0, state, setState }) {
  const navigate = useNavigate()
  const { filters, search, summary, fetchedKey, pages, expanded } = state
  const [loading, setLoading] = useState(false)

  const update = (patch) =>
    setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))
  // Any filter or search change starts every table back on its first page.
  const setFilters = (fn) => update((s) => ({ filters: fn(s.filters), pages: {} }))
  const setSearch  = (value) => update({ search: value, pages: {} })

  // Only index and sort are sent to the backend, so only they (or a finished
  // Refresh, via refreshTick) need new rows. Coming back to this page with the
  // same key reuses the rows already fetched. Sector, Highs and Search filter
  // client-side — see sectorFilteredSummary below.
  const summaryKey = `${filters.index}|${filters.sort}|${refreshTick}`
  useEffect(() => {
    if (summary && fetchedKey === summaryKey) return
    fetchSummary(summaryKey)
  }, [summaryKey])

  const fetchSummary = async (key) => {
    setLoading(true)
    try {
      const params = { index: filters.index, sort: filters.sort }
      const response = await api.get('/api/summary', { params })
      update({ summary: response.data, fetchedKey: key })
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // The full, sector-unfiltered set for the current index — the Sector
  // dropdown's option list is always derived from this, so it never shrinks
  // to just the currently-selected sector (which previously made the filter
  // look "stuck": after picking one sector, every other option disappeared).
  const allItems = useMemo(() => {
    if (!summary) return []
    return [...summary.BUY, ...summary.HOLD, ...summary.SELL]
  }, [summary])

  const sectors = useMemo(() => {
    const all = allItems.map((item) => item.sector)
    return [...new Set(all)].sort()
  }, [allItems])

  // If the selected sector doesn't exist for the newly-selected index, drop it
  // instead of silently filtering everything down to zero rows.
  useEffect(() => {
    if (filters.sector && summary && !sectors.includes(filters.sector)) {
      setFilters((f) => ({ ...f, sector: '' }))
    }
  }, [sectors, summary, filters.sector])

  // Counts shown in the Highs dropdown, within the currently selected sector.
  const highsCounts = useMemo(() => {
    const inSector = allItems.filter((item) => !filters.sector || item.sector === filters.sector)
    return {
      '52w': inSector.filter(HIGHS_FILTERS['52w']).length,
      multi: inSector.filter(HIGHS_FILTERS.multi).length,
    }
  }, [allItems, filters.sector])

  const sectorFilteredSummary = useMemo(() => {
    if (!summary) return null
    if (!filters.sector && !filters.highs) return summary
    const highsMatch = HIGHS_FILTERS[filters.highs] || HIGHS_FILTERS['']
    const match = (item) => (!filters.sector || item.sector === filters.sector) && highsMatch(item)
    return { BUY: summary.BUY.filter(match), HOLD: summary.HOLD.filter(match), SELL: summary.SELL.filter(match) }
  }, [summary, filters.sector, filters.highs])

  const sectorFilteredItems = useMemo(() => {
    if (!sectorFilteredSummary) return []
    return [...sectorFilteredSummary.BUY, ...sectorFilteredSummary.HOLD, ...sectorFilteredSummary.SELL]
  }, [sectorFilteredSummary])

  const stats = useMemo(() => {
    if (!status || !sectorFilteredSummary) return null
    const total = status.total_stocks || 1
    const buyPct  = ((sectorFilteredSummary.BUY.length  / total) * 100).toFixed(0)
    const holdPct = ((sectorFilteredSummary.HOLD.length / total) * 100).toFixed(0)
    const sellPct = ((sectorFilteredSummary.SELL.length / total) * 100).toFixed(0)
    const avgScore = sectorFilteredItems.length
      ? (sectorFilteredItems.reduce((sum, item) => sum + item.score, 0) / sectorFilteredItems.length).toFixed(2)
      : '0.00'
    return { total, buyPct, holdPct, sellPct, avgScore }
  }, [status, sectorFilteredSummary, sectorFilteredItems])

  const filteredSummary = useMemo(() => {
    if (!sectorFilteredSummary) return null
    const q = search.trim().toLowerCase()
    if (!q) return sectorFilteredSummary
    const match = (item) =>
      item.ticker.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q)
    return {
      BUY: sectorFilteredSummary.BUY.filter(match),
      HOLD: sectorFilteredSummary.HOLD.filter(match),
      SELL: sectorFilteredSummary.SELL.filter(match),
    }
  }, [sectorFilteredSummary, search])

  const selectClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
  const labelClass  = 'mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400'

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Summary</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatPill
            label="Total stocks"
            value={stats?.total ?? '—'}
            colorClass="border-slate-200 text-slate-800 dark:border-slate-700 dark:text-slate-200"
          />
          <StatPill
            label="Buy"
            value={stats ? `${stats.buyPct}%` : '—'}
            colorClass="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          />
          <StatPill
            label="Hold"
            value={stats ? `${stats.holdPct}%` : '—'}
            colorClass="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
          />
          <StatPill
            label="Sell"
            value={stats ? `${stats.sellPct}%` : '—'}
            colorClass="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          />
          <StatPill
            label="Avg score"
            value={stats?.avgScore ?? '—'}
            colorClass="border-slate-200 text-slate-800 dark:border-slate-700 dark:text-slate-200"
          />
        </div>
      </div>

      {/* Filters — horizontal row */}
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className={labelClass}>Search</label>
            <div className="relative">
              <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ticker or company name…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-600"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  aria-label="Clear search"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}
            </div>
          </div>

          <div>
            <label className={labelClass}>Index</label>
            <select
              value={filters.index}
              onChange={(e) => setFilters((f) => ({ ...f, index: e.target.value }))}
              className={selectClass}
            >
              {indexOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className={labelClass}>Sector</label>
            <select
              value={filters.sector}
              onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
              className={`${selectClass} w-full`}
            >
              <option value="">All sectors</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Highs</label>
            <select
              value={filters.highs}
              onChange={(e) => setFilters((f) => ({ ...f, highs: e.target.value }))}
              className={selectClass}
            >
              <option value="">All stocks</option>
              <option value="52w">At 52-week high ({highsCounts['52w']})</option>
              <option value="multi">Multi-year breakout ({highsCounts.multi})</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Sort by</label>
            <select
              value={filters.sort}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
              className={selectClass}
            >
              {sortOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Signal columns */}
      {loading || !summary ? (
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <svg className="mx-auto animate-spin text-sky-500" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">Analysing stocks…</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">May take a moment the first time</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {['BUY', 'HOLD', 'SELL'].map((signal) => {
            const isExpanded = expanded === signal
            // Separate page per view: the expanded table shows 50 rows/page, the panel 25.
            const pageKey = isExpanded ? `${signal}-lg` : signal
            return (
              <SignalPanel
                key={signal}
                signal={signal}
                rows={filteredSummary?.[signal] || []}
                onRowClick={(ticker) => navigate(`/stock/${ticker}`)}
                expanded={isExpanded}
                onExpandedChange={(open) => update({ expanded: open ? signal : null })}
                page={pages[pageKey] || 0}
                onPageChange={(p) => update((s) => ({ pages: { ...s.pages, [pageKey]: p } }))}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Dashboard
