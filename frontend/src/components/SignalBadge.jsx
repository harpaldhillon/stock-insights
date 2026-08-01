const colorMap = {
  BUY:  'bg-emerald-500 text-white',
  HOLD: 'bg-amber-500 text-white',
  SELL: 'bg-rose-500 text-white',
}

function SignalBadge({ signal, conviction }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${colorMap[signal] || 'bg-slate-500 text-white'}`}>
      {signal}{conviction ? ` · ${conviction}` : ''}
    </span>
  )
}

export default SignalBadge
