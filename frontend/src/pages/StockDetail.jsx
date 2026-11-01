import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/client'
import MetricCard from '../components/MetricCard'
import PriceChart from '../components/PriceChart'
import RSIChart from '../components/RSIChart'
import MACDChart from '../components/MACDChart'
import VolumeChart from '../components/VolumeChart'
import SignalBadge from '../components/SignalBadge'
import VerdictPanel from '../components/VerdictPanel'
import RecommendationsChart from '../components/RecommendationsChart'
import { highsDescription } from '../components/HighBadge'
import StockSummary from '../components/StockSummary'

function formatPrice(value, ticker) {
  if (value == null) return '–'
  if (ticker?.endsWith('.L')) return `${Number(value).toFixed(0)}p`
  return Number(value).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })
}

function consensusFromRecommendation(rec) {
  if (!rec) return null
  const total = rec.strong_buy + rec.buy + rec.hold + rec.sell + rec.strong_sell
  if (!total) return null
  const meanScore = (rec.strong_buy * 5 + rec.buy * 4 + rec.hold * 3 + rec.sell * 2 + rec.strong_sell * 1) / total
  let label = 'Hold'
  if (meanScore >= 4.5) label = 'Strong Buy'
  else if (meanScore >= 3.5) label = 'Buy'
  else if (meanScore >= 2.5) label = 'Hold'
  else if (meanScore >= 1.5) label = 'Sell'
  else label = 'Strong Sell'
  return { label, meanScore, total }
}

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const panelClass = 'rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900'
const sectionTitle = 'mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300'

function MomentumRow({ label, value, signal }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/50">
      <div>
        <p className="text-xs text-slate-400 dark:text-slate-500">{label}</p>
        <p className="mt-0.5 font-mono text-sm font-semibold text-slate-900 dark:text-white">{value ?? '–'}</p>
      </div>
      <SignalBadge signal={signal} />
    </div>
  )
}

