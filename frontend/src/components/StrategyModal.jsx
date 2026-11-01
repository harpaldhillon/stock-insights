import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import HighBadge from './HighBadge'
import { SIGNALS, allItems, matchesHighs, matchesSearch, matchesSector } from '../lib/filters'

const INDEX_TEXT = {
  ALL: { name: 'all tracked', desc: 'Every stock tracked: FTSE 100, FTSE 250, FTSE SmallCap and NASDAQ-100.' },
  FTSE100: { name: 'FTSE 100', desc: 'The 100 largest companies listed in London, by market value.' },
  FTSE250: { name: 'FTSE 250', desc: 'The next 250 largest companies: UK mid caps.' },
  'FTSE SmallCap': { name: 'FTSE SmallCap', desc: 'Smaller companies outside the FTSE 350.' },
  NASDAQ100: { name: 'NASDAQ-100', desc: 'The 100 largest non-financial companies listed on the US Nasdaq exchange, priced in US dollars.' },
}

const SORT_TEXT = {
  score_desc: { name: 'score, highest first', desc: 'Strongest technical setups at the top of each panel.' },
  score_asc: { name: 'score, lowest first', desc: 'Weakest technical setups at the top of each panel.' },
  ticker: { name: 'ticker, A–Z', desc: 'Alphabetical by ticker; ranking ignored.' },
}

const SIGNAL_STYLE = {
  BUY: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  HOLD: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  SELL: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
}

const TOP_PICKS = 5

