import type { ReactNode } from 'react'
import { ArgumentMap, type Selection } from '../map/ArgumentMap'
import type { SubStatus } from '../map/nodes'
import type { DebateMap, SideId } from '../model/types'

function sideNames(map: DebateMap, side: SideId) {
  const { debate } = map
  const s = debate.sides[side]
  if (debate.origin === 'imported') {
    const names = (debate.source?.speakers ?? []).filter((sp) => sp.side === side).map((sp) => sp.label)
    return names.length ? names.join(', ') : 'speakers not named'
  }
  if (!s.memberUids.length) return 'waiting for a leader'
  return s.memberUids.map((u) => debate.people[u]?.name ?? 'Someone').join(', ')
}

/** Debate header, map and unplaced notes. `panel` adds content to the side column. */
export function DebateView({
  map,
  eyebrow,
  panel,
  source,
  badges,
  highlight,
  writers,
  subs,
  depth,
  crumbs,
  selection,
  onSelect,
}: {
  map: DebateMap
  eyebrow: string
  panel?: ReactNode
  /** Video and transcript column for imported debates. */
  source?: ReactNode
  /** Extra tags beside the sides in the header. */
  badges?: ReactNode
  highlight?: Set<string>
  writers?: Map<string, string[]>
  subs?: Map<string, SubStatus>
  /** Unresolved depth worked out from the live tree; falls back to the stored value. */
  depth?: number
  /** Links shown above the title, such as the parent debates of a sub-debate. */
  crumbs?: ReactNode
  selection?: Selection
  onSelect?: (s: Selection) => void
}) {
  const { debate, claims } = map
  const notes = claims.filter((c) => !c.placed)
  return (
    <div className="debate">
      <header className="debate-head">
        <div className="title">
          {crumbs ?? <span className="eyebrow">{eyebrow}</span>}
          <h1>{debate.title}</h1>
        </div>
        <div className="sides">
          <span className="side for">
            {debate.sides.for.label} · {sideNames(map, 'for')}
          </span>
          <span className="side against">
            {debate.sides.against.label} · {sideNames(map, 'against')}
          </span>
          {badges}
          <span className="depth" title="How deep the chain of open sub-debates goes">
            Unresolved depth {depth ?? debate.unresolvedDepth}
          </span>
        </div>
      </header>
      <main className={`workspace${source ? ' with-source' : ''}`}>
        {source}
        <ArgumentMap map={map} selection={selection} onSelect={onSelect} highlight={highlight} writers={writers} subs={subs} />
        <aside className="side-panel">
          {panel}
          {notes.length > 0 && (
            <section className="stack-sm">
              <span className="eyebrow">Unplaced notes</span>
              {notes.map((n) => (
                <div key={n.id} className="note">
                  {n.text}
                </div>
              ))}
            </section>
          )}
        </aside>
      </main>
    </div>
  )
}
