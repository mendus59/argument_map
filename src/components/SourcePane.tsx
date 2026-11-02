import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { formatTime, type Segment } from '../import/transcript'
import { loadYouTubeApi, segmentAt, type YTPlayer } from '../import/youtube'
import type { Claim, ClaimSource, Debate, SideId } from '../model/types'

export type SeekFn = (seconds: number) => void

/**
 * The video and transcript beside an imported debate's map.
 * The admin selects transcript text to map it as a box.
 */
export function SourcePane({
  debate,
  segments,
  claims,
  seekRef,
  focusSegment,
  canMap,
  onQuote,
  onSelectClaim,
}: {
  debate: Debate
  segments: Segment[] | null
  claims: Claim[]
  seekRef: RefObject<SeekFn | null>
  focusSegment: number | null
  canMap: boolean
  onQuote: (source: ClaimSource) => void
  onSelectClaim: (id: string) => void
}) {
  const src = debate.source
  const [playing, setPlaying] = useState(-1)
  const [pick, setPick] = useState<ClaimSource | null>(null)
  const [follow, setFollow] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const starts = useMemo(() => (segments ?? []).map((s) => s.start), [segments])
  const startsRef = useRef(starts)
  useEffect(() => {
    startsRef.current = starts
  }, [starts])
  const sideOf = useMemo(() => new Map((src?.speakers ?? []).map((s) => [s.label, s.side])), [src])
  const mapped = useMemo(() => {
    const m = new Map<number, Claim[]>()
    for (const c of claims) if (c.source) m.set(c.source.segment, [...(m.get(c.source.segment) ?? []), c])
    return m
  }, [claims])

  // The player follows along: highlight the line being spoken.
  const playerRef = useRef<YTPlayer | null>(null)
  const playerEl = useRef<HTMLDivElement>(null)
  const [playerError, setPlayerError] = useState(false)
  useEffect(() => {
    if (!src?.videoId || !playerEl.current) return
    let cancelled = false
    let timer = 0
    const host = document.createElement('div')
    playerEl.current.appendChild(host)
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return
        playerRef.current = new YT.Player(host, {
          videoId: src.videoId!,
          host: 'https://www.youtube-nocookie.com',
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        })
        timer = window.setInterval(() => {
          const p = playerRef.current
          if (!p?.getCurrentTime) return
          setPlaying(segmentAt(startsRef.current, p.getCurrentTime()))
        }, 700)
      })
      .catch(() => setPlayerError(true))
    return () => {
      cancelled = true
      window.clearInterval(timer)
      playerRef.current?.destroy?.()
      playerRef.current = null
      host.remove()
    }
  }, [src?.videoId])

  useEffect(() => {
    seekRef.current = (t: number) => {
      const p = playerRef.current
      if (!p?.seekTo) return
      p.seekTo(t, true)
      p.playVideo()
    }
    return () => {
      seekRef.current = null
    }
  }, [seekRef])

  // Scroll the transcript to a box's passage, or along with playback.
  useEffect(() => {
    if (focusSegment === null) return
    listRef.current?.querySelector(`[data-seg="${focusSegment}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusSegment])
  useEffect(() => {
    if (!follow || playing < 0) return
    listRef.current?.querySelector(`[data-seg="${playing}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [follow, playing])

  function readSelection() {
    if (!canMap || !segments) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return setPick(null)
    const range = sel.getRangeAt(0)
    if (!listRef.current?.contains(range.commonAncestorContainer)) return setPick(null)
    const quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 1000)
    const node = range.startContainer
    const el = (node instanceof Element ? node : node.parentElement)?.closest('[data-seg]')
    const index = Number(el?.getAttribute('data-seg') ?? -1)
    if (!quote || index < 0) return setPick(null)
    const seg = segments[index]
    setPick({ segment: index, start: seg.start, speaker: seg.speaker, quote })
  }

  function speakerClass(speaker: string | null) {
    const side: SideId | null | undefined = speaker ? sideOf.get(speaker) : undefined
    return side ? `spk ${side}` : 'spk'
  }

  return (
    <section className="source-col" aria-label="Source">
      {src?.videoId && (
        <div className="video">
          <div ref={playerEl} className="video-frame" />
          {playerError && (
            <p className="small error video-error">
              The player couldn’t load. <a href={src.url ?? '#'} target="_blank" rel="noreferrer">Watch on YouTube</a>
            </p>
          )}
        </div>
      )}
      <div className="source-meta row-sm between">
        <span className="small muted">
          {src?.url ? (
            <a href={src.url} target="_blank" rel="noreferrer">
              {src.title || 'Source video'}
            </a>
          ) : (
            src?.title || 'Transcript'
          )}
          {src?.channel && ` · ${src.channel}`}
        </span>
        {src?.videoId && (
          <label className="small row-sm" htmlFor="follow">
            <input id="follow" type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow video
          </label>
        )}
      </div>
      {canMap && <p className="small muted map-tip">Select words in the transcript to map them as a box.</p>}
      {!segments && <p className="small muted">Loading transcript…</p>}
      {segments && (
        <ol ref={listRef} className="transcript" onMouseUp={readSelection} onKeyUp={readSelection} onTouchEnd={() => setTimeout(readSelection, 50)}>
          {segments.map((s, i) => {
            const boxes = mapped.get(i)
            return (
              <li key={i} data-seg={i} className={`${i === playing ? 'now' : ''}${i === focusSegment ? ' focus' : ''}`}>
                {s.start !== null && (
                  <button type="button" className="ts" onClick={() => seekRef.current?.(s.start!)} disabled={!src?.videoId} title={src?.videoId ? 'Play from here' : undefined}>
                    {formatTime(s.start)}
                  </button>
                )}
                {s.speaker && (i === 0 || segments[i - 1].speaker !== s.speaker) && <span className={speakerClass(s.speaker)}>{s.speaker}</span>}
                <span className="seg-text">{s.text}</span>
                {boxes?.map((c) => (
                  <button key={c.id} type="button" className={`mapped ${c.side}`} onClick={() => onSelectClaim(c.id)} title={c.text}>
                    ◆ mapped
                  </button>
                ))}
              </li>
            )
          })}
        </ol>
      )}
      {pick && (
        <div className="quote-bar">
          <p className="small">
            <span className="muted">
              {pick.start !== null && `${formatTime(pick.start)} · `}
              {pick.speaker ?? 'Unnamed speaker'}
            </span>
            <br />“{pick.quote.length > 140 ? `${pick.quote.slice(0, 140)}…` : pick.quote}”
          </p>
          <span className="row-sm">
            <button
              className="btn pri small-btn"
              type="button"
              onClick={() => {
                onQuote(pick)
                setPick(null)
                window.getSelection()?.removeAllRanges()
              }}
            >
              Map this
            </button>
            <button className="btn small-btn" type="button" onClick={() => setPick(null)}>
              Cancel
            </button>
          </span>
        </div>
      )}
    </section>
  )
}
