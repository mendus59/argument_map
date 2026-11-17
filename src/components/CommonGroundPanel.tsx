// What the two people have agreed, across all their debates: claims they can reuse
// as premises, the meanings of terms, and wording they settled on.
import { Link as RouterLink } from 'react-router-dom'
import type { CommonGround } from '../data/ground'
import type { DebateMap } from '../model/types'

export function CommonGroundPanel({ map, common }: { map: DebateMap; common: CommonGround }) {
  const { debate } = map
  const names = [debate.sides.for.leaderUid, debate.sides.against.leaderUid].map((u) => (u && debate.people[u]?.name.split(' ')[0]) || 'them')
  const terms = common.glossary.filter((g) => g.kind === 'term')
  const wording = common.glossary.filter((g) => g.kind === 'wording')
  const elsewhere = (id: string) => id !== debate.id
  return (
    <section className="stack-sm common-ground">
      <span className="eyebrow">Common ground · {names.join(' & ')}</span>
      {!common.ground.length && !common.glossary.length && (
        <p className="small muted">
          Claims you both accept, and terms and wording you agree on, collect here, from all your debates together. You can reuse them without arguing them again.
        </p>
      )}
      {common.ground.length > 0 && (
        <div className="stack-xs">
          <span className="small muted">Agreed claims ({common.ground.length}). Reuse one as a premise from the composer.</span>
          <ul className="history-list">
            {common.ground.map((g) => (
              <li key={g.id} className="small">
                ✓ {g.text}
                {elsewhere(g.debateId) && (
                  <>
                    {' '}
                    <RouterLink to={`/d/${g.debateId}`} className="muted">
                      (other debate)
                    </RouterLink>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {terms.length > 0 && (
        <div className="stack-xs">
          <span className="small muted">Glossary</span>
          <dl className="glossary">
            {terms.map((t) => (
              <div key={t.id}>
                <dt>{t.phrase}</dt>
                <dd>{t.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {wording.length > 0 && (
        <div className="stack-xs">
          <span className="small muted">Agreed wording</span>
          <ul className="history-list">
            {wording.map((w) => (
              <li key={w.id} className="small">
                Say <strong>“{w.replacement || '(nothing)'}”</strong>, not <s>“{w.phrase}”</s>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
