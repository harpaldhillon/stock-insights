import { useEffect, useState } from 'react'
import api from '../api/client'

// "About the company" block for the stock page. Loaded separately from the
// stock data: the backend may need to fetch it from Yahoo the first time.

const PREVIEW_SENTENCES = 2
const PREVIEW_MAX_CHARS = 350

// A short preview: the first couple of sentences (not splitting on abbreviations
// like "Inc."), dropping to fewer sentences, or a word-boundary cut, when they
// run long. Returns null when the full text is already short enough.
function preview(text) {
  if (text.length <= PREVIEW_MAX_CHARS) return null
  const sentences = text.match(/[^.!?]+(?:(?:Inc|Corp|Co|Ltd|plc|Plc|No|St|U\.S|U\.K|S\.A|N\.V)\.[^.!?]*)*[.!?]+(\s|$)/g) || []
  for (let n = PREVIEW_SENTENCES; n >= 1; n--) {
    const candidate = sentences.slice(0, n).join('').trim()
    if (candidate && candidate.length <= PREVIEW_MAX_CHARS) return candidate
  }
  const cut = text.slice(0, PREVIEW_MAX_CHARS)
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`
}

const hostname = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function Fact({ label, children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
      <span className="text-slate-400 dark:text-slate-500">{label}</span>
      <span className="font-medium text-slate-700 dark:text-slate-200">{children}</span>
    </span>
  )
}

function CompanyProfile({ ticker }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setProfile(null)
    setExpanded(false)
    api.get(`/api/stock/${ticker}/profile`)
      .then((r) => { if (!cancelled) setProfile(r.data) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticker])

  if (loading) {
    return <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">Loading company description…</p>
  }
  if (!profile || (!profile.summary && !profile.industry)) return null

  const short = profile.summary ? preview(profile.summary) : null
  const location = [profile.city, profile.country].filter(Boolean).join(', ')

  return (
    <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">About the company</p>
      {profile.summary && (
        <p className="max-w-4xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {expanded || !short ? profile.summary : short}
          {short && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="ml-1.5 font-medium text-sky-600 hover:underline dark:text-sky-400"
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {profile.industry && <Fact label="Industry">{profile.industry}</Fact>}
        {location && <Fact label="HQ">{location}</Fact>}
        {profile.employees != null && <Fact label="Employees">{profile.employees.toLocaleString('en-GB')}</Fact>}
        {profile.website && (
          <Fact label="Website">
            <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline dark:text-sky-400">
              {hostname(profile.website)}
            </a>
          </Fact>
        )}
      </div>
    </div>
  )
}

export default CompanyProfile
