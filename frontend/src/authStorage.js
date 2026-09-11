const TOKEN_KEY = 'gita-auth-token'
const USER_KEY = 'gita-auth-user'
const REMEMBER_KEY = 'gita-auth-remember'
const IDLE_REASON_KEY = 'gita-auth-reason'

export const DEFAULT_IDLE_MS = 15 * 60 * 1000
export const IDLE_WARN_MS = 60 * 1000

function bothStores() {
  return [window.sessionStorage, window.localStorage]
}

export function saveAuth({ token, user, remember }) {
  clearAuthStorage()
  const store = remember ? window.localStorage : window.sessionStorage
  store.setItem(TOKEN_KEY, token)
  store.setItem(USER_KEY, JSON.stringify(user || {}))
  store.setItem(REMEMBER_KEY, remember ? '1' : '0')
}

export function getToken() {
  try {
    return (
      window.sessionStorage.getItem(TOKEN_KEY) ||
      window.localStorage.getItem(TOKEN_KEY) ||
      ''
    )
  } catch {
    return ''
  }
}

export function isRemembered() {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) === '1' && Boolean(getToken())
  } catch {
    return false
  }
}

export function updateStoredUser(user) {
  const token = getToken()
  if (!token || !user) return
  saveAuth({ token, user, remember: isRemembered() })
}

export function getStoredUser() {
  try {
    const raw =
      window.sessionStorage.getItem(USER_KEY) ||
      window.localStorage.getItem(USER_KEY)
    if (!raw) return null
    const user = JSON.parse(raw)
    return user && user.id ? user : null
  } catch {
    return null
  }
}

export function clearAuthStorage() {
  try {
    for (const store of bothStores()) {
      store.removeItem(TOKEN_KEY)
      store.removeItem(USER_KEY)
      store.removeItem(REMEMBER_KEY)
    }
  } catch {
    /* ignore */
  }
}

export function setAuthNotice(reason) {
  try {
    if (reason) window.sessionStorage.setItem(IDLE_REASON_KEY, reason)
    else window.sessionStorage.removeItem(IDLE_REASON_KEY)
  } catch {
    /* ignore */
  }
}

export function consumeAuthNotice() {
  try {
    const reason = window.sessionStorage.getItem(IDLE_REASON_KEY)
    window.sessionStorage.removeItem(IDLE_REASON_KEY)
    return reason
  } catch {
    return null
  }
}

export function parseResetTokenFromHash() {
  try {
    const hash = window.location.hash.replace(/^#/, '')
    if (!hash.startsWith('/reset')) return ''
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    return new URLSearchParams(query).get('token') || ''
  } catch {
    return ''
  }
}

export function clearResetHash() {
  try {
    if (window.location.hash.replace(/^#/, '').startsWith('/reset')) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  } catch {
    /* ignore */
  }
}
