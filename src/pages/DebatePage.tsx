import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { createInvite, roleIn, watchDebateMap, type InviteRole } from '../data/debates'
import { DebateView } from '../components/DebateView'
import type { Debate, DebateMap, SideId } from '../model/types'

export default function DebatePage() {
  const { id = '' } = useParams()
  const [map, setMap] = useState<DebateMap | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      watchDebateMap(db, id, setMap, (e) => {
        console.error(e)
        setError('This debate could not be opened. It may be private, or the link may be wrong.')
      }),
    [id],
  )

  if (error) return <p className="page narrow error">{error}</p>
  if (map === undefined) return <p className="page narrow muted">Loading…</p>
  if (map === null) return <p className="page narrow error">This debate doesn’t exist.</p>
  return <DebateView map={map} eyebrow="Debate" panel={<TeamPanel debate={map.debate} />} />
}

const other = (s: SideId): SideId => (s === 'for' ? 'against' : 'for')

function TeamPanel({ debate }: { debate: Debate }) {
  const { user } = useAuth()
  if (!user) return null
  const me = roleIn(debate, user.uid)
  const myRole = me.reader ? 'You can read this debate.' : me.side ? `You’re on the ${debate.sides[me.side].label} side${me.leader ? ' and lead it' : ''}.` : ''

  return (
    <section className="stack-sm">
      <span className="eyebrow">Your team</span>
      <p className="small">{myRole}</p>
      {me.leader && me.side && (
        <div className="stack-sm">
          {!debate.sides[other(me.side)].leaderUid && (
            <InviteButton debate={debate} role="leader" side={other(me.side)} label={`Invite the ${debate.sides[other(me.side)].label} side’s leader`} primary />
          )}
          <InviteButton debate={debate} role="member" side={me.side} label="Invite a teammate" />
          <InviteButton debate={debate} role="reader" side={null} label="Invite a reader" />
          <p className="small muted">Each link works once. Send it to one person.</p>
        </div>
      )}
    </section>
  )
}

function InviteButton({ debate, role, side, label, primary }: { debate: Debate; role: InviteRole; side: SideId | null; label: string; primary?: boolean }) {
  const { user } = useAuth()
  const [link, setLink] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'error'>('idle')

  async function make() {
    if (!user) return
    setState('busy')
    try {
      const token = await createInvite(db, user, debate, role, side)
      const url = `${window.location.origin}/invite/${token}`
      setLink(url)
      try {
        await navigator.clipboard.writeText(url)
        setState('copied')
      } catch {
        setState('idle')
      }
    } catch (e) {
      console.error(e)
      setState('error')
    }
  }

  return (
    <div className="stack-xs">
      <button className={`btn ${primary ? 'pri' : ''}`} type="button" onClick={make} disabled={state === 'busy'}>
        {label}
      </button>
      {link && <input className="link-box" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />}
      {state === 'copied' && <small className="ok">Link copied.</small>}
      {state === 'error' && <small className="error">The invite could not be created. Try again.</small>}
    </div>
  )
}
