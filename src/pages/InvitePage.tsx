import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { db } from '../firebase'
import { acceptInvite, getInvite, type Invite } from '../data/debates'

const ROLE_TEXT = {
  leader: (side: string) => `lead the ${side} side`,
  member: (side: string) => `join the ${side} side`,
  reader: () => 'read the debate',
}

export default function InvitePage() {
  const { token = '' } = useParams()
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined)
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')

  useEffect(() => {
    if (!user) return
    getInvite(db, token)
      .then(setInvite)
      .catch((e) => {
        console.error(e)
        setInvite(null)
      })
  }, [user, token])

  if (!user) {
    return (
      <div className="page narrow stack">
        <h1>You’ve been invited to a debate</h1>
        <p>Sign in with Google to see the invitation.</p>
        <div className="row">
          <button className="btn pri" type="button" onClick={() => signIn().catch(console.error)}>
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }
  if (invite === undefined) return <p className="page narrow muted">Loading…</p>
  if (invite === null) return <p className="page narrow error">This invite link isn’t valid. Ask for a new one.</p>
  if (invite.usedBy && invite.usedBy !== user.uid) {
    return <p className="page narrow error">This invite has already been used. Each link works once, so ask for a new one.</p>
  }
  if (invite.usedBy === user.uid) {
    navigate(`/d/${invite.debateId}`, { replace: true })
    return null
  }

  const sideLabel = invite.side === 'for' ? 'For' : 'Against'
  const action = ROLE_TEXT[invite.role](sideLabel)

  async function accept() {
    if (!user || !invite) return
    setState('busy')
    try {
      await acceptInvite(db, user, invite)
      navigate(`/d/${invite.debateId}`)
    } catch (e) {
      console.error(e)
      setState('error')
    }
  }

  return (
    <div className="page narrow stack">
      <span className="eyebrow">Invitation</span>
      <h1>{invite.debateTitle}</h1>
      <p>You’ve been invited to {action}.</p>
      {state === 'error' && (
        <p className="error">You couldn’t be added. You may already be in this debate, or the seat may be taken. Ask for a new link.</p>
      )}
      <div className="row">
        <button className="btn pri" type="button" onClick={accept} disabled={state === 'busy'}>
          {state === 'busy' ? 'Joining…' : `Accept and ${action}`}
        </button>
      </div>
    </div>
  )
}
