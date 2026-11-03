import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { roleIn, watchDebateMap } from '../data/debates'
import { InviteButton } from '../components/InviteButton'
import { ImportedDebate } from './ImportedDebate'
import { DebateView } from '../components/DebateView'
import { EditPanel } from '../components/EditPanel'
import { RestateSetting } from '../components/HonestPanels'
import { ActivityFeed, PresenceChips, RoundBadge, RoundControls } from '../components/LivePanels'
import { useLastVisit, usePresence } from '../data/live'
import { buildActivity } from '../model/activity'
import type { Selection } from '../map/ArgumentMap'
import type { Debate, DebateMap, SideId } from '../model/types'

export default function DebatePage() {
  const { id = '' } = useParams()
  const [map, setMap] = useState<DebateMap | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const { user } = useAuth()
  const native = map?.debate.origin === 'native'
  const me = map && user ? roleIn(map.debate, user.uid) : null
  const { online, setEditing } = usePresence(db, id, native ? user : null, me?.side ?? null)
  const lastVisit = useLastVisit(db, id, native ? user : null)

  // Boxes the others changed since this viewer last looked.
  const highlight = useMemo(() => {
    if (!map || typeof lastVisit !== 'number') return undefined
    return new Set(buildActivity(map).filter((i) => i.at > lastVisit && i.who !== user?.uid).flatMap((i) => i.touched))
  }, [map, lastVisit, user])
  const writers = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of online) if (p.editing) m.set(p.editing, [...(m.get(p.editing) ?? []), p.name.split(' ')[0]])
    return m
  }, [online])

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
      highlight={highlight}
      writers={writers}
      badges={
        <>
          <RoundBadge debate={map.debate} />
          <PresenceChips map={map} online={online} />
        </>
      }
      panel={
        // Tells the others which box you're writing under while a text box has focus.
        <div
          className="stack"
          onFocus={(e) => {
            if (e.target instanceof HTMLTextAreaElement) setEditing(selection?.kind === 'claim' ? selection.id : null)
          }}
          onBlur={(e) => {
            if (e.target instanceof HTMLTextAreaElement) setEditing(null)
          }}
        >
          {user && role && <EditPanel map={map} selection={selection} user={user} role={role} onSelect={setSelection} />}
          {!selection && <ActivityFeed map={map} lastVisit={user ? lastVisit : undefined} me={user?.uid} onSelect={setSelection} />}
          <TeamPanel debate={map.debate} />
        </div>
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
      {me.leader && (
        <div className="stack-xs">
          <span className="eyebrow">Debate settings</span>
          <RestateSetting debate={debate} />
        </div>
      )}
      {me.leader && user && (
        <RoundControls debate={debate} user={user} />
      )}
    </section>
  )
}
