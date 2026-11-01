import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import api from './api/client'
import Dashboard, { INITIAL_DASHBOARD_STATE } from './pages/Dashboard'
import StockDetail from './pages/StockDetail'
import ThemeToggle from './components/ThemeToggle'
import StrategyModal from './components/StrategyModal'

const CompassIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
)

const StrategyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6" /><path d="M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
  </svg>
)

const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 200 // ~10 minutes at 3s intervals — a full refresh over ~500 tickers can take several minutes

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function App() {
  const [status, setStatus] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  // Owned here, not in Dashboard, so it survives visiting a stock page and coming back.
  const [dashboardState, setDashboardState] = useState(INITIAL_DASHBOARD_STATE)
  const [strategyOpen, setStrategyOpen] = useState(false)
  const closeStrategy = useCallback(() => setStrategyOpen(false), [])
  // The strategy explains the dashboard's filters, so it only belongs on the dashboard.
  const onDashboard = useLocation().pathname === '/'

  const fetchStatus = async () => {
    const r = await api.get('/api/status')
    setStatus(r.data)
    return r.data
  }

  // Poll until the backend reports the refresh job has actually finished,
  // rather than trusting the instant response from GET /api/refresh.
  const pollUntilIdle = async () => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      let data
      try {
        data = await fetchStatus()
      } catch (err) {
        console.error(err)
        break
      }
      if (!data.refreshing) {
        setRefreshTick((t) => t + 1) // tells the dashboard fresh data is available
        return
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  useEffect(() => {
    let mounted = true
    const init = async () => {
      let data
      try {
        data = await fetchStatus()
      } catch (err) {
        console.error(err)
        return
      }
      // A refresh may already be running (startup load, scheduled job, or
      // another tab) — reflect that in the button instead of looking idle.
      if (mounted && data?.refreshing) {
        setRefreshing(true)
        await pollUntilIdle()
        if (mounted) setRefreshing(false)
      }
    }
    init()
    return () => { mounted = false }
  }, [])

  const onRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await api.get('/api/refresh')
      await pollUntilIdle()
    } catch (err) {
      console.error(err)
    } finally {
      setRefreshing(false)
    }
  }

  const statusLabel = refreshing
    ? 'Refreshing…'
    : status?.last_updated
      ? `Updated ${new Date(status.last_updated).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
      : 'Loading…'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#080d18] dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/95 dark:shadow-black/20">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <Link to="/" className="group flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white shadow-md shadow-sky-500/25 transition-transform duration-200 group-hover:scale-105">
              <CompassIcon />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-2">
                <p className="truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  Stock Insight
                </p>
                <span className="relative hidden h-2 w-2 shrink-0 sm:flex" title="Live">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              </div>
              <p className="truncate text-sm text-slate-400 dark:text-slate-500">
                Technical signals for UK &amp; US stocks
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-4">
            <span
              className="hidden text-xs font-medium text-slate-400 dark:text-slate-500 sm:inline-block"
              title="Data refreshes automatically once daily after UK market close"
            >
              {statusLabel}
            </span>
            <span className="hidden h-6 w-px bg-slate-200 dark:bg-slate-800 sm:inline-block" />
            <ThemeToggle />
            {onDashboard && (
              <button
                onClick={() => setStrategyOpen(true)}
                title="How stocks are selected for the current filters"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <StrategyIcon />
                <span className="hidden sm:inline">Strategy</span>
              </button>
            )}
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              {refreshing ? (
                <>
                  <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                  <span className="hidden sm:inline">Refreshing…</span>
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                  <span className="hidden sm:inline">Refresh</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<Dashboard status={status} refreshTick={refreshTick} state={dashboardState} setState={setDashboardState} />} />
          <Route path="/stock/:ticker" element={<StockDetail />} />
        </Routes>
      </main>

      {strategyOpen && onDashboard && (
        <StrategyModal onClose={closeStrategy} dashboardState={dashboardState} status={status} />
      )}

      <footer className="mt-8 border-t border-slate-200 py-5 text-center text-xs text-slate-400 dark:border-slate-800 dark:text-slate-600">
        Data refreshes daily after UK market close · For educational purposes only — not financial advice.
      </footer>
    </div>
  )
}

export default App
