import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import StockTable from '../components/StockTable'
import SignalBadge from '../components/SignalBadge'

const indexOptions = ['ALL', 'FTSE100', 'FTSE250', 'FTSE SmallCap']
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

function Dashboard({ status, refreshTick = 0 }) {
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [filters, setFilters] = useState({ index: 'ALL', sector: '', sort: 'score_desc' })
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)

  // Re-fetches on mount, when index/sort change, and when the header's Refresh
  // button confirms a background refresh has actually finished (refreshTick).
  // Sector is deliberately NOT sent to the backend — see sectorFilteredSummary
  // below for why it's applied client-side instead.
  useEffect(() => {
    fetchSummary()
  }, [filters.index, filters.sort, refreshTick])

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const params = { index: filters.index, sort: filters.sort }
      const response = await api.get('/api/summary', { params })
      setSummary(response.data)
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

  const sectorFilteredSummary = useMemo(() => {
    if (!summary) return null
    if (!filters.sector) return summary
    const match = (item) => item.sector === filters.sector
    return { BUY: summary.BUY.filter(match), HOLD: summary.HOLD.filter(match), SELL: summary.SELL.filter(match) }
  }, [summary, filters.sector])

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
      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-16 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <svg className="mx-auto animate-spin text-sky-500" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">Analysing stocks…</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">May take a moment the first time</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* BUY */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-4 py-3 dark:border-emerald-900/30 dark:bg-emerald-950/30">
              <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                BUY <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs dark:bg-emerald-900/50 dark:text-emerald-300">{filteredSummary?.BUY.length ?? 0}</span>
              </h3>
              <SignalBadge signal="BUY" />
            </div>
            <div className="p-3">
              <StockTable rows={filteredSummary?.BUY || []} onRowClick={(ticker) => navigate(`/stock/${ticker}`)} />
            </div>
          </div>

          {/* HOLD */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-4 py-3 dark:border-amber-900/30 dark:bg-amber-950/30">
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                HOLD <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs dark:bg-amber-900/50 dark:text-amber-300">{filteredSummary?.HOLD.length ?? 0}</span>
              </h3>
              <SignalBadge signal="HOLD" />
            </div>
            <div className="p-3">
              <StockTable rows={filteredSummary?.HOLD || []} onRowClick={(ticker) => navigate(`/stock/${ticker}`)} />
            </div>
          </div>

          {/* SELL */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-4 py-3 dark:border-rose-900/30 dark:bg-rose-950/30">
              <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-400">
                SELL <span className="ml-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-xs dark:bg-rose-900/50 dark:text-rose-300">{filteredSummary?.SELL.length ?? 0}</span>
              </h3>
              <SignalBadge signal="SELL" />
            </div>
            <div className="p-3">
              <StockTable rows={filteredSummary?.SELL || []} onRowClick={(ticker) => navigate(`/stock/${ticker}`)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
