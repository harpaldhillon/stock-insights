// Client-side dashboard filters, shared by the Dashboard and the Strategy popup
// so both always agree on which stocks match. (Index and sort are applied by
// the backend in /api/summary.)

export const SIGNALS = ['BUY', 'HOLD', 'SELL']

// "Highs" filter over analysis.notes.highs (computed by the analyser).
export const HIGHS_FILTERS = {
  '':    () => true,
  '52w': (item) => !!item.notes?.highs?.at_52w_high,
  multi: (item) => !!item.notes?.highs?.multi_year_breakout,
}

export const matchesSector = (item, sector) => !sector || item.sector === sector
export const matchesHighs  = (item, highs) => (HIGHS_FILTERS[highs] || HIGHS_FILTERS[''])(item)
export const matchesSearch = (item, search) => {
  const q = (search || '').trim().toLowerCase()
  return !q || item.ticker.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
}

export const allItems = (summary) => (summary ? SIGNALS.flatMap((s) => summary[s]) : [])
