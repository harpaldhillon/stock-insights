// Prices are formatted in the listing's quote currency, which the API sends as
// `currency`: GBp (pence, most London stocks), GBP, USD or EUR. Without it,
// fall back to the ticker: London (.L) in pence, everything else in US dollars.
export const isLondon = (ticker) => !!ticker?.endsWith('.L')

const SYMBOL_CURRENCIES = { GBP: 'GBP', USD: 'USD', EUR: 'EUR' }

export function formatPrice(value, ticker, { decimals, currency } = {}) {
  if (value == null) return '–'
  const n = Number(value)
  const quote = currency || (isLondon(ticker) ? 'GBp' : 'USD')
  if (quote === 'GBp') return `${n.toFixed(decimals ?? 0)}p`
  const code = SYMBOL_CURRENCIES[quote] || 'USD'
  // en-US gives "$" (en-GB would print "US$"); en-GB gives "£" and "€".
  return n.toLocaleString(code === 'USD' ? 'en-US' : 'en-GB', {
    style: 'currency', currency: code,
    minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2,
  })
}
