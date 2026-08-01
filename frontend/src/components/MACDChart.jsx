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

function computeMACD(values) {
  const fast = computeEMA(values, 12)
  const slow = computeEMA(values, 26)
  const macd = values.map((_, idx) => (idx >= 25 ? fast[idx] - slow[idx] : null))
  const signal = computeEMA(macd.map((val) => (val ?? 0)), 9)
  return values.map((_, idx) => ({
    macd: idx >= 25 ? macd[idx] : null,
    signal: idx >= 33 ? signal[idx] : null,
    hist: idx >= 33 ? macd[idx] - signal[idx] : null,
  }))
}

function MACDChart({ data }) {
  const labels = data.map((item) => formatDate(item.date))
  const closes = data.map((item) => item.close)
  const macdSeries = computeMACD(closes)
  const chartData = {
    labels,
    datasets: [
      {
        label: 'MACD Line',
        data: macdSeries.map((point) => point.macd),
        borderColor: '#38bdf8',
        fill: false,
        tension: 0.2,
      },
      {
        label: 'Signal Line',
        data: macdSeries.map((point) => point.signal),
        borderColor: '#f97316',
        borderDash: [6, 4],
        fill: false,
        tension: 0.2,
      },
    ],
  }

  return <Line data={chartData} options={{ responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { display: false }, y: { ticks: { color: '#cbd5e1' } } } }} />
}

export default MACDChart
