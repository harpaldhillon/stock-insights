function MetricCard({ title, value, subtitle }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{title}</p>
      <p className="mt-2 font-mono text-xl font-semibold text-slate-900 dark:text-white">{value ?? '–'}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>}
    </div>
  )
}

export default MetricCard
