import { describe, expect, it } from 'vitest'
import { formatTime, parseTime, parseTranscript, speakersOf, youtubeId } from './transcript'

describe('parseTranscript', () => {
  it('reads YouTube’s transcript panel, skipping spoken durations', () => {
    const text = `0:01
1 second
MAYOR: Fares only bring in about a fifth
0:05
5 seconds
of what the buses cost to run.
1:02:03
1 hour, 2 minutes, 3 seconds
COUNCILLOR: Where does the rest come from?`
    expect(parseTranscript(text)).toEqual([
      { start: 1, speaker: 'MAYOR', text: 'Fares only bring in about a fifth' },
      { start: 5, speaker: 'MAYOR', text: 'of what the buses cost to run.' },
      { start: 3723, speaker: 'COUNCILLOR', text: 'Where does the rest come from?' },
    ])
  })

  it('reads timestamps on the same line', () => {
    expect(parseTranscript('[00:12] Jane Doe: Hello there\n0:20 Next line')).toEqual([
      { start: 12, speaker: 'Jane Doe', text: 'Hello there' },
      { start: 20, speaker: 'Jane Doe', text: 'Next line' },
    ])
  })

  it('reads SRT and WebVTT captions and treats >> as an unknown new speaker', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
>> Welcome everyone.

2
00:00:03,500 --> 00:00:06,000
<i>Thank you</i> for having me.`
    expect(parseTranscript(srt)).toEqual([
      { start: 1, speaker: null, text: 'Welcome everyone.' },
      { start: 3.5, speaker: null, text: 'Thank you for having me.' },
    ])
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi.\n'
    expect(parseTranscript(vtt)).toEqual([{ start: 1, speaker: null, text: 'Hi.' }])
  })

  it('splits untimed text into paragraphs', () => {
    expect(parseTranscript('Ann: First point.\nStill first.\n\nBob: Second.')).toEqual([
      { start: null, speaker: 'Ann', text: 'First point. Still first.' },
      { start: null, speaker: 'Bob', text: 'Second.' },
    ])
  })

  it('lists speakers in order of appearance', () => {
    expect(speakersOf(parseTranscript('0:01 A: x\n0:02 B: y\n0:03 A: z'))).toEqual(['A', 'B'])
  })
})

describe('times', () => {
  it('parses and formats', () => {
    expect(parseTime('1:02:03')).toBe(3723)
    expect(parseTime('00:00:03,500')).toBe(3.5)
    expect(formatTime(3723)).toBe('1:02:03')
    expect(formatTime(65)).toBe('1:05')
  })
})

describe('youtubeId', () => {
  it('handles the common URL shapes', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ?feature=share',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
    ]) {
      expect(youtubeId(url)).toBe('dQw4w9WgXcQ')
    }
  })

  it('rejects other links', () => {
    expect(youtubeId('https://vimeo.com/123')).toBeNull()
    expect(youtubeId('not a url')).toBeNull()
  })
})
