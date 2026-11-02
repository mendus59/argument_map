import type { ReactNode } from 'react'
import { ArgumentMap } from '../map/ArgumentMap'
import type { DebateMap, SideId } from '../model/types'

function sideNames(map: DebateMap, side: SideId) {
  const { debate } = map
  const s = debate.sides[side]
  if (!s.memberUids.length) return 'waiting for a leader'
  return s.memberUids.map((u) => debate.people[u]?.name ?? 'Someone').join(', ')
}

/** Debate header, map and unplaced notes. `panel` adds content to the side column. */
export function DebateView({ map, eyebrow, panel }: { map: DebateMap; eyebrow: string; panel?: ReactNode }) {
  const { debate, claims } = map
  const notes = claims.filter((c) => !c.placed)
  return (
    <div className="debate">
      <header className="debate-head">
        <div className="title">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{debate.title}</h1>
        </div>
        <div className="sides">
          <span className="side for">
            {debate.sides.for.label} · {sideNames(map, 'for')}
          </span>
          <span className="side against">
            {debate.sides.against.label} · {sideNames(map, 'against')}
          </span>
          <span className="depth" title="How deep the chain of open sub-debates goes">
            Unresolved depth {debate.unresolvedDepth}
          </span>
        </div>
      </header>
      <main className="workspace">
        <ArgumentMap map={map} />
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
