import { ArgumentMap } from './map/ArgumentMap'
import { sampleMap } from './model/sample'

export default function App() {
  const { debate, claims } = sampleMap
  const notes = claims.filter((c) => !c.placed)

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">
          <span className="eyebrow">Sample debate · read-only preview</span>
          <h1>{debate.title}</h1>
        </div>
        <div className="sides">
          <span className="side for">
            {debate.sides.for.label} · {debate.sides.for.memberUids.length} members
          </span>
          <span className="side against">
            {debate.sides.against.label} · {debate.sides.against.memberUids.length} member
            {debate.sides.against.memberUids.length === 1 ? '' : 's'}
          </span>
          <span className="depth" title="How deep the chain of open sub-debates goes">
            Unresolved depth {debate.unresolvedDepth}
          </span>
        </div>
      </header>
      <main className="workspace">
        <ArgumentMap map={sampleMap} />
        {notes.length > 0 && (
          <aside className="notes">
            <span className="eyebrow">Unplaced notes</span>
            {notes.map((n) => (
              <div key={n.id} className="note">
                {n.text}
              </div>
            ))}
          </aside>
        )}
      </main>
    </div>
  )
}
