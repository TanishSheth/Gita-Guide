import axios from 'axios'
import { clearAuthStorage, getToken, setAuthNotice } from './authStorage.js'

function resolveApiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/$/, '')
  }
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8000'
  }
  return `http://${host}:8000`
}

const API_BASE = resolveApiBase()

export { API_BASE }

const api = axios.create({
  baseURL: API_BASE,
})

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function emitAuthExpired(detail) {
  const message = typeof detail === 'string' ? detail : ''
  const reason = /inactiv/i.test(message) ? 'idle' : 'expired'
  setAuthNotice(reason)
  clearAuthStorage()
  window.dispatchEvent(new CustomEvent('gita-auth-expired', { detail: { reason, message } }))
}

api.interceptors.request.use((config) => {
  const headers = authHeaders()
  config.headers = { ...config.headers, ...headers }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = String(error.config?.url || '')
    const authForm = /\/auth\/(login|register|forgot-password|reset-password)/.test(
      url
    )
    if (error.response?.status === 401 && !authForm) {
      emitAuthExpired(error.response.data?.detail)
    }
    return Promise.reject(error)
  }
)

function apiError(error, fallback) {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.message) {
    return detail.message
  }
  if (Array.isArray(detail) && detail[0]?.msg) {
    return detail.map((d) => d.msg).join(' ')
  }
  if (!error.response && (error.message === 'Network Error' || error.code === 'ERR_NETWORK')) {
    return 'Could not reach the backend. Confirm uvicorn is running on port 8000, then try again.'
  }
  return error.message || fallback
}

export function apiFieldErrors(error, fallback = 'Something went wrong.') {
  const detail = error.response?.data?.detail
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const fields =
      detail.fields && typeof detail.fields === 'object' ? detail.fields : {}
    return {
      message: detail.message || apiError(error, fallback),
      fields,
    }
  }
  return { message: apiError(error, fallback), fields: {} }
}

export const registerAccount = (payload) =>
  api.post('/auth/register', payload).then((r) => r.data)

export const loginAccount = (payload) =>
  api.post('/auth/login', payload).then((r) => r.data)

export const logoutAccount = () =>
  api.post('/auth/logout').then((r) => r.data).catch(() => ({ status: 'ok' }))

export const fetchMe = () => api.get('/auth/me').then((r) => r.data)

export const getLlmStatus = () => api.get('/llm/status').then((r) => r.data)

export const updateLlmSettings = (payload) =>
  api.patch('/auth/llm', payload).then((r) => r.data)

export const forgotPassword = (email) =>
  api.post('/auth/forgot-password', { email }).then((r) => r.data)

export const resetPassword = (token, password) =>
  api.post('/auth/reset-password', { token, password }).then((r) => r.data)

export const createChat = () => api.post('/chats').then((r) => r.data)

export const listChats = ({ q = '', since = 'all' } = {}) =>
  api
    .get('/chats', {
      params: {
        ...(q ? { q } : {}),
        since,
      },
    })
    .then((r) => r.data)

export const getChat = (chatId) =>
  api.get(`/chats/${chatId}`).then((r) => r.data)

export const deleteChat = (chatId) =>
  api.delete(`/chats/${chatId}`).then((r) => r.data)

export const deleteAllChats = () =>
  api.delete('/chats').then((r) => r.data)

export const setChatBookmark = (chatId, bookmarked) =>
  api
    .patch(`/chats/${chatId}/bookmark`, { bookmarked })
    .then((r) => r.data)

export const listVerses = (chapter) =>
  api.get('/verses', { params: { chapter } }).then((r) => r.data)

export const getVerse = (chapter, verse) =>
  api.get(`/verses/${chapter}/${verse}`).then((r) => r.data)

export const getUsage = () => api.get('/usage').then((r) => r.data)

export const sendFeedback = (messageId, rating) =>
  api
    .post(`/messages/${messageId}/feedback`, { rating })
    .then((r) => r.data)

export const sendMessage = (
  chatId,
  message,
  attachMemoryContext,
  responseMode,
  temperature = 0.4,
  language = 'en'
) =>
  api
    .post(`/chat/${chatId}`, {
      message,
      attach_memory_context: attachMemoryContext,
      response_mode: responseMode,
      temperature,
      language,
    })
    .then((r) => r.data)

/**
 * Stream a chat reply over SSE.
 * handlers: { onMeta, onToken, onDone, onError }
 * options: { signal, temperature, language }
 */
export async function streamMessage(
  chatId,
  message,
  attachMemoryContext,
  responseMode,
  handlers = {},
  options = {}
) {
  let res
  try {
    res = await fetch(`${API_BASE}/chat/${chatId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(),
      },
      body: JSON.stringify({
        message,
        attach_memory_context: attachMemoryContext,
        response_mode: responseMode,
        temperature: options.temperature ?? 0.4,
        language: options.language ?? 'en',
      }),
      signal: options.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      const abortErr = new Error('Request cancelled')
      abortErr.code = 'aborted'
      throw abortErr
    }
    const offline = new Error(
      'Could not reach the backend. Is the FastAPI server running on :8000?'
    )
    offline.code = 'offline'
    throw offline
  }

  if (!res.ok) {
    let detail = `Stream failed with status ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : detail
    } catch {
      /* ignore */
    }
    if (res.status === 401) emitAuthExpired(detail)
    const err = new Error(detail)
    err.code = res.status === 429 ? 'rate_limit' : res.status === 401 ? 'auth' : 'http'
    err.status = res.status
    throw err
  }
  if (!res.body) {
    throw new Error('No response body for stream')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        const lines = part.split('\n')
        let event = 'message'
        const dataLines = []
        for (const line of lines) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim())
          }
        }
        if (!dataLines.length) continue
        let data
        try {
          data = JSON.parse(dataLines.join('\n'))
        } catch {
          continue
        }

        if (event === 'meta') handlers.onMeta?.(data)
        else if (event === 'token') handlers.onToken?.(data)
        else if (event === 'done') handlers.onDone?.(data)
        else if (event === 'error') {
          handlers.onError?.(data)
          const err = new Error(data.detail || 'Stream error')
          err.code = data.code || 'stream'
          throw err
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const abortErr = new Error('Request cancelled')
      abortErr.code = 'aborted'
      throw abortErr
    }
    throw err
  }
}

export { apiError }
export default api
