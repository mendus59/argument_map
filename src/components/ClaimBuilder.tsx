// Claim builder: the claim's opposite, converse, inverse and contrapositive in
// plain words, with tips on how to debate it.
import { useMemo } from 'react'
import { analyseClaim, type Variant } from '../model/logic'
import type { Link } from '../model/types'

export interface Suggestion {
  text: string
  kind: Link['kind']
  /** Changes on every click, so the same suggestion can be used twice. */
  n: number
}

const badge = (v: Variant) =>
  v.equivalent === null ? null : v.equivalent ? <span className="status-pill status-agreed">Same meaning</span> : <span className="status-pill status-unsettled">Doesn’t follow</span>

export function ClaimBuilder({ text, canUse, onUse }: { text: string; canUse: boolean; onUse: (s: Omit<Suggestion, 'n'>) => void }) {
  const logic = useMemo(() => analyseClaim(text), [text])
  if (!logic.variants.length) return null
  return (
    <details className="claim-builder">
      <summary>
        <span className="eyebrow">Claim builder</span> <span className="small muted">opposite, converse and more, in plain words</span>
      </summary>
      <div className="stack-sm">
        <p className="small">{logic.summary}</p>
        {logic.variants.map((v) => (
          <div key={v.name} className="term-card">
            <div className="row-sm">
              <strong className="small">{v.name}</strong>
              <span className="small muted">{v.what}</span>
              {badge(v)}
            </div>
            <p className="variant-text">{v.text}</p>
            <p className="small muted">{v.note}</p>
            {canUse && (
              <span className="row-sm">
                {v.equivalent === null && (
                  <button className="btn small-btn" type="button" onClick={() => onUse({ text: v.text, kind: 'objection' })}>
                    Object with this
                  </button>
                )}
                {v.equivalent === true && (
                  <button className="btn small-btn" type="button" onClick={() => onUse({ text: v.text, kind: 'reason' })}>
                    Use as a reason
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
        <div className="stack-xs">
          <span className="eyebrow">How to debate it</span>
          <ul className="history-list small">
            {logic.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
            {logic.watchWords.map((w) => (
              <li key={w}>
                Watch the word <strong>“{w}”</strong>: it makes the claim stronger, and easier to refute. Is it really meant?
              </li>
            ))}
          </ul>
        </div>
        <p className="small muted">Worked out by simple rules, so check that it reads right before using it.</p>
      </div>
    </details>
  )
}
