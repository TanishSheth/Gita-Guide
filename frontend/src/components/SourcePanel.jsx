import { useEffect, useRef, useState } from 'react'
import {
  ScrollText,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Bookmark,
  BookmarkCheck,
  PanelRightClose,
  Volume2,
  Square,
} from 'lucide-react'
import { listVerses } from '../api.js'
import { verseKey } from '../bookmarks.js'

function pickSpeechVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices() || []
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith('sa')) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith('hi')) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith('en-in')) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith('en')) ||
    null
  )
}

function VerseSpeakButton({ verse }) {
  const [playing, setPlaying] = useState(false)
  const supported =
    typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'

  useEffect(() => {
    if (!supported) return undefined
    // Chrome loads voices asynchronously
    const warm = () => pickSpeechVoice()
    warm()
    window.speechSynthesis.addEventListener?.('voiceschanged', warm)
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', warm)
      window.speechSynthesis.cancel()
    }
  }, [supported])

  if (!supported) return null
  const text = (verse.transliteration || verse.sanskrit || '').trim()
  if (!text) return null

  const stop = () => {
    window.speechSynthesis.cancel()
    setPlaying(false)
  }

  const play = () => {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    const voice = pickSpeechVoice()
    if (voice) utter.voice = voice
    utter.rate = 0.85
    utter.pitch = 1
    utter.onend = () => setPlaying(false)
    utter.onerror = () => setPlaying(false)
    setPlaying(true)
    window.speechSynthesis.speak(utter)
  }

  return (
    <button
      type="button"
      onClick={() => (playing ? stop() : play())}
      className="p-1 rounded-lg shrink-0"
      style={{ color: playing ? 'var(--accent)' : 'var(--text-muted)' }}
      aria-label={playing ? 'Stop chant' : 'Play Sanskrit aloud'}
      title={playing ? 'Stop' : 'Play shloka (TTS)'}
    >
      {playing ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
    </button>
  )
}

function parseTranslations(english) {
  if (!english) return []
  const chunks = String(english)
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean)
  return chunks.map((chunk) => {
    const m = chunk.match(/^([^:\n]{1,80}):\s*([\s\S]+)$/)
    if (m) return { label: m[1].trim(), text: m[2].trim() }
    return { label: 'Translation', text: chunk }
  })
}

