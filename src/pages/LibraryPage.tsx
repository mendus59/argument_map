import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../firebase'
import { searchPublic, type PublicDebate } from '../data/imports'

/** Public imported debates, searchable by participant or subject. Open to everyone. */
export default function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [input, setInput] = useState(q)
  const [results, setResults] = useState<PublicDebate[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setResults(null)
    setError(null)
    searchPublic(db, q)
      .then((r) => live && setResults(r))
      .catch((e) => {
        console.error(e)
        if (live) setError('The library couldn’t be loaded. Check your connection and reload the page.')
      })
    return () => {
      live = false
    }
  }, [q])

  function search(term: string) {
    setInput(term)
    setParams(term.trim() ? { q: term.trim() } : {})
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    search(input)
  }

  return (
    <div className="page narrow stack">
      <div className="stack-xs">
        <span className="eyebrow">Library</span>
        <h1>Mapped debates</h1>
        <p className="muted">Public debates, mapped from their recordings. Search by who took part or by subject.</p>
      </div>
      <form className="row" role="search" onSubmit={submit}>
        <input
          id="library-search"
          className="input grow"
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="A participant or subject, such as “transit”"
          aria-label="Search by participant or subject"
        />
        <button className="btn pri" type="submit">
          Search
        </button>
        {q && (
          <button className="btn" type="button" onClick={() => search('')}>
            Show all
          </button>
        )}
      </form>
      {error && <p className="error">{error}</p>}
      {!results && !error && <p className="muted">Loading…</p>}
      {results && results.length === 0 && (
        <div className="empty stack-xs">
          <p>{q ? `No public debates match “${q}”.` : 'No debates have been made public yet.'}</p>
          {q && <p className="muted small">Search matches whole names, single words in them, and subjects.</p>}
        </div>
      )}
      {results && results.length > 0 && (
        <ul className="debate-list">
          {results.map((d) => (
            <li key={d.id} className="debate-item library-item">
              {d.source?.videoId && <img className="lib-thumb" src={`https://i.ytimg.com/vi/${d.source.videoId}/mqdefault.jpg`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />}
              <div className="stack-xs">
                <Link to={`/d/${d.id}`} className="debate-item-title">
                  {d.title}
                </Link>
                {d.source?.channel && <span className="small muted">{d.source.channel}</span>}
                <span className="row-sm">
                  {d.participantNames.map((n) => (
                    <button key={n} type="button" className="tag tag-btn" onClick={() => search(n)} title={`Debates with ${n}`}>
                      {n}
                    </button>
                  ))}
                  {d.subjects.map((s) => (
                    <button key={s} type="button" className="tag subtle tag-btn" onClick={() => search(s)} title={`Debates about ${s}`}>
                      {s}
                    </button>
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
