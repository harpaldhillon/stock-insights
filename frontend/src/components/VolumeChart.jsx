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

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function VolumeChart({ data }) {
  const labels = data.map((item) => formatDate(item.date))
  const values = data.map((item) => item.volume)
  const chartData = {
    labels,
    datasets: [
      {
        label: 'Volume',
        data: values,
        backgroundColor: values.map((_, idx) => (idx % 2 === 0 ? 'rgba(34,197,94,0.6)' : 'rgba(248,113,113,0.6)')),
      },
    ],
  }

  return <Bar data={chartData} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { ticks: { color: '#cbd5e1' } } } }} />
}

export default VolumeChart
