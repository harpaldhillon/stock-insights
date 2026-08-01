import { useEffect, useState } from 'react'

const PAGE_SIZE = 25

function StockTable({ rows, onRowClick }) {
  const [page, setPage] = useState(0)

  // Reset to first page whenever the data changes (filter/sort)
  useEffect(() => { setPage(0) }, [rows])

  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg bg-slate-50 py-6 text-center text-xs text-slate-400 dark:bg-slate-950/40 dark:text-slate-500">
        No stocks match the filters.
      </div>
    )
  }

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const pageRows   = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[17%]" />
            <col className="w-[19%]" />
            <col className="w-[20%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/60">
              <th className="px-1.5 py-2 font-medium text-slate-400 dark:text-slate-500">Ticker</th>
              <th className="px-1.5 py-2 font-medium text-slate-400 dark:text-slate-500">Name</th>
              <th className="px-1.5 py-2 text-right font-medium text-slate-400 dark:text-slate-500">Price</th>
              <th className="px-1.5 py-2 text-right font-medium text-slate-400 dark:text-slate-500">Score</th>
              <th className="px-1.5 py-2 text-right font-medium text-slate-400 dark:text-slate-500">Conv.</th>
              <th className="px-1.5 py-2 text-right font-medium text-slate-400 dark:text-slate-500">R:R</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {pageRows.map((item) => (
              <tr
                key={item.ticker}
                onClick={() => onRowClick(item.ticker)}
                className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <td className="truncate px-1.5 py-2.5 font-mono font-semibold text-slate-900 dark:text-white">{item.ticker}</td>
                <td className="truncate px-1.5 py-2.5 text-slate-600 dark:text-slate-300" title={item.name}>{item.name}</td>
                <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                  {item.current_price != null ? Number(item.current_price).toFixed(2) : '—'}
                </td>
                <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">{item.score.toFixed(2)}</td>
                <td className="whitespace-nowrap px-1.5 py-2.5 text-right text-slate-500 dark:text-slate-400">{item.conviction}</td>
                <td className="whitespace-nowrap px-1.5 py-2.5 text-right font-mono text-slate-600 dark:text-slate-300">{item.rr_ratio.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              className="rounded px-2 py-1 text-[11px] text-slate-500 transition hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`min-w-[24px] rounded px-1.5 py-1 text-[11px] font-medium transition ${
                  i === page
                    ? 'bg-sky-500 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === totalPages - 1}
              className="rounded px-2 py-1 text-[11px] text-slate-500 transition hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default StockTable
