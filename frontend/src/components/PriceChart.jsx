import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function movingAverage(values, period) {
  return values.map((_, idx, arr) => {
    if (idx < period - 1) return null
    const slice = arr.slice(idx - period + 1, idx + 1)
    return slice.reduce((sum, value) => sum + value, 0) / period
  })
}

function computeEMA(values, period) {
  const k = 2 / (period + 1)
  const ema = []
  values.forEach((value, idx) => {
    if (idx === 0) {
      ema.push(value)
    } else {
      ema.push(value * k + ema[idx - 1] * (1 - k))
    }
  })
  return ema
}

function PriceChart({ data }) {
  const labels = data.map((item) => formatDate(item.date))
  const closes = data.map((item) => item.close)
  const sma50 = movingAverage(closes, 50)
  const sma200 = movingAverage(closes, 200)
  const ema20 = computeEMA(closes, 20)

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Close',
        data: closes,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
        fill: true,
        tension: 0.2,
      },
      {
        label: 'EMA20',
        data: ema20,
        borderColor: '#f97316',
        borderDash: [6, 4],
        tension: 0.2,
        fill: false,
      },
      {
        label: 'SMA50',
        data: sma50,
        borderColor: '#60a5fa',
        borderDash: [4, 4],
        tension: 0.2,
        fill: false,
      },
      {
        label: 'SMA200',
        data: sma200,
        borderColor: '#eab308',
        borderDash: [8, 4],
        tension: 0.2,
        fill: false,
      },
    ],
  }

  return <Line data={chartData} options={{ responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { display: false }, y: { ticks: { color: '#cbd5e1' } } } }} />
}

export default PriceChart
