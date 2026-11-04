import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import { buildUserPrompt, cleanResult, costUsd, estimate, formatUsd, monthKey, RESULT_SCHEMA, SYSTEM_PROMPT, type Estimate, type Suggestion } from '../ai/analysis'
import { AUTOMAP_SCHEMA, AUTOMAP_SYSTEM_PROMPT, buildMapPrompt, planAutoMap, premiseCount } from '../ai/automap'
import type { Job } from '../ai/client'
import { getApiKey, setApiKey } from '../ai/key'
import {
  acceptSuggestion,
  applyAutoMap,
  undoAutoMap,
  type AutoMapRun,
  dismissSuggestion,
  getBudget,
  publishSummary,
  recordSpend,
  saveAnalysis,
  setCap,
  watchAnalyses,
  type Analysis,
} from '../data/ai'
import type { Segment } from '../import/transcript'
import type { DebateMap } from '../model/types'

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  hidden_premise: 'Hidden premise',
  fallacy: 'Possible fallacy',
  missed_argument: 'Not mapped yet',
}

const ACCEPT_LABEL: Record<Suggestion['kind'], string> = {
  hidden_premise: 'Add as co-premise',
  fallacy: 'Post as comment',
  missed_argument: 'Add to map',
}

type Budget = { capUsd: number; spentUsd: number; runs: number }
type JobKind = 'automap' | 'analysis'

const JOB_TEXT: Record<JobKind, { run: string; running: string; declined: string; cut: string }> = {
  automap: {
    run: 'Map it',
    running: 'Mapping the debate from the transcript…',
    declined: 'The model declined to map this debate.',
    cut: 'The auto-map was cut off before it finished',
  },
  analysis: {
    run: 'Run analysis',
    running: 'Analysing the map and transcript…',
    declined: 'The model declined to analyse this debate.',
    cut: 'The analysis was cut off before it finished',
  },
}

