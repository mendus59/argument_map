import { FirebaseError } from 'firebase/app'

/** A plain explanation of why a Firestore write failed, so a refused save isn't blamed on the connection. */
export function saveErrorMessage(e: unknown, what: string): string {
  const code = e instanceof FirebaseError ? e.code.replace(/^firestore\//, '') : ''
  switch (code) {
    case 'permission-denied':
      return `${what} was refused: your account isn’t allowed to do this. If you should be, check that the latest Firestore rules are published, then sign out and back in.`
    case 'invalid-argument':
    case 'resource-exhausted':
      return `${what} is too large to save. Try a shorter transcript.`
    case 'unauthenticated':
      return `${what} couldn’t be saved because you’re signed out. Sign in and try again.`
    case 'unavailable':
    case 'deadline-exceeded':
      return `${what} couldn’t be saved. Check your connection and try again.`
    default:
      return `${what} couldn’t be saved${code ? ` (${code})` : ''}. Try again.`
  }
}
