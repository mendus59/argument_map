/** One line or caption of a transcript. `start` is in seconds, or null when the text had no timestamps. */
export interface Segment {
  start: number | null
  speaker: string | null
  text: string
}

const TIME = /^\[?\(?(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?\)?\]?$/
const TIME_PREFIX = /^\[?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?\)?\]?\s+(.*)$/
const CUE = /^((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*/
// YouTube's transcript panel adds spoken-length lines such as "3 seconds" or "1 minute, 5 seconds".
const DURATION = /^\d+\s+(hours?|minutes?|seconds?)(,\s*\d+\s+(hours?|minutes?|seconds?))*$/i
const SPEAKER = /^(?:>>\s*)?([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}):\s+(.+)$/

/** Parses "1:02:03", "02:03", "2:03.500" or "00:02:03,500" into seconds. */
export function parseTime(raw: string): number {
  const cleaned = raw.replace(/[[\]()]/g, '').replace(',', '.')
  const parts = cleaned.split(':').map(Number)
  return parts.reduce((total, p) => total * 60 + p, 0)
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * Parses a pasted transcript. Handles YouTube's "Show transcript" panel (timestamp
 * on its own line), "0:03 text" lines, SRT and WebVTT captions, and plain text.
 * "Name: text" prefixes become speakers; a speaker carries over until the next one.
 */
export function parseTranscript(input: string): Segment[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim())
  const raw: { start: number | null; text: string }[] = []
  let current: { start: number | null; text: string } | null = null
  const flush = () => {
    if (current && current.text.trim()) raw.push({ start: current.start, text: current.text.trim() })
    current = null
  }
  const hasTimes = lines.some((l) => TIME.test(l) || TIME_PREFIX.test(l) || CUE.test(l))

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) {
      if (!hasTimes) flush()
      continue
    }
    if (line === 'WEBVTT' || /^(Kind|Language|NOTE)\b/.test(line)) continue
    if (/^\d+$/.test(line) && lines[i + 1] && CUE.test(lines[i + 1])) continue // SRT index
    if (DURATION.test(line)) continue
    const cue = CUE.exec(line)
    if (cue) {
      flush()
      current = { start: parseTime(cue[1]), text: '' }
      continue
    }
    if (TIME.test(line)) {
      flush()
      current = { start: parseTime(line), text: '' }
      continue
    }
    const prefixed = TIME_PREFIX.exec(line)
    if (prefixed) {
      flush()
      current = { start: parseTime(prefixed[1]), text: prefixed[2] }
      continue
    }
    const clean = line.replace(/<[^>]+>/g, '')
    if (!current) current = { start: null, text: '' }
    current.text = current.text ? `${current.text} ${clean}` : clean
  }
  flush()

  let speaker: string | null = null
  return raw.map(({ start, text }) => {
    const m = SPEAKER.exec(text)
    if (m) {
      speaker = m[1]
      return { start, speaker, text: m[2].trim() }
    }
    if (text.startsWith('>>')) {
      speaker = null
      return { start, speaker, text: text.replace(/^>>\s*/, '') }
    }
    return { start, speaker, text }
  })
}

export function speakersOf(segments: Segment[]): string[] {
  return [...new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s))]
}

/** Extracts the video id from the usual YouTube URL shapes, or null. */
export function youtubeId(url: string): string | null {
  const s = url.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '')
    if (host === 'youtu.be') return valid(u.pathname.slice(1))
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return valid(u.searchParams.get('v')!)
      const m = /^\/(embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname)
      if (m) return m[2]
    }
  } catch {
    return null
  }
  return null
}

function valid(id: string) {
  const clean = id.split(/[/?&#]/)[0]
  return /^[\w-]{11}$/.test(clean) ? clean : null
}