// Strategy rules come from the backend's scoring constants and never change
// while the page is open, so fetch them once and share across openings.
let strategyCache = null

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function StrategyModal({ onClose, dashboardState, status }) {
  const navigate = useNavigate()
  const [strategy, setStrategy] = useState(strategyCache)
  const [error, setError] = useState(false)
  const { filters, search, summary } = dashboardState

  useEffect(() => {
    if (strategyCache) return
    api.get('/api/strategy')
      .then((r) => { strategyCache = r.data; setStrategy(r.data) })
      .catch((err) => { console.error(err); setError(true) })
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // Same filter steps, in the same order, as the dashboard applies them.
  const funnel = useMemo(() => {
    if (!summary) return null
    const indexItems = allItems(summary)
    const steps = []
    const total = status?.total_stocks ?? indexItems.length
    steps.push({ label: 'All analysed stocks', count: total })
    if (filters.index !== 'ALL') steps.push({ label: `Index: ${INDEX_TEXT[filters.index]?.name ?? filters.index}`, count: indexItems.length })
    let items = indexItems
    if (filters.sector) {
      items = items.filter((i) => matchesSector(i, filters.sector))
      steps.push({ label: `Sector: ${filters.sector}`, count: items.length })
    }
    if (filters.highs) {
      items = items.filter((i) => matchesHighs(i, filters.highs))
      steps.push({ label: filters.highs === 'multi' ? 'Highs: multi-year breakout' : 'Highs: at 52-week high', count: items.length })
    }
    if (search.trim()) {
      items = items.filter((i) => matchesSearch(i, search))
      steps.push({ label: `Search: “${search.trim()}”`, count: items.length })
    }
    const bySignal = Object.fromEntries(SIGNALS.map((s) => [s, items.filter((i) => i.signal === s).length]))
    const topBuys = items.filter((i) => i.signal === 'BUY').sort((a, b) => b.score - a.score).slice(0, TOP_PICKS)
    return { steps, total, final: items.length, bySignal, topBuys }
  }, [summary, filters, search, status])

  const indexInfo = INDEX_TEXT[filters.index] ?? { name: filters.index, desc: '' }
  const sortInfo = SORT_TEXT[filters.sort] ?? { name: filters.sort, desc: '' }
  const highsPhrase = filters.highs === 'multi' ? ' breaking out to multi-year highs'
    : filters.highs === '52w' ? ' trading at a 52-week high' : ''
  const sentence = `Showing ${indexInfo.name} stocks${filters.sector ? ` in the ${filters.sector} sector` : ''}${highsPhrase}${search.trim() ? ` matching “${search.trim()}”` : ''}, sorted by ${sortInfo.name}.`

  const h = strategy?.highs
  const t = strategy?.trade_levels
  const ruleGroups = useMemo(() => {
    if (!strategy) return []
    const groups = []
    for (const r of strategy.rules) {
      const g = groups.find((x) => x.name === r.group)
      g ? g.rules.push(r) : groups.push({ name: r.group, rules: [r] })
    }
    return groups
  }, [strategy])

  const openStock = (ticker) => { onClose(); navigate(`/stock/${ticker}`) }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Stock selection strategy"
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Stock selection strategy</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">How the dashboard picks stocks for your current filters</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close strategy"
            title="Close (Esc)"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="space-y-8 px-6 py-6 text-sm text-slate-600 dark:text-slate-300">
          <Section title="Your selection">
            <p className="text-base text-slate-800 dark:text-slate-100">{sentence}</p>
          </Section>

          <Section title="How your filters narrow the list">
            {!funnel ? (
              <p className="text-slate-400">Loading stock data…</p>
            ) : (
              <>
                <ol className="space-y-2">
                  {funnel.steps.map((step, i) => (
                    <li key={step.label} className="flex items-center gap-3">
                      <span className="w-6 shrink-0 text-right text-xs text-slate-400">{i + 1}.</span>
                      <span className="w-48 shrink-0 truncate sm:w-56" title={step.label}>{step.label}</span>
                      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-sky-500"
                          style={{ width: `${funnel.total ? Math.max((step.count / funnel.total) * 100, step.count ? 1 : 0) : 0}%` }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">{step.count}</span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2 pt-1">
                  {SIGNALS.map((s) => (
                    <span key={s} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${SIGNAL_STYLE[s]}`}>
                      {s} <span className="ml-1 font-mono">{funnel.bySignal[s]}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Section>

          <Section title="What your filters mean">
            <dl className="space-y-2">
              <div><dt className="inline font-medium text-slate-800 dark:text-slate-100">Index ({indexInfo.name}): </dt><dd className="inline">{indexInfo.desc}</dd></div>
              {filters.sector && (
                <div><dt className="inline font-medium text-slate-800 dark:text-slate-100">Sector ({filters.sector}): </dt><dd className="inline">Only companies classified in this sector.</dd></div>
              )}
              {filters.highs === '52w' && (
                <div><dt className="inline font-medium text-slate-800 dark:text-slate-100">At 52-week high: </dt><dd className="inline">
                  {h ? `The latest close is within ${h.tolerance_pct}% of the highest close of the past year: the stock is at or near a new high.` : 'Loading…'}
                </dd></div>
              )}
              {filters.highs === 'multi' && (
                <div><dt className="inline font-medium text-slate-800 dark:text-slate-100">Multi-year breakout: </dt><dd className="inline">
                  {h ? `At a 52-week high (within ${h.tolerance_pct}%), and the peak of the last ${h.recent_days} trading days is the highest close in at least ${h.multi_year_min_years} years. The badge shows how many years; “5y+” means the highest in all 5 years of data loaded.` : 'Loading…'}
                </dd></div>
              )}
              {search.trim() && (
                <div><dt className="inline font-medium text-slate-800 dark:text-slate-100">Search: </dt><dd className="inline">Ticker or company name contains “{search.trim()}”.</dd></div>
              )}
              <div><dt className="inline font-medium text-slate-800 dark:text-slate-100">Sort ({sortInfo.name}): </dt><dd className="inline">{sortInfo.desc}</dd></div>
            </dl>
          </Section>

          <Section title="How every stock is scored">
            {error ? (
              <p className="text-rose-500">Couldn’t load the scoring rules.</p>
            ) : !strategy ? (
              <p className="text-slate-400">Loading rules…</p>
            ) : (
              <>
                <p>
                  Each stock earns or loses points on the rules below, using daily closing prices.
                  A total of <b className="text-emerald-600 dark:text-emerald-400">+{strategy.signal_threshold} or more is BUY</b>,{' '}
                  <b className="text-rose-600 dark:text-rose-400">−{strategy.signal_threshold} or less is SELL</b>, and anything between is HOLD.
                  Conviction is HIGH beyond ±{strategy.conviction_high_threshold}, MEDIUM from ±{strategy.signal_threshold}, otherwise LOW.
                </p>
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {ruleGroups.map((g) => g.rules.map((r, i) => (
                        <tr key={r.rule}>
                          {i === 0 && (
                            <th rowSpan={g.rules.length} className="w-24 bg-slate-50 px-3 py-2 align-top font-semibold text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">{g.name}</th>
                          )}
                          <td className="px-3 py-2">{r.rule}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-slate-800 dark:text-slate-100">{r.points}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Section>

          {t && (
            <Section title="How trade levels are set">
              <ul className="list-disc space-y-1 pl-5">
                <li><b className="text-slate-800 dark:text-slate-100">Entry zone:</b> ±{t.entry_zone_pct}% around the higher of the 20-day EMA and 50-day SMA, which means buying on a pullback to trend support.</li>
                <li><b className="text-slate-800 dark:text-slate-100">Stop loss:</b> {t.stop_atr}× ATR(14) below the bottom of the entry zone.</li>
                <li><b className="text-slate-800 dark:text-slate-100">Target:</b> above the entry zone by {t.target_atr}× ATR, scaled by score ÷ {t.score_divisor}, so stronger setups get further targets.</li>
                <li><b className="text-slate-800 dark:text-slate-100">R:R</b> = (target − entry mid) ÷ (entry mid − stop).</li>
              </ul>
            </Section>
          )}

          <Section title={`Top BUY candidates in this selection`}>
            {!funnel ? null : funnel.topBuys.length === 0 ? (
              <p className="text-slate-400">No BUY signals in the current selection.</p>
            ) : (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {funnel.topBuys.map((item) => (
                  <li key={item.ticker}>
                    <button
                      onClick={() => openStock(item.ticker)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <span className="w-16 shrink-0 font-mono text-xs font-semibold text-slate-900 dark:text-white">{item.ticker}</span>
                      <span className="min-w-0 flex-1 truncate text-xs"><HighBadge highs={item.notes?.highs} />{item.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">{item.conviction}</span>
                      <span className="w-10 shrink-0 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">{item.score.toFixed(1)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <p className="border-t border-slate-200 pt-4 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Technical signals only: no fundamentals, news or valuation. For educational purposes, not financial advice.
          </p>
        </div>
      </div>
    </div>
  )
}

export default StrategyModal
