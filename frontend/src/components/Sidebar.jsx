import { useEffect, useRef, useState } from 'react'
import {
  Plus,
  MessageCircle,
  Sprout,
  Trash2,
  Search,
  Moon,
  Sun,
  Bookmark,
  BookmarkCheck,
  Settings,
  BookMarked,
  PanelLeftClose,
  MoreVertical,
  LogOut,
} from 'lucide-react'

import SettingsModal, { companyLabel } from './SettingsModal.jsx'

const DATE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
]

export default function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onToggleChatBookmark,
  loading,
  searchQuery,
  setSearchQuery,
  dateFilter,
  setDateFilter,
  darkMode,
  setDarkMode,
  usage,
  bookmarks,
  onSelectBookmark,
  onRemoveBookmark,
  temperature,
  setTemperature,
  onClearAllChats,
  onClearBookmarks,
  open = true,
  onClose,
  user,
  onLogout,
  onUserUpdate,
}) {
  const [listMode, setListMode] = useState('chats')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuChatId, setMenuChatId] = useState(null)
  const menuRef = useRef(null)
  const hasFilters = Boolean(searchQuery?.trim()) || dateFilter !== 'all'
  const used = usage?.requests_last_hour ?? 0
  const limit = usage?.limit ?? 30
  const remaining = usage?.remaining ?? Math.max(0, limit - used)
  const tokensToday = usage?.tokens_today ?? 0

  useEffect(() => {
    if (!menuChatId) return
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuChatId(null)
      }
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMenuChatId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuChatId])

  return (
    <aside
      className="w-72 h-full flex flex-col"
      aria-hidden={!open}
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        color: 'var(--sidebar-text)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
      <div
        className="p-5"
        style={{ borderBottom: '1px solid var(--sidebar-border)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Sprout className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
          <h1
            className="font-serif text-xl tracking-wide flex-1 min-w-0"
            style={{ color: 'var(--sidebar-text)' }}
          >
            Gita Guide
          </h1>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg shrink-0"
              style={{ color: 'var(--sidebar-muted)' }}
              aria-label="Hide chat history"
              title="Hide sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 font-medium rounded-xl py-2.5 transition-colors"
          style={{
            backgroundColor: 'var(--new-chat-bg)',
            color: 'var(--new-chat-text)',
            border: '1px solid var(--new-chat-border)',
          }}
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="px-3 pt-4 space-y-2">
        <div
          className="flex gap-1 p-0.5 rounded-xl"
          style={{ backgroundColor: 'var(--sidebar-input-bg)' }}
          role="tablist"
          aria-label="Sidebar list"
        >
          <button
            type="button"
            role="tab"
            aria-selected={listMode === 'chats'}
            onClick={() => setListMode('chats')}
            className="flex-1 text-[11px] py-1.5 rounded-lg transition-colors font-medium"
            style={{
              backgroundColor:
                listMode === 'chats' ? 'var(--sidebar-active)' : 'transparent',
              color:
                listMode === 'chats'
                  ? 'var(--sidebar-text)'
                  : 'var(--sidebar-muted)',
            }}
          >
            Chats
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={listMode === 'saved'}
            onClick={() => setListMode('saved')}
            className="flex-1 text-[11px] py-1.5 rounded-lg transition-colors font-medium inline-flex items-center justify-center gap-1"
            style={{
              backgroundColor:
                listMode === 'saved' ? 'var(--sidebar-active)' : 'transparent',
              color:
                listMode === 'saved'
                  ? 'var(--sidebar-text)'
                  : 'var(--sidebar-muted)',
            }}
          >
            <BookMarked className="w-3 h-3" />
            Saved
          </button>
        </div>

        {listMode === 'chats' && (
          <>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--sidebar-muted)' }}
              />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats…"
                aria-label="Search chats"
                className="w-full rounded-xl text-sm pl-8 pr-3 py-2.5 focus:outline-none"
                style={{
                  backgroundColor: 'var(--sidebar-input-bg)',
                  border: '1px solid var(--sidebar-border)',
                  color: 'var(--sidebar-text)',
                }}
              />
            </div>
            <div className="flex gap-1" role="group" aria-label="Date filter">
              {DATE_FILTERS.map((f) => {
                const active = dateFilter === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDateFilter(f.id)}
                    className="flex-1 text-[11px] py-1.5 rounded-lg transition-colors"
                    style={{
                      backgroundColor: active
                        ? 'var(--sidebar-active)'
                        : 'transparent',
                      color: active
                        ? 'var(--sidebar-text)'
                        : 'var(--sidebar-muted)',
                    }}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {listMode === 'chats' ? (
          <>
            <p
              className="text-xs uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--sidebar-muted)' }}
            >
              Saved Chats
            </p>
            {loading && (
              <p
                className="text-sm px-2"
                style={{ color: 'var(--sidebar-muted)' }}
              >
                Loading chats…
              </p>
            )}
            {!loading && chats.length === 0 && (
              <p
                className="text-sm px-2"
                style={{ color: 'var(--sidebar-muted)' }}
              >
                {hasFilters
                  ? 'No chats match your search or filter.'
                  : 'No chats yet. Ask a question to begin.'}
              </p>
            )}
            <ul className="space-y-1">
              {chats.map((chat) => {
                const active = chat.id === activeChatId
                const menuOpen = menuChatId === chat.id
                return (
                  <li
                    key={chat.id}
                    className="group relative flex items-stretch rounded-xl transition-colors"
                    style={{
                      backgroundColor: active
                        ? 'var(--sidebar-active)'
                        : 'transparent',
                      color: active
                        ? 'var(--sidebar-text)'
                        : 'var(--sidebar-muted)',
                    }}
                    onMouseEnter={(e) => {
                      if (!active)
                        e.currentTarget.style.backgroundColor =
                          'var(--sidebar-hover)'
                    }}
                    onMouseLeave={(e) => {
                      if (!active && !menuOpen)
                        e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <button
                      onClick={() => {
                        setMenuChatId(null)
                        onSelectChat(chat.id)
                      }}
                      className="min-w-0 flex-1 text-left flex items-center gap-2 pl-3 pr-1 py-2.5 text-sm rounded-xl"
                      title={chat.title}
                    >
                      {chat.bookmarked ? (
                        <BookmarkCheck
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: 'var(--accent)' }}
                        />
                      ) : (
                        <MessageCircle className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      )}
                      <span className="chat-title-fade min-w-0 flex-1 pr-1">
                        {chat.title || 'New Chat'}
                      </span>
                    </button>

                    <div
                      className="relative shrink-0 flex items-center pr-1"
                      ref={menuOpen ? menuRef : undefined}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuChatId(menuOpen ? null : chat.id)
                        }}
                        className={`p-2 rounded-lg transition-opacity ${
                          menuOpen
                            ? 'opacity-100'
                            : 'opacity-70 group-hover:opacity-100 focus:opacity-100'
                        }`}
                        style={{
                          color: 'var(--sidebar-muted)',
                          backgroundColor: menuOpen
                            ? 'var(--sidebar-active)'
                            : 'transparent',
                        }}
                        title="Chat actions"
                        aria-label={`Actions for ${chat.title || 'chat'}`}
                        aria-expanded={menuOpen}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {menuOpen && (
                        <div
                          className="absolute right-0 top-full mt-1 z-20 flex flex-col gap-0.5 rounded-xl p-1 shadow-lg min-w-[9.5rem]"
                          style={{
                            backgroundColor: 'var(--panel-elevated)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                          }}
                          role="menu"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleChatBookmark?.(chat.id)
                              setMenuChatId(null)
                            }}
                            className="flex items-center gap-2 text-left text-sm px-2.5 py-2 rounded-lg"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor =
                                'var(--sidebar-hover)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                            }}
                          >
                            {chat.bookmarked ? (
                              <BookmarkCheck
                                className="w-3.5 h-3.5"
                                style={{ color: 'var(--accent)' }}
                              />
                            ) : (
                              <Bookmark className="w-3.5 h-3.5" />
                            )}
                            {chat.bookmarked ? 'Remove bookmark' : 'Bookmark'}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuChatId(null)
                              onDeleteChat(chat.id)
                            }}
                            className="flex items-center gap-2 text-left text-sm px-2.5 py-2 rounded-lg"
                            style={{ color: '#c45c4a' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor =
                                'var(--sidebar-hover)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent'
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <>
            <p
              className="text-xs uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--sidebar-muted)' }}
            >
              Saved Chats
            </p>
            {chats.filter((c) => c.bookmarked).length === 0 && (
              <p
                className="text-sm px-2 mb-4"
                style={{ color: 'var(--sidebar-muted)' }}
              >
                Use ⋮ on a chat to bookmark it here.
              </p>
            )}
            <ul className="space-y-1 mb-5">
              {chats
                .filter((c) => c.bookmarked)
                .map((chat) => {
                  const active = chat.id === activeChatId
                  return (
                    <li
                      key={chat.id}
                      className="group flex items-center rounded-xl"
                      style={{
                        backgroundColor: active
                          ? 'var(--sidebar-active)'
                          : 'transparent',
                        color: active
                          ? 'var(--sidebar-text)'
                          : 'var(--sidebar-muted)',
                      }}
                      onMouseEnter={(e) => {
                        if (!active)
                          e.currentTarget.style.backgroundColor =
                            'var(--sidebar-hover)'
                      }}
                      onMouseLeave={(e) => {
                        if (!active)
                          e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectChat(chat.id)}
                        className="min-w-0 flex-1 text-left flex items-center gap-2 pl-3 pr-1 py-2.5 text-sm rounded-xl"
                        title={chat.title}
                      >
                        <BookmarkCheck
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: 'var(--accent)' }}
                        />
                        <span className="chat-title-fade min-w-0 flex-1 pr-1">
                          {chat.title || 'New Chat'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleChatBookmark?.(chat.id)}
                        className="shrink-0 p-2 mr-1 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                        style={{ color: 'var(--sidebar-muted)' }}
                        title="Remove chat bookmark"
                        aria-label={`Remove bookmark for ${chat.title || 'chat'}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  )
                })}
            </ul>

            <p
              className="text-xs uppercase tracking-wider px-2 mb-2"
              style={{ color: 'var(--sidebar-muted)' }}
            >
              Saved Verses
            </p>
            {bookmarks.length === 0 && (
              <p
                className="text-sm px-2"
                style={{ color: 'var(--sidebar-muted)' }}
              >
                Bookmark verses from Sources or Explore to save them here.
              </p>
            )}
            <ul className="space-y-1">
              {bookmarks.map((v) => (
                <li
                  key={`${v.chapter}-${v.verse}`}
                  className="group flex items-center rounded-xl"
                  style={{ color: 'var(--sidebar-muted)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'var(--sidebar-hover)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectBookmark?.(v)}
                    className="min-w-0 flex-1 text-left flex items-center gap-2 pl-3 pr-1 py-2.5 text-sm rounded-xl"
                    title={`Chapter ${v.chapter}, Verse ${v.verse}`}
                  >
                    <Bookmark className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    <span className="chat-title-fade min-w-0 flex-1 pr-1">
                      Ch. {v.chapter} · V. {v.verse}
                      {v.transliteration ? ` — ${v.transliteration}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveBookmark?.(v)}
                    className="shrink-0 p-2 mr-1 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                    style={{ color: 'var(--sidebar-muted)' }}
                    title="Remove bookmark"
                    aria-label={`Remove chapter ${v.chapter} verse ${v.verse}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div
        className="p-4 space-y-3"
        style={{ borderTop: '1px solid var(--sidebar-border)' }}
      >
        <div
          className="text-[11px] space-y-1"
          style={{ color: 'var(--sidebar-muted)' }}
        >
          <div className="flex justify-between">
            <span>Usage (last hour)</span>
            <span
              style={{
                color: remaining === 0 ? 'var(--accent)' : undefined,
              }}
            >
              {used}/{limit}
            </span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: 'var(--sidebar-meter-track)' }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.min(100, (used / limit) * 100)}%`,
                backgroundColor: 'var(--accent)',
              }}
            />
          </div>
          <p>~{tokensToday} tokens today (est.)</p>
        </div>
        {user && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {user.name || user.email}
              </p>
              {user.name ? (
                <p
                  className="text-[11px] truncate"
                  style={{ color: 'var(--sidebar-muted)' }}
                >
                  {user.email}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="shrink-0 p-2 rounded-xl"
              style={{
                color: 'var(--sidebar-muted)',
                border: '1px solid var(--sidebar-border)',
              }}
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            className="flex-1 flex items-center justify-center gap-2 text-xs rounded-xl py-2 transition-colors"
            style={{
              color: 'var(--sidebar-muted)',
              border: '1px solid var(--sidebar-border)',
            }}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? (
              <Sun className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
            {darkMode ? 'Light' : 'Dark'}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center justify-center gap-1.5 text-xs rounded-xl px-3 py-2 transition-colors"
            style={{
              color: 'var(--sidebar-muted)',
              border: '1px solid var(--sidebar-border)',
            }}
            aria-label="Open settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--sidebar-muted)' }}>
          {companyLabel(user?.llm_provider, user?.llm_model)}
        </p>
        <p className="text-xs" style={{ color: 'var(--sidebar-muted)' }}>
          Wisdom from the Bhagavad Gita, retrieved &amp; contextualized.
        </p>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        temperature={temperature}
        setTemperature={setTemperature}
        bookmarkCount={bookmarks.length}
        user={user}
        onUserUpdate={onUserUpdate}
        onClearChats={() => {
          onClearAllChats?.()
          setSettingsOpen(false)
        }}
        onClearBookmarks={() => {
          onClearBookmarks?.()
          setSettingsOpen(false)
        }}
      />
    </aside>
  )
}