/** Admin-only AI assist for an imported debate, paid for with the admin's own Claude API key. */
export function AiPanel({
  map,
  user,
  segments,
  autoStart = false,
  onSelectClaim,
  onSeek,
}: {
  map: DebateMap
  user: User
  segments: Segment[] | null
  /** Start an auto-map estimate as soon as the transcript loads (right after an import). */
  autoStart?: boolean
  onSelectClaim: (id: string) => void
  onSeek: (segment: number) => void
}) {
  const debateId = map.debate.id
  const [key, setKey] = useState<string | null>(() => getApiKey())
  const [budget, setBudget] = useState<Budget | null>(null)
  const [runs, setRuns] = useState<(Analysis | AutoMapRun)[]>([])
  const [shown, setShown] = useState<string | null>(null)
  const [est, setEst] = useState<(Estimate & { kind: JobKind }) | null>(null)
  const [phase, setPhase] = useState<{ step: 'idle' } | { step: 'estimating' | 'running' | 'undoing'; kind: JobKind }>({ step: 'idle' })
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const autoStarted = useRef(false)
  const month = monthKey()

  useEffect(() => {
    getBudget(db, user.uid, month).then(setBudget, (e) => {
      console.error(e)
      setBudget({ capUsd: 0, spentUsd: 0, runs: 0 })
    })
  }, [user.uid, month])

  useEffect(
    () =>
      watchAnalyses(db, debateId, (list) => setRuns(list as (Analysis | AutoMapRun)[]), (e) => {
        console.error(e)
        setError('Saved AI runs couldn’t be loaded.')
      }),
    [debateId],
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  const analyses = runs.filter((r): r is Analysis => r.kind !== 'automap')
  const autoMaps = runs.filter((r): r is AutoMapRun => r.kind === 'automap')
  const lastMap = autoMaps.find((r) => !r.undone)
  const mapIsEmpty = !map.claims.some((c) => c.placed && c.id !== map.debate.conclusion.claimId)

  function jobFor(kind: JobKind): Job | null {
    if (!segments) return null
    return kind === 'automap'
      ? { system: AUTOMAP_SYSTEM_PROMPT, user: buildMapPrompt(map, segments), schema: AUTOMAP_SCHEMA as unknown as Record<string, unknown> }
      : { system: SYSTEM_PROMPT, user: buildUserPrompt(map, segments), schema: RESULT_SCHEMA as unknown as Record<string, unknown> }
  }

  async function doEstimate(kind: JobKind) {
    const job = jobFor(kind)
    if (!key || !job) return
    setPhase({ step: 'estimating', kind })
    setError(null)
    setNotice(null)
    try {
      const ai = await import('../ai/client')
      try {
        setEst({ kind, ...estimate(await ai.countInputTokens(key, job)) })
      } catch (e) {
        console.error(e)
        setError(ai.describeError(e))
      }
    } catch (e) {
      console.error(e)
      setError('The AI module couldn’t be loaded. Check your connection.')
    } finally {
      setPhase({ step: 'idle' })
    }
  }

  // Right after an import, go straight to the auto-map estimate. Running it still needs a click.
  useEffect(() => {
    if (autoStart && !autoStarted.current && key && segments && mapIsEmpty && !lastMap && phase.step === 'idle' && !est) {
      autoStarted.current = true
      void doEstimate('automap')
    }
  })

  if (!key) return <KeyForm onSave={(k) => (setApiKey(k), setKey(k))} />

  const overCap = !!(est && budget && budget.spentUsd + est.maxUsd > budget.capUsd)

  async function doRun() {
    if (!est) return
    const kind = est.kind
    const job = jobFor(kind)
    if (!key || !job || !segments || !budget || overCap) return
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ step: 'running', kind })
    setProgress(0)
    setError(null)
    const ai = await import('../ai/client').catch(() => null)
    if (!ai) {
      setPhase({ step: 'idle' })
      setError('The AI module couldn’t be loaded. Check your connection.')
      return
    }
    try {
      const out = await ai.runJob(key, job, setProgress, controller.signal)
      const cost = costUsd(out.model, out.inputTokens, out.outputTokens)
      await recordSpend(db, user.uid, month, cost)
      setBudget((b) => b && { ...b, spentUsd: b.spentUsd + cost, runs: b.runs + 1 })
      if (!out.json) {
        setError(
          out.stopReason === 'refusal'
            ? `${JOB_TEXT[kind].declined} It still cost ${formatUsd(cost)}.`
            : `${JOB_TEXT[kind].cut} (${out.stopReason ?? 'unknown'}). It cost ${formatUsd(cost)}.`,
        )
        return
      }
      const info = { model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: cost }
      if (kind === 'automap') {
        const plan = planAutoMap(out.json, map, segments.length)
        if (!plan.length) {
          setError(`Claude found nothing new to map. It cost ${formatUsd(cost)}.`)
          return
        }
        await applyAutoMap(db, user, debateId, info, plan, segments)
        setNotice(`Added ${premiseCount(plan)} boxes in ${plan.length} arguments. Check them over, or undo the whole run.`)
      } else {
        const id = await saveAnalysis(db, user, debateId, info, cleanResult(out.json, map, segments.length))
        setShown(id)
      }
      setEst(null)
    } catch (e) {
      console.error(e)
      setError(ai.describeError(e))
    } finally {
      abortRef.current = null
      setPhase({ step: 'idle' })
    }
  }

  async function doUndo(run: AutoMapRun) {
    if (!confirm(`Take the ${run.boxes} auto-mapped boxes off the map? Boxes you added yourself stay.`)) return
    setPhase({ step: 'undoing', kind: 'automap' })
    setError(null)
    setNotice(null)
    try {
      await undoAutoMap(db, debateId, run.id)
      setNotice('The auto-map was removed.')
    } catch (e) {
      console.error(e)
      setError('The auto-map couldn’t be removed. Try again.')
    } finally {
      setPhase({ step: 'idle' })
    }
  }

  const current = analyses.find((a) => a.id === shown) ?? analyses[0]
  const busy = phase.step !== 'idle'

  return (
    <section className="stack-sm ai-panel">
      <div className="row-sm between">
        <span className="eyebrow">AI</span>
        <button className="linklike small" type="button" onClick={() => setSettingsOpen((o) => !o)}>
          {settingsOpen ? 'Close settings' : 'Settings'}
        </button>
      </div>
      {settingsOpen && budget && (
        <AiSettings
          capUsd={budget.capUsd}
          onCap={async (c) => {
            await setCap(db, user.uid, c)
            setBudget((b) => b && { ...b, capUsd: c })
          }}
          onForget={() => {
            setApiKey(null)
            setKey(null)
          }}
        />
      )}
      {budget && (
        <p className="small muted">
          This month: {formatUsd(budget.spentUsd)} of your {formatUsd(budget.capUsd)} cap
          {budget.runs ? ` across ${budget.runs} run${budget.runs === 1 ? '' : 's'}` : ''}.
        </p>
      )}
      {phase.step === 'running' ? (
        <div className="box stack-xs">
          <p className="small">
            {JOB_TEXT[phase.kind].running} {progress ? `${progress.toLocaleString()} characters written.` : 'Thinking first.'}
          </p>
          <button className="btn small-btn" type="button" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
          <small className="muted">Stopping still bills what was used so far.</small>
        </div>
      ) : est ? (
        <div className="box stack-xs">
          <span className="eyebrow">{est.kind === 'automap' ? 'Map automatically' : 'Analysis'}</span>
          <p className="small">
            {est.inputTokens.toLocaleString()} input tokens. Likely about <strong>{formatUsd(est.likelyUsd)}</strong>, at most{' '}
            <strong>{formatUsd(est.maxUsd)}</strong>.
          </p>
          {overCap && <p className="small error">That could pass your monthly cap. Raise the cap in Settings to run it.</p>}
          <div className="row-sm">
            <button className="btn pri small-btn" type="button" onClick={doRun} disabled={overCap}>
              {JOB_TEXT[est.kind].run}
            </button>
            <button className="btn small-btn" type="button" onClick={() => setEst(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="stack-xs">
          <button className="btn pri small-btn" type="button" onClick={() => doEstimate('automap')} disabled={!segments || busy}>
            {phase.step === 'estimating' && phase.kind === 'automap' ? 'Estimating…' : mapIsEmpty ? 'Map automatically' : 'Extend the map automatically'}
          </button>
          <button className="btn small-btn" type="button" onClick={() => doEstimate('analysis')} disabled={!segments || busy}>
            {phase.step === 'estimating' && phase.kind === 'analysis' ? 'Estimating…' : analyses.length ? 'Analyse again' : 'Find hidden premises and fallacies'}
          </button>
        </div>
      )}
      {!segments && <small className="muted">Waiting for the transcript to load.</small>}
      {notice && <small>{notice}</small>}
      {error && <small className="error">{error}</small>}
      {lastMap && (
        <div className="box stack-xs">
          <span className="small">
            Auto-mapped {lastMap.boxes} boxes in {lastMap.arguments} arguments · {formatUsd(lastMap.costUsd)}. They carry an AI badge.
          </span>
          <button className="linklike small" type="button" onClick={() => doUndo(lastMap)} disabled={busy}>
            {phase.step === 'undoing' ? 'Removing…' : 'Undo this auto-map'}
          </button>
        </div>
      )}
      {current && (
        <AnalysisView
          map={map}
          user={user}
          analysis={current}
          all={analyses}
          onShow={setShown}
          segments={segments ?? []}
          onSelectClaim={onSelectClaim}
          onSeek={onSeek}
        />
      )}
    </section>
  )
}

function KeyForm({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (value.trim()) onSave(value.trim())
  }
  return (
    <form className="stack-xs" onSubmit={submit}>
      <span className="eyebrow">AI analysis</span>
      <p className="small">
        Paste your Claude API key to find hidden premises, likely fallacies and unmapped arguments, and to draft a summary. Each run shows its cost first.
      </p>
      <input
        className="input"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="sk-ant-…"
        aria-label="Claude API key"
      />
      <button className="btn small-btn" type="submit" disabled={!value.trim()}>
        Save key
      </button>
      <small className="muted">Kept in this browser only and sent only to Anthropic. It is never saved to the app’s database.</small>
    </form>
  )
}

function AiSettings({ capUsd, onCap, onForget }: { capUsd: number; onCap: (c: number) => Promise<void>; onForget: () => void }) {
  const [cap, setCapText] = useState(String(capUsd))
  const [saved, setSaved] = useState(false)
  const n = Number(cap)
  return (
    <div className="box stack-xs">
      <label className="small" htmlFor="ai-cap">
        Monthly cap in US dollars
      </label>
      <div className="row-sm">
        <input id="ai-cap" className="input" type="number" min={0} step={1} value={cap} onChange={(e) => (setCapText(e.target.value), setSaved(false))} style={{ width: 90 }} />
        <button
          className="btn small-btn"
          type="button"
          disabled={!(n >= 0) || n === capUsd}
          onClick={() => onCap(n).then(() => setSaved(true), (e) => console.error(e))}
        >
          Save
        </button>
        {saved && <small className="muted">Saved.</small>}
      </div>
      <small className="muted">A run is blocked if its highest possible cost would take this month past the cap.</small>
      <button className="linklike small" type="button" onClick={onForget}>
        Remove the API key from this browser
      </button>
    </div>
  )
}

function AnalysisView({
  map,
  user,
  analysis,
  all,
  onShow,
  segments,
  onSelectClaim,
  onSeek,
}: {
  map: DebateMap
  user: User
  analysis: Analysis
  all: Analysis[]
  onShow: (id: string) => void
  segments: Segment[]
  onSelectClaim: (id: string) => void
  onSeek: (segment: number) => void
}) {
  const [busy, setBusy] = useState<number | 'summary' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { debate } = map
  const published = debate.aiSummary
  const isPublished = !!published && published.overall === analysis.summary.overall
  const claimText = (id: string) => map.claims.find((c) => c.id === id)?.text ?? 'a removed box'
  const pending = analysis.suggestions.map((s, i) => ({ s, i })).filter(({ i }) => !analysis.review?.[i])
  const reviewed = analysis.suggestions.length - pending.length

  async function act(i: number, fn: () => Promise<void>) {
    setBusy(i)
    setError(null)
    try {
      await fn()
    } catch (e) {
      console.error(e)
      setError('That couldn’t be saved. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const when = (a: Analysis) => {
    const ms = a.createdAt?.toMillis()
    return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'just now'
  }

  return (
    <div className="stack-sm">
      {all.length > 1 ? (
        <select className="input small" value={analysis.id} onChange={(e) => onShow(e.target.value)} aria-label="Analysis run">
          {all.map((a) => (
            <option key={a.id} value={a.id}>
              {when(a)} · {formatUsd(a.costUsd)}
            </option>
          ))}
        </select>
      ) : (
        <small className="muted">
          Run {when(analysis)} · {formatUsd(analysis.costUsd)}
        </small>
      )}

      <div className="box stack-xs">
        <span className="eyebrow">Summary draft</span>
        <p className="small">{analysis.summary.overall}</p>
        <p className="small">
          <strong>{debate.sides.for.label}:</strong> {analysis.summary.for}
        </p>
        <p className="small">
          <strong>{debate.sides.against.label}:</strong> {analysis.summary.against}
        </p>
        <button
          className="btn small-btn"
          type="button"
          disabled={busy === 'summary'}
          onClick={async () => {
            setBusy('summary')
            try {
              await publishSummary(db, debate.id, isPublished ? null : analysis.summary)
            } catch (e) {
              console.error(e)
              setError('The summary couldn’t be updated.')
            } finally {
              setBusy(null)
            }
          }}
        >
          {isPublished ? 'Take the summary down' : published ? 'Replace the shown summary' : 'Show this summary to readers'}
        </button>
      </div>

      <span className="eyebrow">
        Suggestions · {pending.length} to review{reviewed ? `, ${reviewed} done` : ''}
      </span>
      {analysis.suggestions.length === 0 && <p className="small muted">No suggestions this time.</p>}
      <ul className="stack-xs ai-list">
        {pending.map(({ s, i }) => {
          const linkGone = s.kind === 'hidden_premise' && !map.links.some((l) => l.id === s.linkId)
          return (
            <li key={i} className="box stack-xs">
              <span className="small">
                <span className="tag subtle">{KIND_LABEL[s.kind]}</span> {debate.sides[s.side].label}
              </span>
              <p className="small">
                <strong>{s.text}</strong>
              </p>
              <p className="small muted">{s.explanation}</p>
              <p className="small">
                {s.kind === 'missed_argument' ? (s.relation === 'objection' ? 'Objects to' : 'Supports') : 'About'}{' '}
                <button className="linklike" type="button" onClick={() => onSelectClaim(s.targetClaimId)}>
                  “{truncate(claimText(s.targetClaimId), 70)}”
                </button>
                {s.segment !== null && segments[s.segment] && (
                  <>
                    {' · '}
                    <button className="linklike" type="button" onClick={() => onSeek(s.segment!)}>
                      ▶ Passage
                    </button>
                  </>
                )}
              </p>
              <div className="row-sm">
                <button
                  className="btn pri small-btn"
                  type="button"
                  disabled={busy === i || linkGone}
                  title={linkGone ? 'The argument this completes has been removed.' : undefined}
                  onClick={() => act(i, () => acceptSuggestion(db, user, debate.id, analysis.id, i, s, segments))}
                >
                  {ACCEPT_LABEL[s.kind]}
                </button>
                <button className="btn small-btn" type="button" disabled={busy === i} onClick={() => act(i, () => dismissSuggestion(db, debate.id, analysis.id, i))}>
                  Dismiss
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {error && <small className="error">{error}</small>}
    </div>
  )
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