function TranslationsList({ translations, english }) {
  const [open, setOpen] = useState(false)
  const blocks =
    translations?.length > 0 ? translations : parseTranslations(english)
  if (blocks.length <= 1) {
    return (
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: 'var(--text-primary)' }}
      >
        {blocks[0]?.text || english}
      </p>
    )
  }
  const primary = blocks[0]
  return (
    <div>
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: 'var(--text-primary)' }}
      >
        <span
          className="text-[11px] font-medium block mb-0.5"
          style={{ color: 'var(--accent)' }}
        >
          {primary.label}
        </span>
        {primary.text}
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-xs rounded"
        style={{ color: 'var(--text-muted)' }}
        aria-expanded={open}
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {open ? 'Hide' : 'Show'} {blocks.length - 1} more translation
        {blocks.length - 1 === 1 ? '' : 's'}
      </button>
      {open && (
        <div
          className="mt-2 space-y-3 pt-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {blocks.slice(1).map((b, i) => (
            <div key={`${b.label}-${i}`}>
              <p
                className="text-[11px] font-medium mb-0.5"
                style={{ color: 'var(--accent)' }}
              >
                {b.label}
              </p>
              <p
                className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: 'var(--text-primary)' }}
              >
                {b.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VerseCard({
  v,
  highlighted,
  cardRef,
  bookmarked,
  onToggleBookmark,
  showBookmark = true,
}) {
  return (
    <div
      ref={cardRef}
      className="rounded-xl border p-4 transition-colors"
      style={{
        backgroundColor: 'var(--panel-elevated)',
        borderColor: highlighted ? 'var(--accent)' : 'var(--border)',
        boxShadow: highlighted ? '0 0 0 1px var(--accent)' : undefined,
        color: 'var(--text-primary)',
      }}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            color: 'var(--accent)',
            backgroundColor: 'var(--accent-soft)',
          }}
        >
          Ch. {v.chapter} · Verse {v.verse}
        </span>
        <div className="flex items-center gap-1.5">
          {typeof v.similarity === 'number' && (
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {(v.similarity * 100).toFixed(0)}% match
            </span>
          )}
          {showBookmark && onToggleBookmark && (
            <button
              type="button"
              onClick={() => onToggleBookmark(v)}
              className="p-1 rounded-lg"
              style={{ color: bookmarked ? 'var(--accent)' : 'var(--text-muted)' }}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark verse'}
              title={bookmarked ? 'Remove bookmark' : 'Save verse'}
            >
              {bookmarked ? (
                <BookmarkCheck className="w-4 h-4" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>
      {v.sanskrit && (
        <div className="flex items-start gap-2 mb-1.5">
          <p className="font-serif text-base leading-snug flex-1 min-w-0">
            {v.sanskrit}
          </p>
          <VerseSpeakButton verse={v} />
        </div>
      )}
      {!v.sanskrit && (v.transliteration || '').trim() && (
        <div className="flex justify-end mb-1">
          <VerseSpeakButton verse={v} />
        </div>
      )}
      {v.transliteration && (
        <p
          className="italic text-xs mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          {v.transliteration}
        </p>
      )}
      <TranslationsList
        translations={v.translations}
        english={v.english_translation}
      />
    </div>
  )
}

function SourcesTab({
  sources,
  highlightedSourceKey,
  cardRefs,
  bookmarkedKeys,
  onToggleBookmark,
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {sources.length === 0 && (
        <p className="text-sm px-1" style={{ color: 'var(--text-muted)' }}>
          Retrieved verses for the latest response will appear here.
        </p>
      )}
      {sources.map((v, idx) => {
        const key = `${v.chapter}-${v.verse}`
        return (
          <div key={`${key}-${idx}`}>
            <VerseCard
              v={v}
              highlighted={highlightedSourceKey === key}
              bookmarked={bookmarkedKeys.has(key)}
              onToggleBookmark={onToggleBookmark}
              cardRef={(el) => {
                if (el) cardRefs.current[key] = el
              }}
            />
            {(v.neighbors || []).length > 0 && (
              <div
                className="mt-2 ml-2 pl-3 space-y-2"
                style={{ borderLeft: '2px solid var(--border)' }}
              >
                <p
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Neighboring verses
                </p>
                {v.neighbors.map((n) => {
                  const nKey = `${n.chapter}-${n.verse}`
                  return (
                    <VerseCard
                      key={`n-${nKey}`}
                      v={n}
                      highlighted={highlightedSourceKey === nKey}
                      bookmarked={bookmarkedKeys.has(nKey)}
                      onToggleBookmark={onToggleBookmark}
                      cardRef={(el) => {
                        if (el) cardRefs.current[nKey] = el
                      }}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ExploreTab({
  onAskAboutVerse,
  bookmarkedKeys,
  onToggleBookmark,
  focusVerse,
}) {
  const [chapter, setChapter] = useState(focusVerse?.chapter || 1)
  const [verses, setVerses] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (focusVerse?.chapter) setChapter(focusVerse.chapter)
  }, [focusVerse])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      setSelected(null)
      try {
        const data = await listVerses(chapter)
        if (!cancelled) {
          setVerses(data)
          if (focusVerse && focusVerse.chapter === chapter) {
            const match = data.find((v) => v.verse === focusVerse.verse)
            setSelected(match || focusVerse)
          }
        }
      } catch (e) {
        if (!cancelled) {
          setVerses([])
          setError('Could not load verses. Is the dataset ingested?')
          if (focusVerse && focusVerse.chapter === chapter) {
            setSelected(focusVerse)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [chapter, focusVerse])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <label
          className="block text-xs mb-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Chapter
        </label>
        <select
          value={chapter}
          onChange={(e) => setChapter(Number(e.target.value))}
          className="w-full rounded-xl text-sm px-3 py-2 focus:outline-none"
          style={{
            backgroundColor: 'var(--input-bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
          aria-label="Select chapter"
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              Chapter {n}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <p className="text-sm px-1" style={{ color: 'var(--text-muted)' }}>
            Loading verses…
          </p>
        )}
        {error && <p className="text-sm text-red-500 px-1">{error}</p>}
        {!loading &&
          !error &&
          verses.map((v) => {
            const active =
              selected &&
              selected.chapter === v.chapter &&
              selected.verse === v.verse
            return (
              <button
                key={`${v.chapter}-${v.verse}`}
                type="button"
                onClick={() => setSelected(v)}
                className="w-full text-left rounded-xl border px-3 py-2 text-sm transition-colors"
                style={{
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: active
                    ? 'var(--accent-soft)'
                    : 'var(--panel-elevated)',
                  color: 'var(--text-primary)',
                }}
              >
                <span className="font-medium">Verse {v.verse}</span>
                <span
                  className="block text-xs truncate mt-0.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {v.transliteration || v.english_translation?.slice(0, 80)}
                </span>
              </button>
            )
          })}
      </div>

      {selected && (
        <div
          className="flex flex-col min-h-0 shrink-0"
          style={{
            borderTop: '1px solid var(--border)',
            backgroundColor: 'var(--panel-bg)',
            maxHeight: '55%',
          }}
        >
          <div className="flex-1 overflow-y-auto min-h-0 p-4 pb-2">
            <VerseCard
              v={selected}
              highlighted={false}
              bookmarked={bookmarkedKeys.has(verseKey(selected))}
              onToggleBookmark={onToggleBookmark}
            />
          </div>
          <div className="shrink-0 px-4 pb-4 pt-2">
            <button
              type="button"
              onClick={() => onAskAboutVerse?.(selected)}
              className="w-full rounded-xl text-sm font-medium py-2.5 transition-colors"
              style={{
                backgroundColor: 'var(--accent)',
                color: '#1a1a1a',
              }}
            >
              Ask about this verse
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SourcePanel({
  sources,
  highlightedSourceKey,
  onAskAboutVerse,
  activeTab,
  setActiveTab,
  bookmarks,
  onToggleBookmark,
  focusVerse,
  open = true,
  onClose,
}) {
  const cardRefs = useRef({})
  const bookmarkedKeys = new Set(bookmarks.map(verseKey))

  useEffect(() => {
    if (!highlightedSourceKey || !open) return
    const el = cardRefs.current[highlightedSourceKey]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [highlightedSourceKey, sources, open])

  return (
    <aside
      className="sources-panel"
      data-open={open ? 'true' : 'false'}
      aria-hidden={!open}
      style={{
        backgroundColor: 'var(--panel-bg)',
        borderLeft: '1px solid var(--border)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="sources-panel-inner">
        <div
          className="px-3 pt-3 pb-0 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-1" role="tablist" aria-label="Right panel">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sources'}
              onClick={() => setActiveTab('sources')}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-t-lg transition-colors font-medium"
              style={{
                backgroundColor:
                  activeTab === 'sources' ? 'var(--panel-elevated)' : 'transparent',
                color:
                  activeTab === 'sources'
                    ? 'var(--text-primary)'
                    : 'var(--text-muted)',
              }}
            >
              <ScrollText className="w-4 h-4" />
              Sources
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'explore'}
              onClick={() => setActiveTab('explore')}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-t-lg transition-colors font-medium"
              style={{
                backgroundColor:
                  activeTab === 'explore' ? 'var(--panel-elevated)' : 'transparent',
                color:
                  activeTab === 'explore'
                    ? 'var(--text-primary)'
                    : 'var(--text-muted)',
              }}
            >
              <BookOpen className="w-4 h-4" />
              Explore
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg shrink-0 mb-0.5"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Hide sources panel"
                title="Hide sources"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          {activeTab === 'sources' ? (
            <SourcesTab
              sources={sources}
              highlightedSourceKey={highlightedSourceKey}
              cardRefs={cardRefs}
              bookmarkedKeys={bookmarkedKeys}
              onToggleBookmark={onToggleBookmark}
            />
          ) : (
            <ExploreTab
              onAskAboutVerse={onAskAboutVerse}
              bookmarkedKeys={bookmarkedKeys}
              onToggleBookmark={onToggleBookmark}
              focusVerse={focusVerse}
            />
          )}
        </div>
      </div>
    </aside>
  )
}
