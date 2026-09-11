const BOOKMARKS_KEY = 'gita-bookmarks'
const TEMP_KEY = 'gita-temperature'
const LANG_KEY = 'gita-language'

export function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveBookmarks(list) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function verseKey(v) {
  return `${v.chapter}-${v.verse}`
}

export function loadTemperature() {
  try {
    const v = Number(localStorage.getItem(TEMP_KEY))
    if (Number.isFinite(v)) return Math.min(1, Math.max(0, v))
  } catch {
    /* ignore */
  }
  return 0.4
}

export function saveTemperature(value) {
  try {
    localStorage.setItem(TEMP_KEY, String(value))
  } catch {
    /* ignore */
  }
}

const LANGS = new Set(['en', 'hi', 'gu', 'es'])

export function loadLanguage() {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v && LANGS.has(v)) return v
  } catch {
    /* ignore */
  }
  return 'en'
}

export function saveLanguage(value) {
  try {
    if (LANGS.has(value)) localStorage.setItem(LANG_KEY, value)
  } catch {
    /* ignore */
  }
}
