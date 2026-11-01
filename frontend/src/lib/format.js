// London (.L) prices are quoted in pence; everything else (NASDAQ) in US dollars.
export const isLondon = (ticker) => !!ticker?.endsWith('.L')

export function formatPrice(value, ticker, { decimals } = {}) {
  if (value == null) return '–'
  const n = Number(value)
  if (isLondon(ticker)) return `${n.toFixed(decimals ?? 0)}p`
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2,
  })
}
