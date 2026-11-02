import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { createImport, fetchVideoInfo } from '../data/imports'
import { formatTime, parseTranscript, speakersOf, youtubeId } from '../import/transcript'
import type { SideId } from '../model/types'

type Assign = SideId | 'none'

export default function ImportPage() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [channel, setChannel] = useState<string | null>(null)
  const [videoNote, setVideoNote] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [subjects, setSubjects] = useState('')
  const [labels, setLabels] = useState<Record<SideId, string>>({ for: 'For', against: 'Against' })
  const [text, setText] = useState('')
  const [assign, setAssign] = useState<Record<string, Assign>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const videoId = url.trim() ? youtubeId(url) : null
  const segments = useMemo(() => parseTranscript(text), [text])
  const speakers = useMemo(() => speakersOf(segments), [segments])
  const timed = segments.some((s) => s.start !== null)

  if (!user) return null
  if (!isAdmin) {
    return (
      <div className="page narrow stack-sm">
        <h1>Import a debate</h1>
        <p className="muted">Importing is only open to the admin.</p>
      </div>
    )
  }

  async function lookUpVideo() {
    setVideoNote(null)
    if (!url.trim()) return
    if (!videoId) {
      setVideoNote('That doesn’t look like a YouTube link.')
      return
    }
    const info = await fetchVideoInfo(videoId)
    if (!info) {
      setVideoNote('The video’s title couldn’t be looked up. Type it in below.')
      return
    }
    setChannel(info.channel || null)
    if (!title.trim()) setTitle(info.title)
  }

  function readFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then(setText).catch(console.error)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (url.trim() && !videoId) {
      setError('Fix the YouTube link, or clear it to import a transcript on its own.')
      return
    }
    if (!segments.length) {
      setError('Paste the transcript first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = await createImport(db, user, {
        title,
        conclusion: conclusion || title,
        subjects: subjects
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
        labels,
        source: {
          kind: videoId ? 'youtube' : 'transcript',
          url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
          videoId,
          title,
          channel,
          speakers: speakers.map((label) => ({ label, side: assign[label] && assign[label] !== 'none' ? (assign[label] as SideId) : null })),
        },
        segments,
      })
      navigate(`/d/${id}`)
    } catch (err) {
      console.error(err)
      setError('The import could not be saved. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <form className="page narrow stack" onSubmit={submit}>
      <div className="stack-xs">
        <span className="eyebrow">Admin</span>
        <h1>Import a debate</h1>
        <p className="muted small">Imports start private. You can invite readers or make it public from the debate page.</p>
      </div>

      <label className="field" htmlFor="yt-url">
        <span>YouTube link</span>
        <input id="yt-url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={lookUpVideo} placeholder="https://www.youtube.com/watch?v=…" />
        {videoNote ? <small className="error">{videoNote}</small> : <small className="muted">Optional. With a link, every box you map can jump to its moment in the video.</small>}
      </label>
      {videoId && <img className="yt-thumb" src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" />}

      <label className="field" htmlFor="transcript">
        <span>Transcript</span>
        <textarea id="transcript" className="input mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paste it here.\n\nOn YouTube: open the video, click “…more” under it, then “Show transcript”. Select the whole transcript panel, copy, and paste.'} />
        <span className="row-sm small">
          <span className="muted">Or load a caption file (.srt, .vtt or .txt):</span>
          <input type="file" accept=".srt,.vtt,.txt,text/plain" onChange={readFile} aria-label="Caption file" />
        </span>
        {segments.length > 0 && (
          <small className="ok">
            Read {segments.length} {segments.length === 1 ? 'line' : 'lines'}
            {timed ? `, up to ${formatTime(Math.max(...segments.map((s) => s.start ?? 0)))}` : ', without timestamps'}
            {speakers.length ? `, ${speakers.length} named ${speakers.length === 1 ? 'speaker' : 'speakers'}` : ''}.
          </small>
        )}
      </label>

      {segments.length > 0 && (
        <div className="box stack-xs">
          <span className="eyebrow">Preview</span>
          <ol className="preview-list">
            {segments.slice(0, 5).map((s, i) => (
              <li key={i}>
                {s.start !== null && <span className="mono muted">{formatTime(s.start)} </span>}
                {s.speaker && <strong>{s.speaker}: </strong>}
                {s.text}
              </li>
            ))}
          </ol>
          {segments.length > 5 && <small className="muted">…and {segments.length - 5} more.</small>}
        </div>
      )}

      <label className="field" htmlFor="title">
        <span>Title</span>
        <input id="title" required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="City council debate on fare-free buses" />
      </label>
      <label className="field" htmlFor="conclusion">
        <span>Conclusion being debated</span>
        <input id="conclusion" maxLength={500} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="The city should make its buses fare-free." />
        <small className="muted">The statement at the top of the map. If you leave it blank, the title is used.</small>
      </label>
      <label className="field" htmlFor="subjects">
        <span>Subjects</span>
        <input id="subjects" value={subjects} onChange={(e) => setSubjects(e.target.value)} placeholder="transit, city budget" />
        <small className="muted">Separate with commas. Public debates are searchable by subject and participant.</small>
      </label>

      <fieldset className="field">
        <legend>Sides</legend>
        <div className="row">
          {(['for', 'against'] as SideId[]).map((s) => (
            <label key={s} className="field grow" htmlFor={`label-${s}`}>
              <small className="muted">{s === 'for' ? 'Side for the conclusion' : 'Side against it'}</small>
              <input id={`label-${s}`} maxLength={60} value={labels[s]} onChange={(e) => setLabels({ ...labels, [s]: e.target.value })} />
            </label>
          ))}
        </div>
      </fieldset>

      {speakers.length > 0 ? (
        <fieldset className="field">
          <legend>Who argued which side</legend>
          <div className="stack-xs">
            {speakers.map((sp) => (
              <label key={sp} className="row between speaker-row" htmlFor={`sp-${sp}`}>
                <span>{sp}</span>
                <select id={`sp-${sp}`} className="input" value={assign[sp] ?? 'none'} onChange={(e) => setAssign({ ...assign, [sp]: e.target.value as Assign })}>
                  <option value="for">{labels.for || 'For'}</option>
                  <option value="against">{labels.against || 'Against'}</option>
                  <option value="none">Neither (moderator, audience)</option>
                </select>
              </label>
            ))}
          </div>
          <small className="muted">Boxes you map from a speaker’s words start on that speaker’s side.</small>
        </fieldset>
      ) : (
        segments.length > 0 && <p className="small muted">No speaker names were found, so you’ll pick the side for each box as you map it.</p>
      )}

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? 'Importing…' : 'Import and start mapping'}
        </button>
      </div>
    </form>
  )
}
