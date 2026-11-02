import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth'
import { auth, db, googleProvider } from './firebase'
import { saveProfile } from './data/debates'
import { checkAdmin } from './data/imports'

interface AuthState {
  user: User | null
  loading: boolean
  /** True for the app admin, who can import debates. */
  isAdmin: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u)
        setLoading(false)
        setIsAdmin(false)
        if (u) {
          saveProfile(db, u).catch((e) => console.error('Could not save profile', e))
          checkAdmin(db, u).then(setIsAdmin)
        }
      }),
    [],
  )

  const value: AuthState = {
    user,
    loading,
    isAdmin,
    signIn: async () => {
      await signInWithPopup(auth, googleProvider)
    },
    signOut: () => fbSignOut(auth),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
