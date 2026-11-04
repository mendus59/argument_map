import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { addAdmin, listAdmins, removeAdmin, SUPER_ADMIN_EMAILS, type AdminEntry } from '../data/admins'

/** Super Admins add and remove Admins here. Admins import debates and run AI analysis. */
export default function AdminPage() {
  const { user, isSuperAdmin } = useAuth()
  const [admins, setAdmins] = useState<AdminEntry[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    listAdmins(db).then(setAdmins, (e) => {
      console.error(e)
      setNote({ kind: 'error', text: 'The Admin list couldn’t be loaded. Check that the latest Firestore rules are published.' })
    })
  }, [isSuperAdmin])

  if (!user || !isSuperAdmin) {
    return (
      <div className="page narrow stack">
        <h1>Admins</h1>
        <p className="muted">Only Super Admins can manage Admins.</p>
      </div>
    )
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!user || !email.trim()) return
    setBusy(true)
    setNote(null)
    try {
      const r = await addAdmin(db, user, email)
      if (r.ok) {
        setAdmins((list) => [...(list ?? []), r.entry])
        setEmail('')
        setNote({ kind: 'ok', text: `${r.entry.name || r.entry.email} is now an Admin.` })
      } else if (r.reason === 'already') {
        setNote({ kind: 'error', text: 'That account is already an Admin.' })
      } else {
        setNote({ kind: 'error', text: 'No account uses that email yet. Ask them to sign in to Parrhesia once with Google, then add them again.' })
      }
    } catch (err) {
      console.error(err)
      setNote({ kind: 'error', text: 'The Admin couldn’t be added. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(a: AdminEntry) {
    if (!confirm(`Remove ${a.name || a.email} as an Admin? Debates they imported stay as they are.`)) return
    try {
      await removeAdmin(db, a.uid)
      setAdmins((list) => (list ?? []).filter((x) => x.uid !== a.uid))
      setNote({ kind: 'ok', text: `${a.name || a.email} is no longer an Admin.` })
    } catch (err) {
      console.error(err)
      setNote({ kind: 'error', text: 'The Admin couldn’t be removed. Try again.' })
    }
  }

  return (
    <div className="page narrow stack">
      <div className="stack-xs">
        <span className="eyebrow">Super Admin</span>
        <h1>Admins</h1>
        <p className="muted">Admins can import debates from YouTube or transcripts, map them, make them public, and run AI analysis with their own Claude key.</p>
      </div>

      <form className="row" onSubmit={add}>
        <input
          className="input grow"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Their Google account email"
          aria-label="Email of the new Admin"
          required
        />
        <button className="btn pri" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Adding…' : 'Add Admin'}
        </button>
      </form>
      {note && <p className={note.kind === 'error' ? 'error' : 'small'}>{note.text}</p>}

      <section className="stack-sm">
        <span className="eyebrow">Super Admins</span>
        <ul className="debate-list">
          {SUPER_ADMIN_EMAILS.map((e) => (
            <li key={e} className="debate-item admin-row">
              <span>{e}</span>
              <span className="tag subtle">Built in</span>
            </li>
          ))}
        </ul>
        <small className="muted">Super Admins are set in the app’s code. They are Admins too.</small>
      </section>

      <section className="stack-sm">
        <span className="eyebrow">Admins</span>
        {!admins && !note && <p className="muted">Loading…</p>}
        {admins && admins.length === 0 && <p className="muted small">No Admins yet.</p>}
        {admins && admins.length > 0 && (
          <ul className="debate-list">
            {admins.map((a) => (
              <li key={a.uid} className="debate-item admin-row">
                <span className="stack-xs">
                  <strong>{a.name || a.email || a.uid}</strong>
                  {a.email && <span className="small muted">{a.email}</span>}
                </span>
                <button className="btn small-btn" type="button" onClick={() => remove(a)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
