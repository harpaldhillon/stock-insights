import { highsDescription } from './HighBadge'

// Bottom-of-page summary for a stock: every indicator shown on the detail page,
// what its current value says about this stock, and how much it matters —
// using the per-rule points the analyser stored in notes.score_breakdown.

const pct = (a, b) => (a != null && b ? (a / b - 1) * 100 : null)
const fmtPct = (v, digits = 1) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`)
const absPct = (v, digits = 1) => (v == null ? '–' : `${Math.abs(v).toFixed(digits)}%`)
const fmtPts = (p) => (p == null ? '–' : p === 0 ? '0' : `${p > 0 ? '+' : '−'}${Math.abs(p)}`)

function weightLabel(max) {
  if (max == null) return { label: 'Context', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
  if (max >= 1.5) return { label: 'High', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' }
  if (max >= 1) return { label: 'Medium', cls: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400' }
  return { label: 'Low', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
}

function pointsClass(p) {
  if (p == null || p === 0) return 'text-slate-400 dark:text-slate-500'
  return p > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

function avg(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null
}

function buildRows({ analysis: a, notes, prices, close, fmt, consensus }) {
  const parts = Object.fromEntries((notes?.score_breakdown || []).map((p) => [p.key, p]))
  const pts = (...keys) => {
    const found = keys.map((k) => parts[k]).filter(Boolean)
    if (!found.length) return { points: null, max: null }
    return { points: found.reduce((s, p) => s + p.points, 0), max: Math.max(...found.map((p) => p.max)) }
  }
  const vsMa = (ma, name, horizon) => {
    const d = pct(close, ma)
    if (d == null) return '–'
    return d >= 0
      ? `Price is ${absPct(d)} above the ${name}: the ${horizon} trend is up.`
      : `Price is ${absPct(d)} below the ${name}: the ${horizon} trend is down.`
  }

  // Volume averages from the price history (same 5/20-day windows the analyser uses).
  const vols = prices.map((p) => p.volume)
  const vol5 = avg(vols.slice(-5))
  const vol20 = avg(vols.slice(-20))
  const volDiff = pct(vol5, vol20)
  const prevClose = prices.length >= 2 ? prices[prices.length - 2].close : null

  const rsi = a.rsi14
  const rsiText = rsi == null ? '–'
    : rsi > 70 ? `At ${rsi.toFixed(1)}, overbought: the stock has run up fast and is prone to a pullback.`
    : rsi > 65 ? `At ${rsi.toFixed(1)}, strong momentum, close to overbought (70).`
    : rsi >= 40 ? `At ${rsi.toFixed(1)}, healthy momentum: rising without being stretched.`
    : rsi >= 30 ? `At ${rsi.toFixed(1)}, momentum is soft but not yet oversold.`
    : `At ${rsi.toFixed(1)}, oversold: heavy selling, which can precede a bounce but signals weakness.`

  const macdBull = a.macd_line > a.macd_signal
  const macdText = a.macd_line == null ? '–'
    : macdBull && a.macd_hist > 0 ? 'MACD is above its signal line with a positive histogram: momentum is turning or staying up.'
    : !macdBull && a.macd_hist < 0 ? 'MACD is below its signal line with a negative histogram: momentum is pointing down.'
    : 'MACD and its histogram disagree: momentum is mixed.'

  const histPts = parts.macd_hist?.points
  const atrPct = a.atr14 != null && close ? (a.atr14 / close) * 100 : null
  const bandPos = a.bb_upper != null && a.bb_lower != null && a.bb_upper > a.bb_lower
    ? ((close - a.bb_lower) / (a.bb_upper - a.bb_lower)) * 100 : null
  const range52 = a.week52_high != null && a.week52_low != null && a.week52_high > a.week52_low
    ? ((close - a.week52_low) / (a.week52_high - a.week52_low)) * 100 : null

  const entryMid = (a.entry_zone_low + a.entry_zone_high) / 2
  const toEntry = pct(close, entryMid)
  const riskPct = pct(a.stop_loss, entryMid)
  const rewardPct = pct(a.target_price, entryMid)
  const rrQuality = a.rr_ratio >= 2 ? 'attractive' : a.rr_ratio >= 1 ? 'acceptable' : 'unattractive: less upside than downside'

  const goldenDate = notes?.golden_cross_date ? new Date(notes.golden_cross_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null

  return [
    { group: 'Trend', items: [
      { name: 'EMA 20', value: fmt(a.ema20), text: vsMa(a.ema20, '20-day EMA', 'short-term'), ...pts('ema20') },
      { name: 'SMA 50', value: fmt(a.sma50), text: vsMa(a.sma50, '50-day SMA', 'medium-term'), ...pts('sma50') },
      { name: 'SMA 200', value: fmt(a.sma200), text: `${vsMa(a.sma200, '200-day SMA', 'long-term')} This is the most heavily weighted rule.`, ...pts('sma200') },
      { name: 'SMA 50 vs 200', value: a.sma50 > a.sma200 ? '50 > 200' : '50 < 200',
        text: a.sma50 > a.sma200
          ? `The 50-day is above the 200-day: a bullish (“golden cross”) set-up${goldenDate && notes?.golden_cross ? `, crossed on ${goldenDate}` : ''}.`
          : `The 50-day is below the 200-day: a bearish (“death cross”) set-up${goldenDate && notes?.golden_cross === false ? `, crossed on ${goldenDate}` : ''}.`,
        ...pts('sma_cross') },
    ] },
    { group: 'Momentum', items: [
      { name: 'RSI (14)', value: rsi?.toFixed(1) ?? '–', text: rsiText, ...pts('rsi') },
      { name: 'MACD', value: a.macd_line != null ? `${a.macd_line.toFixed(2)} / ${a.macd_signal.toFixed(2)}` : '–', text: macdText, ...pts('macd') },
      { name: 'MACD histogram', value: a.macd_hist?.toFixed(2) ?? '–',
        text: histPts == null ? 'Day-on-day change of the MACD histogram.' : histPts > 0 ? 'Histogram rose versus yesterday: momentum is accelerating.' : 'Histogram fell versus yesterday: momentum is fading.',
        ...pts('macd_hist') },
    ] },
    { group: 'Volume', items: [
      { name: 'Volume trend', value: fmtPct(volDiff, 0),
        text: volDiff == null ? '–' : volDiff >= 0
          ? `5-day average volume is ${absPct(volDiff, 0)} above the 20-day average: growing interest supports the move.`
          : `5-day average volume is ${absPct(volDiff, 0)} below the 20-day average: participation is thinning.`,
        ...pts('volume_trend') },
      { name: 'Last session', value: fmtPct(pct(close, prevClose)),
        text: parts.volume_confirms?.points > 0
          ? 'Closed up on above-average volume: buyers confirmed the move.'
          : close > prevClose ? 'Closed up, but on below-average volume: an unconfirmed move.'
          : 'Closed flat or down: no volume confirmation of buying.',
        ...pts('volume_confirms') },
    ] },
    { group: 'Volatility', items: [
      { name: 'ATR (14)', value: a.atr14 != null ? `${a.atr14.toFixed(2)} (${absPct(atrPct)})` : '–',
        text: atrPct == null ? '–' : atrPct < 3 ? `Typical daily range is ${absPct(atrPct)} of price: calm, which allows tighter stops.`
          : atrPct > 5 ? `Typical daily range is ${absPct(atrPct)} of price: volatile, so stops must be wide and risk is higher.`
          : `Typical daily range is ${absPct(atrPct)} of price: moderate volatility.`,
        ...pts('atr') },
      { name: 'Bollinger position', value: bandPos != null ? `${bandPos.toFixed(0)}% of band` : '–',
        text: bandPos == null ? '–' : bandPos > 100 ? `Above the upper band (${fmt(a.bb_upper)}): stretched, short-term pullback risk.`
          : bandPos < 50 ? `In the lower half of the bands (${fmt(a.bb_lower)}–${fmt(a.bb_upper)}): room to move up.`
          : `In the upper half of the bands (${fmt(a.bb_lower)}–${fmt(a.bb_upper)}): strong but not stretched.`,
        ...pts('bb_lower_half', 'bb_above_upper') },
      { name: 'Band width', value: parts.bb_squeeze ? (parts.bb_squeeze.points > 0 ? 'Narrowing' : 'Widening') : '–',
        text: parts.bb_squeeze?.points > 0 ? 'Bands are tightening (a squeeze): volatility is contracting, which often comes before a breakout.' : 'Bands are not tightening: no squeeze building.',
        ...pts('bb_squeeze') },
    ] },
    { group: 'Context (not in the score)', items: [
      { name: '52-week range', value: `${fmt(a.week52_low)} – ${fmt(a.week52_high)}`,
        text: `${range52 != null ? `Price sits ${range52.toFixed(0)}% of the way up its 52-week range.` : ''} ${highsDescription(notes?.highs) ?? ''}${notes?.highs?.multi_year_breakout ? ': a multi-year breakout, often a sign of strong demand.' : '.'}`.trim(),
        points: null, max: null },
      ...(consensus ? [{ name: 'Analyst consensus', value: consensus.label,
        text: `${consensus.total} analysts average ${consensus.meanScore.toFixed(1)}/5. This is a fundamental view that's independent of the technical score: agreement strengthens the case, disagreement is a caution.`,
        points: null, max: null }] : []),
      { name: 'Entry zone', value: `${fmt(a.entry_zone_low)} – ${fmt(a.entry_zone_high)}`,
        text: toEntry == null ? '–' : Math.abs(toEntry) <= 1 ? 'Price is inside the entry zone now.'
          : toEntry > 0 ? `Price is ${absPct(toEntry)} above the entry zone: the plan is to wait for a pullback to trend support.`
          : `Price is ${absPct(toEntry)} below the entry zone: under trend support.`,
        points: null, max: null },
      { name: 'Stop / Target', value: `${fmt(a.stop_loss)} / ${fmt(a.target_price)}`,
        text: `From the entry zone: ${absPct(riskPct)} risk to the stop and ${fmtPct(rewardPct)} to the target.`,
        points: null, max: null },
      { name: 'R:R ratio', value: a.rr_ratio?.toFixed(2) ?? '–',
        text: `Reward is ${a.rr_ratio?.toFixed(2)}× the risk: ${rrQuality}.`, points: null, max: null },
    ] },
  ]
}

