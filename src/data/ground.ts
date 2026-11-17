import { useEffect, useMemo, useState } from 'react'
import type { Firestore } from 'firebase/firestore'
import { watchCommonGround, watchGroundSource } from './agreement'
import { groundedStatus } from '../model/agreement'
import type { DebateMap, GlossaryEntry, GroundEntry, GroundedStatus } from '../model/types'

export interface CommonGround {
  pair: string
  ground: GroundEntry[]
  glossary: GlossaryEntry[]
}

/** What the two people have agreed across their debates. Null when there's no pair yet, or the viewer isn't in it. */
export function useCommonGround(db: Firestore, pair: string | null): CommonGround | null {
  const [state, setState] = useState<CommonGround | null>(null)
  useEffect(() => {
    if (!pair) return
    return watchCommonGround(db, pair, (v) => setState({ pair, ...v }), (e) => console.warn('Common ground unavailable', e))
  }, [db, pair])
  return pair && state?.pair === pair ? state : null
}

/** Adds the live status of every reused agreed claim to the map. */
export function useGrounded(db: Firestore, map: DebateMap | null | undefined): DebateMap | null | undefined {
  const refs = useMemo(
    () => (map?.claims ?? []).filter((c) => c.groundRef).map((c) => ({ boxId: c.id, ...c.groundRef! })),
    [map?.claims],
  )
  const key = refs.map((r) => `${r.boxId}:${r.debateId}/${r.claimId}@${r.version}`).join('|')
  const [status, setStatus] = useState<Record<string, GroundedStatus>>({})
  useEffect(() => {
    const stops = refs.map((r) =>
      watchGroundSource(
        db,
        r,
        (src) => setStatus((s) => ({ ...s, [r.boxId]: groundedStatus(src, r.version) })),
        (e) => console.warn('Couldn’t follow a reused claim', e),
      ),
    )
    return () => stops.forEach((s) => s())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, key])
  return useMemo(() => (map ? { ...map, grounded: status } : map), [map, status])
}
