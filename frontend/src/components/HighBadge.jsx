// Labels for the 52-week-high / multi-year-breakout data the analyser stores in
// analysis.notes.highs (see compute_high_breakout in backend/analyser.py).

export function yearsLabel(highs) {
  // "at least N years" (no higher close in all fetched history) rounds, since the
  // history length is ~5.0y; an exact lookback floors so we never overstate it.
  const years = highs.years_high_is_min ? Math.round(highs.years_high) : Math.floor(highs.years_high)
  return `${years}y${highs.years_high_is_min ? '+' : ''}`
}

export function highsDescription(highs) {
  if (!highs) return null
  if (highs.multi_year_breakout) {
    return highs.years_high_is_min
      ? `Highest close in ${yearsLabel(highs).replace('y+', '+ years')} (all available history)`
      : `Highest close in ${highs.years_high} years`
  }
  if (highs.at_52w_high) {
    return highs.pct_from_52w_high === 0 ? 'At 52-week high' : `${Math.abs(highs.pct_from_52w_high)}% below 52-week high`
  }
  if (highs.pct_from_52w_high != null) return `${Math.abs(highs.pct_from_52w_high)}% below 52-week high`
  return null
}

// compact: narrow dashboard panels have little room, so drop the word "high".
function HighBadge({ highs, compact = false }) {
  if (!highs || !highs.at_52w_high) return null
  const multi = highs.multi_year_breakout
  return (
    <span
      title={highsDescription(highs)}
      className={`mr-1.5 inline-block rounded px-1 py-px align-[1px] text-[10px] font-semibold leading-tight ${
        multi
          ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
          : 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
      }`}
    >
      {multi ? `${yearsLabel(highs)}${compact ? '' : ' high'}` : '52W'}
    </span>
  )
}

export default HighBadge
