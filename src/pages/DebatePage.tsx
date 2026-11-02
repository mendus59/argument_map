import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { roleIn, watchDebateMap } from '../data/debates'
import { InviteButton } from '../components/InviteButton'
import { ImportedDebate } from './ImportedDebate'
import { DebateView } from '../components/DebateView'
import { EditPanel } from '../components/EditPanel'
import type { Selection } from '../map/ArgumentMap'
import type { Debate, DebateMap, SideId } from '../model/types'

export default function DebatePage() {
  const { id = '' } = useParams()
  const [map, setMap] = useState<DebateMap | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const { user } = useAuth()

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
  if (map.debate.origin === 'imported') return <ImportedDebate map={map} />
  const role = user ? roleIn(map.debate, user.uid) : null
  return (
    <DebateView
      map={map}
      eyebrow="Debate"
      selection={selection}
      onSelect={setSelection}
      panel={
        <>
          {user && role && <EditPanel map={map} selection={selection} user={user} role={role} onSelect={setSelection} />}
          <TeamPanel debate={map.debate} />
        </>
      }
    />
  )
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
