// The admin's Claude API key is kept in this browser's local storage only. It is never written to Firestore.
const KEY_STORAGE = 'parrhesia.anthropicKey'

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }
}

export function setApiKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim())
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    // Storage blocked: the key lasts for this page only.
  }
}
