import { useState } from 'react'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { createInvite, type InviteRole } from '../data/debates'
import type { Debate, SideId } from '../model/types'

export function InviteButton({ debate, role, side, label, primary }: { debate: Debate; role: InviteRole; side: SideId | null; label: string; primary?: boolean }) {
  const { user } = useAuth()
  const [link, setLink] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'error'>('idle')

  async function make() {
    if (!user) return
    setState('busy')
    try {
      const token = await createInvite(db, user, debate, role, side)
      const url = `${window.location.origin}${import.meta.env.BASE_URL}invite/${token}`
      setLink(url)
      try {
        await navigator.clipboard.writeText(url)
        setState('copied')
      } catch {
        setState('idle')
      }
    } catch (e) {
      console.error(e)
      setState('error')
    }
  }

  return (
    <div className="stack-xs">
      <button className={`btn ${primary ? 'pri' : ''}`} type="button" onClick={make} disabled={state === 'busy'}>
        {label}
      </button>
      {link && <input className="link-box" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />}
      {state === 'copied' && <small className="ok">Link copied.</small>}
      {state === 'error' && <small className="error">The invite could not be created. Try again.</small>}
    </div>
  )
}
