import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ChatWindow from './components/ChatWindow.jsx'
import SourcePanel from './components/SourcePanel.jsx'
import {
  listChats,
  getChat,
  deleteChat,
  deleteAllChats,
  streamMessage,
  getUsage,
  sendFeedback,
  setChatBookmark,
  getVerse,
  loginAccount,
  registerAccount,
  logoutAccount,
  fetchMe,
  forgotPassword,
  resetPassword,
  apiError,
} from './api.js'
import {
  loadBookmarks,
  saveBookmarks,
  verseKey,
  loadTemperature,
  saveTemperature,
  loadLanguage,
  saveLanguage,
} from './bookmarks.js'
import AuthScreen from './components/AuthScreen.jsx'
import {
  saveAuth,
  getToken,
  getStoredUser,
  clearAuthStorage,
  setAuthNotice,
  parseResetTokenFromHash,
  clearResetHash,
  IDLE_WARN_MS,
  updateStoredUser,
} from './authStorage.js'

function loadDarkMode() {
  try {
    return localStorage.getItem('gita-dark') === '1'
  } catch {
    return false
  }
}

/** Works on phone LAN http://IP (crypto.randomUUID needs a secure context). */
function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function exportMarkdown(messages, sources, title) {
  const lines = [
    `# ${title || 'Gita Guide Chat'}`,
    '',
    `Exported: ${new Date().toISOString()}`,
    '',
  ]
  for (const m of messages) {
    if (m.role === 'user') {
      lines.push(`## You`, '', m.content, '')
    } else {
      lines.push(`## Guide`, '', m.content, '')
      const src = m.sources?.length ? m.sources : sources
      if (src?.length) {
        lines.push(`### Sources`, '')
        for (const v of src) {
          lines.push(
            `- **Chapter ${v.chapter}, Verse ${v.verse}**`,
            v.transliteration ? `  - *${v.transliteration}*` : '',
            `  - ${v.english_translation}`,
            ''
          )
        }
      }
    }
  }
  const blob = new Blob([lines.filter((l) => l !== undefined).join('\n')], {
    type: 'text/markdown;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safe = (title || 'chat').replace(/[^\w\-]+/g, '_').slice(0, 40)
  a.href = url
  a.download = `gita-chat-${safe}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function snapshotVerse(v) {
  return {
    chapter: v.chapter,
    verse: v.verse,
    sanskrit: v.sanskrit || '',
    transliteration: v.transliteration || '',
    english_translation: v.english_translation || '',
    translations: v.translations || [],
  }
}

export default function App() {
  const [user, setUser] = useState(getStoredUser)
  const [authReady, setAuthReady] = useState(false)
  const [authView, setAuthView] = useState(
    parseResetTokenFromHash() ? 'reset' : 'login'
  )
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [authInfo, setAuthInfo] = useState(null)
  const [resetToken, setResetToken] = useState(() => parseResetTokenFromHash())
  const [idleWarning, setIdleWarning] = useState(false)
  const [idleMinutes, setIdleMinutes] = useState(15)
  const [chats, setChats] = useState([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [activeChatId, setActiveChatId] = useState(() => newId())
  const [messages, setMessages] = useState([])
  const [sources, setSources] = useState([])
  const [sending, setSending] = useState(false)
  const [attachMemory, setAttachMemory] = useState(true)
  const [responseMode, setResponseMode] = useState('practical')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [highlightedSourceKey, setHighlightedSourceKey] = useState(null)
  const [error, setError] = useState(null)
  const [retryText, setRetryText] = useState(null)
  const [draft, setDraft] = useState('')
  const [panelTab, setPanelTab] = useState('sources')
  const [darkMode, setDarkMode] = useState(loadDarkMode)
  const [usage, setUsage] = useState(null)
  const [chatTitle, setChatTitle] = useState('New Chat')
  const [bookmarks, setBookmarks] = useState(loadBookmarks)
  const [temperature, setTemperatureState] = useState(loadTemperature)
  const [language, setLanguageState] = useState(loadLanguage)
  const [focusVerse, setFocusVerse] = useState(null)
  const [leftPinned, setLeftPinned] = useState(false)
  const [leftPeek, setLeftPeek] = useState(false)
  const [canHover, setCanHover] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [rightUserClosed, setRightUserClosed] = useState(false)
  const [rightUserOpened, setRightUserOpened] = useState(false)
  const searchTimer = useRef(null)
  const abortRef = useRef(null)
  const lastUserText = useRef(null)
  const leaveTimer = useRef(null)

  const rateLimited = usage != null && usage.remaining === 0
  const leftVisible = leftPinned || leftPeek
  const chatHasContext = sources.length > 0
  // Mobile: don't auto-open sources (would cover the chat); user opens via Sources / citation
  const rightOpen = isMobile
    ? rightUserOpened && !rightUserClosed
    : (chatHasContext || rightUserOpened) && !rightUserClosed

  const setTemperature = (value) => {
    setTemperatureState(value)
    saveTemperature(value)
  }

  const setLanguage = (value) => {
    setLanguageState(value)
    saveLanguage(value)
  }

  const resetLocalChat = () => {
    if (abortRef.current) abortRef.current.abort()
    setChats([])
    setActiveChatId(newId())
    setMessages([])
    setSources([])
    setHighlightedSourceKey(null)
    setDraft('')
    setChatTitle('New Chat')
    setError(null)
    setRetryText(null)
    setRightUserOpened(false)
    setRightUserClosed(false)
    setIdleWarning(false)
  }

  const applySession = (data) => {
    saveAuth({
      token: data.token,
      user: data.user,
      remember: Boolean(data.remember),
    })
    setUser(data.user)
    setIdleMinutes(data.idle_minutes || 15)
    setAuthError(null)
    setAuthInfo(null)
    clearResetHash()
    setResetToken('')
    setAuthView('login')
  }

  const handleLogout = async (reason) => {
    try {
      await logoutAccount()
    } catch {
      /* ignore */
    }
    if (reason) setAuthNotice(reason)
    clearAuthStorage()
    setUser(null)
    setAuthView('login')
    resetLocalChat()
  }

  const handleUserUpdate = (nextUser) => {
    setUser(nextUser)
    updateStoredUser(nextUser)
  }

  const handleLogin = async ({ email, password, remember }) => {
    setAuthBusy(true)
    setAuthError(null)
    setAuthInfo(null)
    try {
      const data = await loginAccount({ email, password, remember })
      applySession(data)
    } catch (e) {
      setAuthError(apiError(e, 'Could not sign in.'))
    } finally {
      setAuthBusy(false)
    }
  }

  const handleRegister = async ({ name, email, password, confirm }) => {
    if (password !== confirm) {
      setAuthError('Passwords do not match.')
      return
    }
    setAuthBusy(true)
    setAuthError(null)
    setAuthInfo(null)
    try {
      const data = await registerAccount({ name, email, password })
      applySession({ ...data, remember: false })
    } catch (e) {
      setAuthError(apiError(e, 'Could not create the account.'))
    } finally {
      setAuthBusy(false)
    }
  }

  const handleForgot = async ({ email }) => {
    setAuthBusy(true)
    setAuthError(null)
    setAuthInfo(null)
    try {
      const data = await forgotPassword(email)
      if (data.reset_url) {
        setAuthInfo(data.reset_url)
        try {
          const hash = new URL(data.reset_url).hash.replace(/^#/, '')
          const token = new URLSearchParams(hash.split('?')[1] || '').get('token')
          if (token) setResetToken(token)
        } catch {
          /* ignore */
        }
      } else {
        setAuthInfo(
          data.message || 'If that email is registered, a reset link was sent.'
        )
      }
    } catch (e) {
      setAuthError(apiError(e, 'Could not start a password reset.'))
    } finally {
      setAuthBusy(false)
    }
  }

  const handleReset = async ({ token, password, confirm }) => {
    if (password !== confirm) {
      setAuthError('Passwords do not match.')
      return
    }
    setAuthBusy(true)
    setAuthError(null)
    setAuthInfo(null)
    try {
      const data = await resetPassword(token || resetToken, password)
      applySession({ ...data, remember: false })
    } catch (e) {
      setAuthError(apiError(e, 'Could not reset the password.'))
    } finally {
      setAuthBusy(false)
    }
  }

  useEffect(() => {
    const tokenFromHash = parseResetTokenFromHash()
    if (tokenFromHash) {
      setResetToken(tokenFromHash)
      setAuthView('reset')
      setAuthReady(true)
      return
    }
    if (!getToken()) {
      setAuthReady(true)
      return
    }
    fetchMe()
      .then((me) => {
        setUser(me)
        setAuthReady(true)
      })
      .catch(() => {
        clearAuthStorage()
        setUser(null)
        setAuthReady(true)
      })
  }, [])

  useEffect(() => {
    const onExpired = (event) => {
      const reason = event.detail?.reason || 'expired'
      setAuthNotice(reason)
      setUser(null)
      setAuthView('login')
      resetLocalChat()
    }
    const onHash = () => {
      const token = parseResetTokenFromHash()
      if (token) {
        setResetToken(token)
        setAuthView('reset')
        setUser(null)
      }
    }
    window.addEventListener('gita-auth-expired', onExpired)
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('gita-auth-expired', onExpired)
      window.removeEventListener('hashchange', onHash)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!user) return undefined
    const idleMs = Math.max(60 * 1000, (idleMinutes || 15) * 60 * 1000)
    let lastActivity = Date.now()
    let idleTimer
    let warnTimer

    const clearTimers = () => {
      if (idleTimer) clearTimeout(idleTimer)
      if (warnTimer) clearTimeout(warnTimer)
    }

    const arm = () => {
      clearTimers()
      setIdleWarning(false)
      lastActivity = Date.now()
      warnTimer = setTimeout(
        () => setIdleWarning(true),
        Math.max(0, idleMs - IDLE_WARN_MS)
      )
      idleTimer = setTimeout(() => handleLogout('idle'), idleMs)
    }

    const onActivity = () => {
      if (document.visibilityState === 'hidden') return
      arm()
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastActivity >= idleMs) {
        handleLogout('idle')
        return
      }
      arm()
    }

    arm()
    const events = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'scroll']
    events.forEach((name) =>
      window.addEventListener(name, onActivity, { passive: true })
    )
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimers()
      events.forEach((name) => window.removeEventListener(name, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, idleMinutes])

  useEffect(() => {
    const hoverMq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const mobileMq = window.matchMedia('(max-width: 767px)')
    const syncHover = () => setCanHover(hoverMq.matches)
    const syncMobile = () => setIsMobile(mobileMq.matches)
    syncHover()
    syncMobile()
    hoverMq.addEventListener?.('change', syncHover)
    mobileMq.addEventListener?.('change', syncMobile)
    return () => {
      hoverMq.removeEventListener?.('change', syncHover)
      mobileMq.removeEventListener?.('change', syncMobile)
    }
  }, [])

  const clearLeaveTimer = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  const handleLeftPeekEnter = () => {
    if (!canHover || isMobile) return
    clearLeaveTimer()
    setLeftPeek(true)
  }

  const handleLeftPeekLeave = () => {
    if (!canHover || leftPinned || isMobile) return
    clearLeaveTimer()
    leaveTimer.current = setTimeout(() => setLeftPeek(false), 160)
  }

  const closeLeftFlyout = () => {
    clearLeaveTimer()
    setLeftPinned(false)
    setLeftPeek(false)
  }

  const closeRightPanel = () => {
    setRightUserClosed(true)
    setRightUserOpened(false)
  }

  const openRightPanel = (tab = 'sources') => {
    setPanelTab(tab)
    setRightUserOpened(true)
    setRightUserClosed(false)
    if (isMobile) closeLeftFlyout()
  }

  const toggleLeftFlyout = () => {
    if (leftVisible) {
      closeLeftFlyout()
    } else {
      if (isMobile) closeRightPanel()
      setLeftPinned(true)
      setLeftPeek(false)
    }
  }

  const toggleRightPanel = () => {
    if (rightOpen) closeRightPanel()
    else openRightPanel(panelTab)
  }

  const refreshUsage = async () => {
    try {
      const data = await getUsage()
      setUsage(data)
    } catch {
      /* ignore */
    }
  }

  const refreshChats = async (q = searchQuery, since = dateFilter) => {
    try {
      setChatsLoading(true)
      const data = await listChats({ q, since })
      setChats(data)
    } catch (e) {
      setError('Could not reach the backend. Is the FastAPI server running on :8000?')
    } finally {
      setChatsLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return
    refreshChats('', 'all')
    refreshUsage()
  }, [user])

  useEffect(() => {
    const root = document.documentElement
    if (darkMode) root.classList.add('dark')
    else root.classList.remove('dark')
    try {
      localStorage.setItem('gita-dark', darkMode ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [darkMode])

  useEffect(() => {
    if (!user) return undefined
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      refreshChats(searchQuery, dateFilter)
    }, 250)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, dateFilter, user])

  useEffect(() => {
    saveBookmarks(bookmarks)
  }, [bookmarks])

  useEffect(() => {
    return () => clearLeaveTimer()
  }, [])

  const handleNewChat = () => {
    if (abortRef.current) abortRef.current.abort()
    setActiveChatId(newId())
    setMessages([])
    setSources([])
    setHighlightedSourceKey(null)
    setDraft('')
    setChatTitle('New Chat')
    setError(null)
    setRetryText(null)
    setRightUserOpened(false)
    setRightUserClosed(false)
    if (!canHover) closeLeftFlyout()
  }

  const handleSelectChat = async (chatId) => {
    if (abortRef.current) abortRef.current.abort()
    setActiveChatId(chatId)
    setSources([])
    setHighlightedSourceKey(null)
    setDraft('')
    setRetryText(null)
    setPanelTab('sources')
    if (!canHover) closeLeftFlyout()
    try {
      const detail = await getChat(chatId)
      setMessages(detail.messages)
      setChatTitle(detail.title || 'Chat')
      const lastAssistant = [...detail.messages]
        .reverse()
        .find((m) => m.role === 'assistant')
      if (lastAssistant) setSources(lastAssistant.sources || [])
    } catch (e) {
      setError('Failed to load chat history.')
    }
  }

  const upsertChatInSidebar = (sessionId, title, bookmarked = false) => {
    setChatTitle(title)
    setChats((prev) => {
      const existing = prev.find((chat) => chat.id === sessionId)
      const savedChat = {
        id: sessionId,
        title,
        created_at: existing?.created_at || new Date().toISOString(),
        bookmarked: existing?.bookmarked ?? bookmarked,
      }
      const next = prev.some((chat) => chat.id === sessionId)
        ? prev.map((chat) =>
            chat.id === sessionId ? { ...chat, title } : chat
          )
        : [savedChat, ...prev]
      return [...next].sort((a, b) => {
        if (Boolean(a.bookmarked) !== Boolean(b.bookmarked)) {
          return a.bookmarked ? -1 : 1
        }
        return new Date(b.created_at) - new Date(a.created_at)
      })
    })
  }

  const handleSend = async (text) => {
    const chatId = activeChatId || newId()
    if (!activeChatId) setActiveChatId(chatId)
    if (rateLimited) return

    lastUserText.current = text
    setDraft('')
    setRetryText(null)

    const optimisticUser = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      sources: [],
      created_at: new Date().toISOString(),
    }
    const assistantId = `${Date.now()}-ai`
    const optimisticAssistant = {
      id: assistantId,
      role: 'assistant',
      content: '',
      sources: [],
      created_at: new Date().toISOString(),
      streaming: true,
    }

    setMessages((prev) => [...prev, optimisticUser, optimisticAssistant])
    setSending(true)
    setError(null)
    setHighlightedSourceKey(null)
    setPanelTab('sources')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamMessage(
        chatId,
        text,
        attachMemory,
        responseMode,
        {
          onMeta: (data) => {
            if (data.sources) setSources(data.sources)
          },
          onToken: (data) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + (data.content || '') }
                  : m
              )
            )
          },
          onDone: (data) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m
                const streamed = m.content || ''
                const final = (data.answer || '').trim()
                const content = final || streamed
                return {
                  ...m,
                  id: data.assistant_message_id || m.id,
                  content,
                  streaming: false,
                }
              })
            )
            upsertChatInSidebar(data.session_id, data.title)
            refreshUsage()
          },
        },
        { signal: controller.signal, temperature, language }
      )
    } catch (e) {
      if (e.code === 'aborted') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        )
      } else {
        setMessages((prev) =>
          prev
            .filter((m) => !(m.id === assistantId && !m.content.trim()))
            .map((m) =>
              m.id === assistantId ? { ...m, streaming: false } : m
            )
        )
        let msg =
          'The guide could not respond. Check that the backend and your OPENAI_API_KEY are set up.'
        if (e.code === 'offline') msg = e.message
        else if (e.code === 'rate_limit' || e.status === 429) {
          msg = e.message
          refreshUsage()
        } else if (e.message) msg = e.message
        setError(msg)
        setRetryText(text)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleRetry = () => {
    const text = retryText || lastUserText.current
    if (text) handleSend(text)
  }

  const handleDeleteChat = async (chatId) => {
    if (!window.confirm('Delete this chat permanently?')) return

    try {
      await deleteChat(chatId)
      setChats((prev) => prev.filter((chat) => chat.id !== chatId))
      if (activeChatId === chatId) {
        handleNewChat()
      }
      setError(null)
    } catch (e) {
      setError('Failed to delete the chat.')
    }
  }

  const handleToggleChatBookmark = async (chatId) => {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return
    const next = !chat.bookmarked
    setChats((prev) => {
      const updated = prev.map((c) =>
        c.id === chatId ? { ...c, bookmarked: next } : c
      )
      return [...updated].sort((a, b) => {
        if (Boolean(a.bookmarked) !== Boolean(b.bookmarked)) {
          return a.bookmarked ? -1 : 1
        }
        return new Date(b.created_at) - new Date(a.created_at)
      })
    })
    try {
      await setChatBookmark(chatId, next)
    } catch {
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId ? { ...c, bookmarked: chat.bookmarked } : c
        )
      )
      setError('Could not update chat bookmark.')
    }
  }

  const handleClearAllChats = async () => {
    if (!window.confirm('Delete all conversations permanently?')) return
    try {
      await deleteAllChats()
      setChats([])
      handleNewChat()
      setError(null)
    } catch {
      setError('Failed to clear conversations.')
    }
  }

  const handleToggleBookmark = (verse) => {
    const key = verseKey(verse)
    setBookmarks((prev) => {
      if (prev.some((b) => verseKey(b) === key)) {
        return prev.filter((b) => verseKey(b) !== key)
      }
      return [snapshotVerse(verse), ...prev]
    })
  }

  const handleRemoveBookmark = (verse) => {
    const key = verseKey(verse)
    setBookmarks((prev) => prev.filter((b) => verseKey(b) !== key))
  }

  const handleClearBookmarks = () => {
    if (!window.confirm('Clear all saved verses?')) return
    setBookmarks([])
  }

  const handleSelectBookmark = (verse) => {
    setFocusVerse(verse)
    openRightPanel('explore')
    setSources((prev) => {
      const key = verseKey(verse)
      if (prev.some((s) => verseKey(s) === key)) return prev
      return [verse, ...prev]
    })
    setHighlightedSourceKey(verseKey(verse))
  }

  const handleCitationClick = (chapter, verse) => {
    const key = `${chapter}-${verse}`
    openRightPanel('sources')
    setHighlightedSourceKey(key)
    setFocusVerse({ chapter, verse })

    const alreadyShown = sources.some(
      (s) =>
        verseKey(s) === key ||
        (s.neighbors || []).some((n) => verseKey(n) === key)
    )
    if (alreadyShown) return

    getVerse(chapter, verse)
      .then((v) => {
        setSources((prev) => {
          if (
            prev.some(
              (s) =>
                verseKey(s) === key ||
                (s.neighbors || []).some((n) => verseKey(n) === key)
            )
          ) {
            return prev
          }
          return [v, ...prev]
        })
      })
      .catch(() => {
        setPanelTab('explore')
      })
  }

  const handleAskAboutVerse = (verse) => {
    const id = newId()
    setActiveChatId(id)
    setMessages([])
    setSources([verse])
    setHighlightedSourceKey(`${verse.chapter}-${verse.verse}`)
    setPanelTab('sources')
    // On mobile keep the chat composer visible with the prefilled draft
    if (isMobile) closeRightPanel()
    else openRightPanel('sources')
    setChatTitle('New Chat')
    setDraft(
      `Please explain the meaning and practical guidance of Bhagavad Gita Chapter ${verse.chapter}, Verse ${verse.verse} for my life today.`
    )
    setError(null)
  }

  const handleFeedback = async (messageId, rating) => {
    if (String(messageId).startsWith('tmp-') || String(messageId).endsWith('-ai')) {
      setError('Feedback is available after the reply finishes saving.')
      return
    }
    const next =
      messages.find((m) => m.id === messageId)?.feedback === rating
        ? null
        : rating
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, feedback: next } : m))
    )
    try {
      await sendFeedback(messageId, next)
    } catch {
      setError('Could not save feedback.')
    }
  }

  const handleExport = () => {
    exportMarkdown(messages, sources, chatTitle)
  }

  if (!authReady) {
    return (
      <div
        className="app-shell flex items-center justify-center"
        style={{ backgroundColor: 'var(--app-bg)', color: 'var(--text-muted)' }}
      >
        Loading…
      </div>
    )
  }

  if (!user) {
    return (
      <AuthScreen
        view={authView}
        setView={(next) => {
          setAuthError(null)
          setAuthInfo(null)
          setAuthView(next)
        }}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onForgot={handleForgot}
        onReset={handleReset}
        resetToken={resetToken}
        busy={authBusy}
        error={authError}
        info={authInfo}
      />
    )
  }

  return (
    <div
      className="app-shell flex overflow-hidden relative"
      style={{ backgroundColor: 'var(--app-bg)', color: 'var(--text-primary)' }}
    >
      {/* Left edge discoverability cue + hover trigger (desktop only) */}
      {!leftVisible && !isMobile && (
        <div
          className="left-edge-cue"
          onMouseEnter={handleLeftPeekEnter}
          onMouseLeave={handleLeftPeekLeave}
          aria-hidden="true"
        >
          <svg
            className="left-edge-chevron w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      )}

      <div
        className="flyout-scrim"
        data-open={leftVisible && (leftPinned || isMobile) ? 'true' : 'false'}
        onClick={closeLeftFlyout}
        aria-hidden="true"
      />

      <div
        className="flyout-shell"
        data-open={leftVisible ? 'true' : 'false'}
        onMouseEnter={handleLeftPeekEnter}
        onMouseLeave={handleLeftPeekLeave}
      >
        <Sidebar
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
          onToggleChatBookmark={handleToggleChatBookmark}
          loading={chatsLoading}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          dateFilter={dateFilter}
          setDateFilter={setDateFilter}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          usage={usage}
          bookmarks={bookmarks}
          onSelectBookmark={handleSelectBookmark}
          onRemoveBookmark={handleRemoveBookmark}
          temperature={temperature}
          setTemperature={setTemperature}
          onClearAllChats={handleClearAllChats}
          onClearBookmarks={handleClearBookmarks}
          open={leftVisible}
          onClose={closeLeftFlyout}
          user={user}
          onLogout={() => handleLogout()}
          onUserUpdate={handleUserUpdate}
        />
      </div>

      <ChatWindow
        messages={messages}
        onSend={handleSend}
        sending={sending}
        onStop={handleStop}
        attachMemory={attachMemory}
        setAttachMemory={setAttachMemory}
        responseMode={responseMode}
        setResponseMode={setResponseMode}
        language={language}
        setLanguage={setLanguage}
        onCitationClick={handleCitationClick}
        onExport={handleExport}
        onFeedback={handleFeedback}
        draft={draft}
        setDraft={setDraft}
        rateLimited={rateLimited}
        leftOpen={leftVisible}
        rightOpen={rightOpen}
        onToggleLeft={toggleLeftFlyout}
        onToggleRight={toggleRightPanel}
      />

      <div
        className="sources-scrim"
        data-open={isMobile && rightOpen ? 'true' : 'false'}
        onClick={closeRightPanel}
        aria-hidden="true"
      />

      <SourcePanel
        sources={sources}
        highlightedSourceKey={highlightedSourceKey}
        onAskAboutVerse={handleAskAboutVerse}
        activeTab={panelTab}
        setActiveTab={setPanelTab}
        bookmarks={bookmarks}
        onToggleBookmark={handleToggleBookmark}
        focusVerse={focusVerse}
        open={rightOpen}
        onClose={closeRightPanel}
      />

      {idleWarning && (
        <div
          className="fixed left-1/2 -translate-x-1/2 text-sm px-4 py-2.5 rounded-2xl z-50"
          style={{
            top: 'max(1rem, env(safe-area-inset-top))',
            backgroundColor: 'var(--panel-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          Still there? You will be signed out in 1 minute due to inactivity.
        </div>
      )}

      {error && (
        <div
          className="fixed left-1/2 -translate-x-1/2 text-sm px-4 py-2.5 rounded-2xl flex items-center gap-3 max-w-[min(90vw,28rem)] z-50"
          style={{
            bottom: 'max(1rem, env(safe-area-inset-bottom))',
            backgroundColor: 'var(--panel-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          <span>{error}</span>
          {retryText && (
            <button
              type="button"
              onClick={handleRetry}
              className="underline rounded"
              style={{ color: 'var(--accent)' }}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setError(null)
              setRetryText(null)
            }}
            className="rounded"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