function StockDetail() {
  const navigate = useNavigate()
  const { ticker } = useParams()
  const [stock, setStock] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    api.get(`/api/stock/${ticker}`)
      .then((res) => setStock(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [ticker])

  const latestPrice = useMemo(() => stock?.prices?.[stock.prices.length - 1], [stock])
  const consensus = useMemo(() => consensusFromRecommendation(stock?.recommendations?.[0]), [stock])

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-20 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="text-center">
          <svg className="mx-auto animate-spin text-sky-500" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Loading stock details…</p>
        </div>
      </div>
    )
  }

  if (!stock) {
    return (
      <div className={`${panelClass} py-16 text-center text-slate-400`}>Stock not found.</div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Stock hero */}
      <div className={panelClass}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
              <button
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-1 transition-colors hover:text-sky-500"
              >
                <BackIcon /> Dashboard
              </button>
              <span>/</span>
              <span>{stock.company.sector}</span>
              <span>/</span>
              <span>{stock.company.index}</span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
              {stock.company.ticker}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{stock.company.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-950/60">
              <p className="text-xs text-slate-400 dark:text-slate-500">Current price</p>
              <p className="font-mono text-xl font-semibold text-slate-900 dark:text-white">
                {formatPrice(latestPrice?.close, stock.company.ticker)}
              </p>
            </div>
            <SignalBadge signal={stock.analysis.signal} conviction={stock.analysis.conviction} />
          </div>
        </div>
      </div>

      {/* Moving averages */}
      <section className="grid gap-4 xl:grid-cols-3">
        <MetricCard title="EMA 20" value={formatPrice(stock.analysis.ema20, stock.company.ticker)} />
        <MetricCard title="SMA 50" value={formatPrice(stock.analysis.sma50, stock.company.ticker)} />
        <MetricCard title="SMA 200" value={formatPrice(stock.analysis.sma200, stock.company.ticker)} />
      </section>

      {/* Price chart */}
      <div className={panelClass}>
        <h3 className={sectionTitle}>Price Trend</h3>
        <PriceChart data={stock.prices} analysis={stock.analysis} />
      </div>

      {/* Momentum + RSI */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className={panelClass}>
          <h3 className={sectionTitle}>Momentum Indicators</h3>
          <div className="space-y-2">
            <MomentumRow
              label="RSI (14)"
              value={stock.analysis.rsi14?.toFixed(1)}
              signal={stock.analysis.rsi14 >= 70 ? 'SELL' : stock.analysis.rsi14 <= 30 ? 'BUY' : 'HOLD'}
            />
            <MomentumRow
              label="MACD Line"
              value={stock.analysis.macd_line}
              signal={stock.analysis.macd_line > stock.analysis.macd_signal ? 'BUY' : 'SELL'}
            />
            <MomentumRow
              label="MACD Histogram"
              value={stock.analysis.macd_hist}
              signal={stock.analysis.macd_hist >= 0 ? 'BUY' : 'SELL'}
            />
          </div>
        </div>
        <div className={`${panelClass} xl:col-span-2`}>
          <h3 className={sectionTitle}>RSI Trend</h3>
          <RSIChart data={stock.prices} rsiValue={stock.analysis.rsi14} />
        </div>
      </div>

      {/* MACD + Volume */}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className={panelClass}>
          <h3 className={sectionTitle}>MACD Momentum</h3>
          <MACDChart data={stock.prices} />
        </div>
        <div className={panelClass}>
          <h3 className={sectionTitle}>Volume Trend</h3>
          <VolumeChart data={stock.prices} />
        </div>
      </div>

      {/* Analyst recommendations */}
      {stock.recommendations?.length > 0 && (
        <div className={panelClass}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className={`${sectionTitle} mb-0`}>Analyst Recommendations</h3>
            {consensus && (
              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                <span>Consensus:</span>
                <SignalBadge
                  signal={consensus.meanScore >= 3.5 ? 'BUY' : consensus.meanScore <= 2.5 ? 'SELL' : 'HOLD'}
                  conviction={consensus.label}
                />
                <span>({consensus.total} analysts)</span>
              </div>
            )}
          </div>
          <RecommendationsChart data={stock.recommendations} />
        </div>
      )}

      {/* 52-week + volatility metrics */}
      <section className="grid gap-4 xl:grid-cols-4">
        <MetricCard title="52W High" value={formatPrice(stock.analysis.week52_high, stock.company.ticker)} subtitle={highsDescription(stock.analysis.notes?.highs) ?? 'Resistance'} />
        <MetricCard title="52W Low"  value={formatPrice(stock.analysis.week52_low,  stock.company.ticker)} subtitle="Support" />
        <MetricCard title="ATR (14)" value={stock.analysis.atr14?.toFixed(2) ?? '–'}                       subtitle="Volatility" />
        <MetricCard title="BB Upper" value={formatPrice(stock.analysis.bb_upper,     stock.company.ticker)} subtitle="Bollinger band" />
      </section>

      {/* Risk / Reward */}
      <div className={panelClass}>
        <h3 className={sectionTitle}>Risk / Reward</h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Entry Zone" value={`${formatPrice(stock.analysis.entry_zone_low, stock.company.ticker)} → ${formatPrice(stock.analysis.entry_zone_high, stock.company.ticker)}`} />
          <MetricCard title="Stop Loss"  value={formatPrice(stock.analysis.stop_loss,    stock.company.ticker)} />
          <MetricCard title="Target"     value={formatPrice(stock.analysis.target_price,  stock.company.ticker)} />
          <MetricCard title="R:R Ratio"  value={stock.analysis.rr_ratio?.toFixed(2) ?? '–'} />
        </div>
      </div>

      {/* Verdict */}
      <VerdictPanel analysis={stock.analysis} notes={stock.analysis.notes} />

      {/* Summary of every indicator on this page */}
      <StockSummary
        stock={stock}
        close={latestPrice?.close}
        fmt={(v) => formatPrice(v, stock.company.ticker)}
        consensus={consensus}
      />
    </div>
  )
}

export default StockDetail
