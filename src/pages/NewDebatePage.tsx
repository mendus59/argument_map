import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { createDebate } from '../data/debates'
import type { SideId } from '../model/types'

export default function NewDebatePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [subjects, setSubjects] = useState('')
  const [side, setSide] = useState<SideId>('for')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const id = await createDebate(db, user, {
        title,
        conclusion: conclusion || title,
        subjects: subjects
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
        side,
      })
      navigate(`/d/${id}`)
    } catch (err) {
      console.error(err)
      setError('The debate could not be created. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <form className="page narrow stack" onSubmit={submit}>
      <h1>New debate</h1>
      <label className="field" htmlFor="title">
        <span>Question</span>
        <input id="title" required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Should our city make its buses fare-free?" />
      </label>
      <label className="field" htmlFor="conclusion">
        <span>Conclusion being debated</span>
        <input id="conclusion" maxLength={500} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="The city should make its buses fare-free." />
        <small className="muted">The statement at the top of the map. If you leave it blank, the question is used.</small>
      </label>
      <label className="field" htmlFor="subjects">
        <span>Subjects</span>
        <input id="subjects" value={subjects} onChange={(e) => setSubjects(e.target.value)} placeholder="transit, city budget" />
        <small className="muted">Separate with commas.</small>
      </label>
      <fieldset className="field">
        <legend>Your side</legend>
        <div className="seg">
          {(['for', 'against'] as SideId[]).map((s) => (
            <label key={s} className={side === s ? 'on' : ''}>
              <input type="radio" name="side" value={s} checked={side === s} onChange={() => setSide(s)} />
              {s === 'for' ? 'For the conclusion' : 'Against the conclusion'}
            </label>
          ))}
        </div>
        <small className="muted">You’ll lead this side. Next you’ll get a link to invite the other side’s leader.</small>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create debate'}
        </button>
      </div>
    </form>
  )
}
