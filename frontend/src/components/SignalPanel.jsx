import { useEffect } from 'react'
import StockTable from './StockTable'
import SignalBadge from './SignalBadge'

const THEMES = {
  BUY: {
    header: 'border-emerald-100 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-950/30',
    title: 'text-emerald-700 dark:text-emerald-400',
    count: 'bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-300',
    button: 'text-emerald-700 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/50',
  },
  HOLD: {
    header: 'border-amber-100 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/30',
    title: 'text-amber-700 dark:text-amber-400',
    count: 'bg-amber-100 dark:bg-amber-900/50 dark:text-amber-300',
    button: 'text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/50',
  },
  SELL: {
    header: 'border-rose-100 bg-rose-50 dark:border-rose-900/30 dark:bg-rose-950/30',
    title: 'text-rose-700 dark:text-rose-400',
    count: 'bg-rose-100 dark:bg-rose-900/50 dark:text-rose-300',
    button: 'text-rose-700 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-900/50',
  },
}

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// Fully controlled: the dashboard owns `expanded` and `page` so both survive
// navigating to a stock page and back.
function SignalPanel({ signal, rows, onRowClick, expanded, onExpandedChange, page, onPageChange }) {
  const theme = THEMES[signal]
  const setExpanded = (open) => onExpandedChange(open)

  // While expanded: close on Esc and stop the page behind the overlay from scrolling.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => { if (e.key === 'Escape') onExpandedChange(false) }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [expanded])

  const header = (
    <div className={`flex shrink-0 items-center justify-between border-b px-4 py-3 ${theme.header}`}>
      <h3 className={`font-semibold ${expanded ? 'text-base' : 'text-sm'} ${theme.title}`}>
        {signal} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${theme.count}`}>{rows.length}</span>
      </h3>
      <div className="flex items-center gap-2">
        <SignalBadge signal={signal} />
        <button
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? `Close full-screen ${signal} view` : `Expand ${signal} to full screen`}
          title={expanded ? 'Close (Esc)' : 'Expand to full screen'}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${theme.button}`}
        >
          {expanded ? <CloseIcon /> : <ExpandIcon />}
        </button>
      </div>
    </div>
  )

  if (expanded) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${signal} stocks`}
        className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900"
      >
        {header}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <StockTable rows={rows} onRowClick={onRowClick} pageSize={50} size="lg" page={page} onPageChange={onPageChange} />
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {header}
      <div className="p-3">
        <StockTable rows={rows} onRowClick={onRowClick} page={page} onPageChange={onPageChange} />
      </div>
    </div>
  )
}

export default SignalPanel
