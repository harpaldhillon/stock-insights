import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function computeRSI(values, period = 14) {
  const deltas = values.map((value, idx) => (idx === 0 ? 0 : value - values[idx - 1]))
  let gain = 0
  let loss = 0
  const rsi = []

  for (let idx = 0; idx < values.length; idx += 1) {
    const delta = deltas[idx]
    if (idx === 0) {
      rsi.push(null)
      continue
    }
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period
    const rs = loss === 0 ? 100 : gain / loss
    rsi.push(100 - 100 / (1 + rs))
  }
  return rsi
}

function RSIChart({ data }) {
  const labels = data.map((item) => formatDate(item.date))
  const closes = data.map((item) => item.close)
  const rsi = computeRSI(closes)

  const chartData = {
    labels,
    datasets: [
      {
        label: 'RSI',
        data: rsi,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
        fill: true,
        tension: 0.2,
      },
    ],
  }

  return (
    <Line
      data={chartData}
      options={{
        responsive: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: { display: false },
          y: {
            min: 0,
            max: 100,
            ticks: { color: '#cbd5e1' },
            grid: { color: 'rgba(148,163,184,0.15)' },
          },
        },
      }}
    />
  )
}

export default RSIChart
