import SignalBadge from './SignalBadge'

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const AlertIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

function VerdictPanel({ analysis, notes }) {
  const bullFactors = [
    analysis.score >= 0 ? 'Score positive momentum' : null,
    analysis.rsi14 && analysis.rsi14 < 70 ? 'RSI not overbought' : null,
    analysis.ema20 && analysis.entry_zone_low < analysis.entry_zone_high ? 'Price near trend support' : null,
  ].filter(Boolean)

  const riskFactors = [
    analysis.score <= 0 ? 'Score weak or negative' : null,
    analysis.rsi14 && analysis.rsi14 > 70 ? 'RSI may be overbought' : null,
    notes?.golden_cross === false ? 'No fresh bullish cross' : null,
  ].filter(Boolean)

  const summaryText = {
    BUY:  'Technical momentum looks constructive for a long entry with defined risk.',
    SELL: 'Market structure suggests caution and potential downside pressure.',
    HOLD: 'Price action is balanced — hold until a clearer trend emerges.',
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Verdict header */}
      <div className="flex flex-col gap-4 border-b border-slate-100 p-6 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Verdict</p>
          <h3 className="mt-1.5 text-xl font-semibold text-slate-900 dark:text-white">
            {analysis.signal} · {analysis.conviction}
          </h3>
          <p className="mt-1.5 max-w-lg text-sm text-slate-500 dark:text-slate-400">
            {summaryText[analysis.signal] || summaryText.HOLD}
          </p>
        </div>
        <SignalBadge signal={analysis.signal} conviction={analysis.conviction} />
      </div>

      {/* Bullish / Risk factors */}
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/20">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-500">Bullish Factors</p>
          <ul className="space-y-2">
            {bullFactors.length ? bullFactors.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                <span className="mt-0.5 shrink-0 text-emerald-500"><CheckIcon /></span>
                {item}
              </li>
            )) : (
              <li className="text-sm text-slate-400 dark:text-slate-500">No strong bullish drivers identified.</li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-rose-100 bg-rose-50 p-4 dark:border-rose-900/30 dark:bg-rose-950/20">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-500">Risk Factors</p>
          <ul className="space-y-2">
            {riskFactors.length ? riskFactors.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
                <span className="mt-0.5 shrink-0 text-rose-500"><AlertIcon /></span>
                {item}
              </li>
            )) : (
              <li className="text-sm text-slate-400 dark:text-slate-500">Risk profile appears moderate.</li>
            )}
          </ul>
        </div>
      </div>

      {/* Notes */}
      <div className="border-t border-slate-100 px-6 pb-6 pt-4 dark:border-slate-800">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Notes</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Pattern</p>
            <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">{notes?.pattern || 'None identified'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Golden Cross</p>
            <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">
              {notes?.golden_cross ? `Yes${notes.golden_cross_date ? ` — ${notes.golden_cross_date}` : ''}` : 'No'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VerdictPanel
