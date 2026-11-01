import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const SERIES = [
  { key: 'strong_buy', label: 'Strong Buy', color: 'rgba(16,185,129,0.85)' },
  { key: 'buy', label: 'Buy', color: 'rgba(52,211,153,0.7)' },
  { key: 'hold', label: 'Hold', color: 'rgba(245,158,11,0.7)' },
  { key: 'sell', label: 'Sell', color: 'rgba(251,113,133,0.7)' },
  { key: 'strong_sell', label: 'Strong Sell', color: 'rgba(225,29,72,0.85)' },
]

function periodLabel(period) {
  if (period === '0m') return 'Current'
  const match = /^-(\d+)m$/.exec(period)
  return match ? `${match[1]}mo ago` : period
}

function RecommendationsChart({ data }) {
  // API returns most-recent-first (0m, -1m, -2m, -3m); show oldest to newest, left to right.
  const ordered = [...data].reverse()
  const labels = ordered.map((item) => periodLabel(item.period))
  const chartData = {
    labels,
    datasets: SERIES.map((series) => ({
      label: series.label,
      data: ordered.map((item) => item[series.key]),
      backgroundColor: series.color,
    })),
  }

  return (
    <Bar
      data={chartData}
      options={{
        responsive: true,
        plugins: { legend: { position: 'top', labels: { boxWidth: 10, color: '#94a3b8' } } },
        scales: {
          x: { stacked: true, ticks: { color: '#94a3b8' } },
          y: { stacked: true, ticks: { color: '#cbd5e1' } },
        },
      }}
    />
  )
}

export default RecommendationsChart