function StockSummary({ stock, close, fmt, consensus }) {
  const a = stock.analysis
  const notes = a.notes || {}
  const groups = buildRows({ analysis: a, notes, prices: stock.prices || [], close, fmt, consensus })

  const scored = groups.flatMap((g) => g.items).filter((i) => i.points != null)
  const positives = scored.filter((i) => i.points > 0).sort((x, y) => y.points - x.points)
  const negatives = scored.filter((i) => i.points < 0).sort((x, y) => x.points - y.points)
  const names = (items) => items.slice(0, 3).map((i) => i.name).join(', ')

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 p-6 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Summary</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <b className="text-slate-900 dark:text-white">{stock.company.ticker}</b> scores{' '}
          <b className={pointsClass(a.score)}>{fmtPts(a.score)}</b>, a <b className="text-slate-900 dark:text-white">{a.signal}</b> with{' '}
          {a.conviction.toLowerCase()} conviction (BUY needs +3.5, SELL −3.5 or less).
          {scored.length > 0 && <> {positives.length} of {scored.length} scored indicators help and {negatives.length} hurt.</>}
          {positives.length > 0 && <> Biggest supports: <b className="text-emerald-600 dark:text-emerald-400">{names(positives)}</b>.</>}
          {negatives.length > 0 && <> Biggest drags: <b className="text-rose-600 dark:text-rose-400">{names(negatives)}</b>.</>}
          {scored.length === 0 && ' A per-indicator breakdown will appear after the next data refresh.'}
        </p>
      </div>

      <div className="overflow-x-auto p-6 pt-4">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-400 dark:text-slate-500">
              <th className="py-2 pr-3 font-medium">Indicator</th>
              <th className="py-2 pr-3 font-medium">Value</th>
              <th className="py-2 pr-3 font-medium">What it says about {stock.company.ticker}</th>
              <th className="py-2 pr-3 text-right font-medium">Score impact</th>
              <th className="py-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.group} className="divide-y divide-slate-100 dark:divide-slate-800">
              <tr>
                <td colSpan={5} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{g.group}</td>
              </tr>
              {g.items.map((i) => {
                const w = weightLabel(i.max)
                return (
                  <tr key={i.name} className="align-top">
                    <td className="whitespace-nowrap py-2.5 pr-3 font-medium text-slate-800 dark:text-slate-100">{i.name}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-xs text-slate-600 dark:text-slate-300">{i.value}</td>
                    <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{i.text}</td>
                    <td className={`whitespace-nowrap py-2.5 pr-3 text-right font-mono ${pointsClass(i.points)}`}>
                      {i.points == null ? '' : `${fmtPts(i.points)}`}
                      {i.points != null && <span className="text-xs text-slate-400 dark:text-slate-500"> / ±{i.max}</span>}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-right">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${w.cls}`}>{w.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Score impact is the points each rule added or removed today, out of the most it can move the score. Weight reflects that maximum: High (±1.5), Medium (±1), Low (±0.5).
          Context rows inform the trade but don't change the BUY/HOLD/SELL score.
        </p>
      </div>
    </div>
  )
}

export default StockSummary
