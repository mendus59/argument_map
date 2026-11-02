import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { loadTranscript, setVisibility } from '../data/imports'
import { DebateView } from '../components/DebateView'
import { EditPanel } from '../components/EditPanel'
import { SourcePane, type SeekFn } from '../components/SourcePane'
import { InviteButton } from '../components/InviteButton'
import type { Selection } from '../map/ArgumentMap'
import type { Segment } from '../import/transcript'
import type { ClaimSource, DebateMap, SideId } from '../model/types'

/** An admin-imported debate: video and transcript beside the map. Only the admin edits. */
export function ImportedDebate({ map }: { map: DebateMap }) {
  const { debate } = map
  const { user, isAdmin } = useAuth()
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [draft, setDraft] = useState<ClaimSource | null>(null)
  const [side, setSide] = useState<SideId>('for')
  const [focus, setFocus] = useState<number | null>(null)
  const seekRef = useRef<SeekFn | null>(null)

  useEffect(() => {
    let live = true
    loadTranscript(db, debate.id)
      .then((s) => live && setSegments(s))
      .catch((e) => {
        console.error(e)
        if (live) setSegments([])
      })
    return () => {
      live = false
    }
  }, [debate.id])

  // Selecting a mapped box jumps the transcript and the video to its moment.
  function select(s: Selection) {
    setSelection(s)
    const claim = s?.kind === 'claim' ? map.claims.find((c) => c.id === s.id) : undefined
    if (claim?.source) {
      setFocus(claim.source.segment)
      if (claim.source.start !== null) seekRef.current?.(claim.source.start)
    }
  }

  function quote(src: ClaimSource) {
    setDraft(src)
    const speakerSide = debate.source?.speakers.find((sp) => sp.label === src.speaker)?.side
    if (speakerSide) setSide(speakerSide)
  }

  const seek = (t: number) => seekRef.current?.(t)

  return (
    <DebateView
      map={map}
      eyebrow="Imported debate"
      selection={selection}
      onSelect={select}
      badges={<span className={`tag ${debate.visibility === 'public' ? '' : 'subtle'}`}>{debate.visibility === 'public' ? 'Public' : 'Private'}</span>}
      source={
        <SourcePane
          debate={debate}
          segments={segments}
          claims={map.claims}
          seekRef={seekRef}
          focusSegment={focus}
          canMap={isAdmin}
          onQuote={quote}
          onSelectClaim={(id) => select({ kind: 'claim', id })}
        />
      }
      panel={
        isAdmin && user ? (
          <>
            <section className="stack-xs">
              <span className="eyebrow">Mapping for</span>
              <div className="seg seg-sm" role="radiogroup" aria-label="Side you are mapping for">
                {(['for', 'against'] as SideId[]).map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={side === s} className={side === s ? 'on agree' : ''} onClick={() => setSide(s)}>
                    {debate.sides[s].label}
                  </button>
                ))}
              </div>
              <small className="muted">New boxes and stances go to this side.</small>
            </section>
            {draft && (
              <div className="box stack-xs">
                <span className="eyebrow">Passage to map</span>
                <p className="small">“{draft.quote.length > 200 ? `${draft.quote.slice(0, 200)}…` : draft.quote}”</p>
                <button className="linklike small" type="button" onClick={() => setDraft(null)}>
                  Discard
                </button>
              </div>
            )}
            <EditPanel
              map={map}
              selection={selection}
              user={user}
              role={{ side, leader: true }}
              onSelect={select}
              source={{ draft, onDraftUsed: () => setDraft(null), onSeek: seek }}
            />
            <AdminSharing map={map} />
          </>
        ) : (
          <ReaderPanel map={map} selection={selection} onSeek={seek} />
        )
      }
    />
  )
}

function ReaderPanel({ map, selection, onSeek }: { map: DebateMap; selection: Selection; onSeek: SeekFn }) {
  const claim = selection?.kind === 'claim' ? map.claims.find((c) => c.id === selection.id) : undefined
  if (!claim) return <p className="small muted">Select a box to see the passage it came from.</p>
  return (
    <section className="stack-sm">
      <span className="eyebrow">Selected box</span>
      <p className="selected-text">{claim.text}</p>
      {claim.source && (
        <blockquote className="source-quote">
          <p>“{claim.source.quote}”</p>
          <footer className="small muted">
            {claim.source.speaker ?? 'Unnamed speaker'}
            {claim.source.start !== null && (
              <>
                {' · '}
                <button className="linklike" type="button" onClick={() => onSeek(claim.source!.start!)}>
                  ▶ Play this moment
                </button>
              </>
            )}
          </footer>
        </blockquote>
      )}
    </section>
  )
}

function AdminSharing({ map }: { map: DebateMap }) {
  const { debate } = map
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const isPublic = debate.visibility === 'public'
  async function toggle() {
    setBusy(true)
    setError(false)
    try {
      await setVisibility(db, debate.id, isPublic ? 'private' : 'public')
    } catch (e) {
      console.error(e)
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="stack-sm">
      <span className="eyebrow">Sharing</span>
      <p className="small">{isPublic ? 'Anyone with the link can view this debate.' : 'Only you and readers you invite can view this debate.'}</p>
      <button className="btn" type="button" onClick={toggle} disabled={busy}>
        {isPublic ? 'Make private' : 'Make public'}
      </button>
      {error && <small className="error">Visibility couldn’t be changed. Try again.</small>}
      <InviteButton debate={debate} role="reader" side={null} label="Invite a reader" />
    </section>
  )
}
