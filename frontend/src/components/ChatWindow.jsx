import { useEffect, useRef, useState } from 'react'
import {
  Send,
  BrainCircuit,
  Loader2,
  Square,
  Download,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Check,
  Menu,
  ScrollText,
  Languages,
} from 'lucide-react'

const STARTER_PROMPTS = [
  'What does the Gita say about finding purpose?',
  'How do I deal with anxiety at work?',
  'How can I practice detachment without becoming indifferent?',
  'What is karma yoga in daily life?',
]

const RESPONSE_LANGUAGES = [
  { id: 'en', label: 'EN', title: 'English' },
  { id: 'hi', label: 'HI', title: 'Hindi' },
  { id: 'gu', label: 'GU', title: 'Gujarati' },
  { id: 'es', label: 'ES', title: 'Spanish' },
]

const CITE_RE =
  /(?:\[|\()?\b(?:Chapter|Ch\.?)\s+(\d+)(?:\s*[,:\-–]\s*Verses?\s+(\d+)|\.(\d+))(?:\s*[–-]\s*(\d+))?(?:\]|\))?/gi

function formatCitationLabel(chapter, verse, endVerse) {
  const base = `(Chapter ${chapter}.${verse})`
  if (endVerse && endVerse !== verse) {
    return `(Chapter ${chapter}.${verse}–${endVerse})`
  }
  return base
}

const HEADER_RE = /^(#{1,6})\s+(.+)$/
const ORDERED_ITEM_RE = /^\s*(\d+)[.)]\s+(.+)$/
const BULLET_ITEM_RE =
  /^\s*(?:[-*•●○▪‣⁃∙·]|–|—)\s*(.+)$/
const BOLD_LABEL_ITEM_RE = /^\s*\*\*[^*\n]+?\*\*:?\s*.+$/

const HEADING_CLASS = {
  1: 'assistant-heading assistant-heading-1',
  2: 'assistant-heading assistant-heading-2',
  3: 'assistant-heading assistant-heading-3',
  4: 'assistant-heading assistant-heading-4',
  5: 'assistant-heading assistant-heading-5',
  6: 'assistant-heading assistant-heading-6',
}

function normalizeMdText(text) {
  if (!text) return ''
  let s = text
    .replace(/\uFF0A/g, '*')
    .replace(/\uFE61/g, '*')
    .replace(/\u2217/g, '*')
    .replace(/\uFF3F/g, '_')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  s = s.replace(/\\([*_`[\]()#+\-.!|{}\\])/g, '$1')
  s = s.replace(
    /^[\t ]*[\u2022\u2023\u2043\u2219\u25AA\u25CF\u25E6\u00B7\u25CB\u2013\u2014-][\t ]+/gm,
    '* '
  )
  return s
}

function isBoldLabelItem(line) {
  if (!line?.trim()) return false
  if (BULLET_ITEM_RE.test(line) || ORDERED_ITEM_RE.test(line)) return false
  return BOLD_LABEL_ITEM_RE.test(line)
}

function citationAt(text, index) {
  const slice = text.slice(index)
  const re = new RegExp(CITE_RE.source, 'i')
  const match = re.exec(slice)
  if (match && match.index === 0) return match
  return null
}

function findItalicAsteriskClose(text, start) {
  for (let j = start + 1; j < text.length; j += 1) {
    if (text[j] !== '*') continue
    if (text[j + 1] === '*' || text[j - 1] === '*') continue
    if (j > start + 1) return j
  }
  return -1
}

function findItalicUnderscoreClose(text, start) {
  for (let j = start + 1; j < text.length; j += 1) {
    if (text[j] !== '_') continue
    if (text[j + 1] === '_' || text[j - 1] === '_') continue
    const after = j + 1 < text.length ? text[j + 1] : ' '
    if (/\w/.test(after)) continue
    if (j > start + 1) return j
  }
  return -1
}

function parseInlineContent(text, onCitationClick, keyPrefix = 'i') {
  const normalized = normalizeMdText(text)
  if (!normalized) return null

  const nodes = []
  let i = 0
  let key = 0
  const nextKey = () => `${keyPrefix}-${key++}`

  while (i < normalized.length) {
    const citeMatch = citationAt(normalized, i)
    if (citeMatch) {
      const chapter = Number(citeMatch[1])
      const verse = Number(citeMatch[2] || citeMatch[3])
      const endVerse = citeMatch[4] ? Number(citeMatch[4]) : null
      const label = formatCitationLabel(chapter, verse, endVerse)
      nodes.push(
        <button
          key={nextKey()}
          type="button"
          onClick={() => onCitationClick?.(chapter, verse)}
          className="inline font-medium underline underline-offset-2 decoration-2 rounded-sm hover:opacity-80"
          style={{ color: 'var(--accent)', textDecorationColor: 'var(--accent)' }}
          title={
            endVerse && endVerse !== verse
              ? `Open Chapter ${chapter}, Verses ${verse}–${endVerse}`
              : `Open Chapter ${chapter}, Verse ${verse}`
          }
        >
          {label}
        </button>
      )
      i += citeMatch[0].length
      continue
    }

    if (normalized.startsWith('**', i)) {
      const close = normalized.indexOf('**', i + 2)
      if (close > i + 2) {
        const inner = normalized.slice(i + 2, close)
        nodes.push(
          <strong key={nextKey()} className="assistant-bold">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-b`)}
          </strong>
        )
        i = close + 2
        continue
      }
    }

    if (normalized.startsWith('__', i)) {
      const close = normalized.indexOf('__', i + 2)
      if (close > i + 2) {
        const inner = normalized.slice(i + 2, close)
        nodes.push(
          <strong key={nextKey()} className="assistant-bold">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-b2`)}
          </strong>
        )
        i = close + 2
        continue
      }
    }

    if (normalized.startsWith('++', i)) {
      const close = normalized.indexOf('++', i + 2)
      if (close > i + 2) {
        const inner = normalized.slice(i + 2, close)
        nodes.push(
          <u key={nextKey()} className="assistant-underline">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-u`)}
          </u>
        )
        i = close + 2
        continue
      }
    }

    if (normalized.slice(i, i + 3).toLowerCase() === '<b>') {
      const closeTag = normalized.toLowerCase().indexOf('</b>', i + 3)
      if (closeTag > i + 3) {
        const inner = normalized.slice(i + 3, closeTag)
        nodes.push(
          <strong key={nextKey()} className="assistant-bold">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-hb`)}
          </strong>
        )
        i = closeTag + 4
        continue
      }
    }

    if (normalized.slice(i, i + 8).toLowerCase() === '<strong>') {
      const closeTag = normalized.toLowerCase().indexOf('</strong>', i + 8)
      if (closeTag > i + 8) {
        const inner = normalized.slice(i + 8, closeTag)
        nodes.push(
          <strong key={nextKey()} className="assistant-bold">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-hs`)}
          </strong>
        )
        i = closeTag + 9
        continue
      }
    }

    if (normalized.slice(i, i + 3).toLowerCase() === '<u>') {
      const closeTag = normalized.toLowerCase().indexOf('</u>', i + 3)
      if (closeTag > i + 3) {
        const inner = normalized.slice(i + 3, closeTag)
        nodes.push(
          <u key={nextKey()} className="assistant-underline">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-u2`)}
          </u>
        )
        i = closeTag + 4
        continue
      }
    }

    if (normalized.slice(i, i + 3).toLowerCase() === '<i>') {
      const closeTag = normalized.toLowerCase().indexOf('</i>', i + 3)
      if (closeTag > i + 3) {
        const inner = normalized.slice(i + 3, closeTag)
        nodes.push(
          <em key={nextKey()} className="assistant-italic">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-hi`)}
          </em>
        )
        i = closeTag + 4
        continue
      }
    }

    if (normalized.slice(i, i + 4).toLowerCase() === '<em>') {
      const closeTag = normalized.toLowerCase().indexOf('</em>', i + 4)
      if (closeTag > i + 4) {
        const inner = normalized.slice(i + 4, closeTag)
        nodes.push(
          <em key={nextKey()} className="assistant-italic">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-hem`)}
          </em>
        )
        i = closeTag + 5
        continue
      }
    }

    if (normalized[i] === '*' && normalized[i + 1] !== '*') {
      const close = findItalicAsteriskClose(normalized, i)
      if (close > i + 1) {
        const inner = normalized.slice(i + 1, close)
        nodes.push(
          <em key={nextKey()} className="assistant-italic">
            {parseInlineContent(inner, onCitationClick, `${keyPrefix}-em`)}
          </em>
        )
        i = close + 1
        continue
      }
    }

    if (normalized[i] === '_' && normalized[i + 1] !== '_') {
      const prev = i > 0 ? normalized[i - 1] : ' '
      if (!/\w/.test(prev)) {
        const close = findItalicUnderscoreClose(normalized, i)
        if (close > i + 1) {
          const inner = normalized.slice(i + 1, close)
          nodes.push(
            <em key={nextKey()} className="assistant-italic">
              {parseInlineContent(inner, onCitationClick, `${keyPrefix}-em2`)}
            </em>
          )
          i = close + 1
          continue
        }
      }
    }

    let next = i + 1
    while (next < normalized.length) {
      const ch = normalized[next]
      if (ch === '*' || ch === '_' || ch === '+') break
      if (ch === '<') {
        const lower = normalized.slice(next, next + 8).toLowerCase()
        if (
          lower.startsWith('<u>') ||
          lower.startsWith('<b>') ||
          lower.startsWith('<i>') ||
          lower.startsWith('<em>') ||
          lower.startsWith('<strong>')
        ) {
          break
        }
      }
      if (citationAt(normalized, next)) break
      next += 1
    }
    nodes.push(normalized.slice(i, next))
    i = next
  }

  return nodes
}

function renderAssistantContent(text, onCitationClick) {
  if (!text) return null

  const lines = normalizeMdText(text).split('\n')
  const segments = []
  let i = 0

  const peekNonEmpty = (from) => {
    let j = from
    while (j < lines.length && !lines[j].trim()) j += 1
    return j
  }

  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) i += 1
    if (i >= lines.length) break

    const headerMatch = lines[i].match(HEADER_RE)
    if (headerMatch) {
      const level = Math.min(headerMatch[1].length, 6)
      const HeadingTag = `h${level}`
      segments.push({
        type: 'heading',
        level,
        tag: HeadingTag,
        text: headerMatch[2].trim(),
      })
      i += 1
      continue
    }

    if (ORDERED_ITEM_RE.test(lines[i]) || BULLET_ITEM_RE.test(lines[i])) {
      const ordered = ORDERED_ITEM_RE.test(lines[i])
      const items = []
      while (i < lines.length) {
        if (!lines[i].trim()) {
          const j = peekNonEmpty(i + 1)
          if (
            j < lines.length &&
            (ORDERED_ITEM_RE.test(lines[j]) || BULLET_ITEM_RE.test(lines[j]))
          ) {
            i = j
            continue
          }
          break
        }
        const om = lines[i].match(ORDERED_ITEM_RE)
        const bm = lines[i].match(BULLET_ITEM_RE)
        if (ordered && om) {
          items.push({ text: om[2], subs: [] })
          i += 1
        } else if (ordered && bm && items.length) {
          items[items.length - 1].subs.push(bm[1])
          i += 1
        } else if (!ordered && bm) {
          items.push({ text: bm[1], subs: [] })
          i += 1
        } else if (
          items.length &&
          !ORDERED_ITEM_RE.test(lines[i]) &&
          !BULLET_ITEM_RE.test(lines[i]) &&
          !HEADER_RE.test(lines[i])
        ) {
          const cur = items[items.length - 1]
          if (cur.subs.length) {
            cur.subs[cur.subs.length - 1] += ` ${lines[i].trim()}`
          } else {
            cur.text += ` ${lines[i].trim()}`
          }
          i += 1
        } else {
          break
        }
      }
      segments.push({ type: ordered ? 'ol' : 'ul', items })
      continue
    }

    if (isBoldLabelItem(lines[i])) {
      const items = []
      while (i < lines.length) {
        if (!lines[i].trim()) {
          const j = peekNonEmpty(i + 1)
          if (j < lines.length && isBoldLabelItem(lines[j])) {
            i = j
            continue
          }
          break
        }
        if (isBoldLabelItem(lines[i])) {
          items.push({ text: lines[i].trim(), subs: [] })
          i += 1
        } else if (
          items.length &&
          !ORDERED_ITEM_RE.test(lines[i]) &&
          !BULLET_ITEM_RE.test(lines[i]) &&
          !HEADER_RE.test(lines[i]) &&
          !isBoldLabelItem(lines[i])
        ) {
          items[items.length - 1].text += ` ${lines[i].trim()}`
          i += 1
        } else {
          break
        }
      }
      segments.push({ type: 'ul', items })
      continue
    }

    const para = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !ORDERED_ITEM_RE.test(lines[i]) &&
      !BULLET_ITEM_RE.test(lines[i]) &&
      !HEADER_RE.test(lines[i]) &&
      !isBoldLabelItem(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    segments.push({ type: 'p', text: para.join('\n') })
  }

  return segments.map((seg, si) => {
    if (seg.type === 'heading') {
      const HeadingTag = seg.tag
      return (
        <HeadingTag
          key={`s-${si}`}
          className={HEADING_CLASS[seg.level] || HEADING_CLASS[3]}
        >
          {parseInlineContent(seg.text, onCitationClick, `s${si}h`)}
        </HeadingTag>
      )
    }
    if (seg.type === 'p') {
      return (
        <p
          key={`s-${si}`}
          className="assistant-paragraph"
        >
          {parseInlineContent(seg.text, onCitationClick, `s${si}`)}
        </p>
      )
    }
    const ListTag = seg.type === 'ol' ? 'ol' : 'ul'
    return (
      <ListTag
        key={`s-${si}`}
        className={`assistant-list ${
          seg.type === 'ol' ? 'assistant-list-ol' : 'assistant-list-ul'
        }`}
      >
        {seg.items.map((item, li) => (
          <li key={`s-${si}-l-${li}`} className="assistant-list-item">
            {parseInlineContent(item.text, onCitationClick, `s${si}l${li}`)}
            {item.subs?.length > 0 && (
              <ul className="assistant-list assistant-list-ul assistant-list-nested">
                {item.subs.map((sub, si2) => (
                  <li
                    key={`s-${si}-l-${li}-s-${si2}`}
                    className="assistant-list-item"
                  >
                    {parseInlineContent(sub, onCitationClick, `s${si}l${li}s${si2}`)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ListTag>
    )
  })
}

export default function ChatWindow({
  messages,
  onSend,
  sending,
  onStop,
  attachMemory,
  setAttachMemory,
  responseMode,
  setResponseMode,
  language,
  setLanguage,
  onCitationClick,
  onExport,
  onFeedback,
  draft,
  setDraft,
  rateLimited,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}) {
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const submit = (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending || rateLimited) return
    onSend(text)
  }

  const handleStarter = (prompt) => {
    if (sending || rateLimited) return
    onSend(prompt)
  }

  const lastIsStreamingAssistant =
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].streaming

  const showEmpty = messages.length === 0 && !sending

  return (
    <main
      className="flex-1 flex flex-col h-full min-w-0"
      style={{ backgroundColor: 'var(--chat-bg)', color: 'var(--text-primary)' }}
    >
      <div
        className="px-3 sm:px-6 py-3 sm:py-4 flex flex-col gap-2.5 sm:gap-3"
        style={{
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'var(--header-bg)',
        }}
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onToggleLeft}
              className="p-2.5 rounded-xl shrink-0"
              style={{
                color: leftOpen ? 'var(--text-primary)' : 'var(--text-muted)',
                backgroundColor: leftOpen ? 'transparent' : 'var(--chip-bg)',
                border: leftOpen
                  ? '1px solid transparent'
                  : '1px solid var(--border)',
              }}
              aria-label={leftOpen ? 'Hide chat history' : 'Show chat history'}
              aria-pressed={leftOpen}
              title={
                leftOpen
                  ? 'Hide history'
                  : 'Show history (or hover the left edge on desktop)'
              }
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h2
                className="font-serif text-base sm:text-lg truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                Seek Guidance
              </h2>
              <p
                className="text-xs hidden sm:block"
                style={{ color: 'var(--text-muted)' }}
              >
                Grounded in the verses of the Bhagavad Gita
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleRight}
              className="inline-flex items-center gap-1.5 text-sm rounded-xl px-2.5 py-2"
              style={{
                color: rightOpen ? 'var(--text-primary)' : 'var(--text-muted)',
                backgroundColor: rightOpen ? 'transparent' : 'var(--chip-bg)',
                border: '1px solid var(--border)',
              }}
              aria-label={
                rightOpen ? 'Hide sources panel' : 'Show sources panel'
              }
              aria-pressed={rightOpen}
              title={rightOpen ? 'Hide sources' : 'Show sources'}
            >
              <ScrollText className="w-4 h-4" />
              <span className="hidden sm:inline">Sources</span>
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={!messages.length}
              className="inline-flex items-center gap-1.5 text-sm disabled:opacity-40 rounded-xl p-2 sm:px-2 sm:py-1"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Export chat as Markdown"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center rounded-xl p-0.5 text-[11px] sm:text-xs flex-1 sm:flex-none min-w-0"
            style={{
              border: '1px solid var(--border)',
              backgroundColor: 'var(--chip-bg)',
            }}
            role="group"
            aria-label="Response mode"
          >
            {[
              {
                id: 'brief',
                label: 'Brief',
                title: 'Short answer (~150 words): 1 insight + 3 bullets',
              },
              {
                id: 'deep',
                label: 'Deep',
                title: 'Philosophical essay (~500 words): meaning and wisdom',
              },
              {
                id: 'practical',
                label: 'Practical',
                title: 'Action steps (~300 words): numbered things to do today',
              },
            ].map((mode) => {
              const active = responseMode === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setResponseMode(mode.id)}
                  title={mode.title}
                  className="flex-1 sm:flex-none px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                  style={{
                    backgroundColor: active
                      ? 'var(--chip-active)'
                      : 'transparent',
                    color: active
                      ? 'var(--chip-active-text)'
                      : 'var(--text-muted)',
                    boxShadow: active
                      ? '0 0 0 1px color-mix(in srgb, var(--chip-active) 40%, transparent)'
                      : undefined,
                  }}
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
          <label
            className="inline-flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm cursor-pointer select-none shrink-0"
            style={{ color: 'var(--text-secondary)' }}
            title="Attach memory context"
          >
            <BrainCircuit
              className="w-4 h-4 shrink-0"
              style={{ color: 'var(--text-muted)' }}
            />
            <span className="leading-none hidden md:inline">
              Attach Memory Context
            </span>
            <span className="leading-none md:hidden">Memory</span>
            <input
              type="checkbox"
              checked={attachMemory}
              onChange={(e) => setAttachMemory(e.target.checked)}
              className="w-4 h-4 shrink-0 align-middle"
              style={{ accentColor: 'var(--accent)' }}
              aria-label="Attach memory context"
            />
          </label>
          <div
            className="inline-flex items-center gap-1 rounded-xl p-0.5 text-[11px] sm:text-xs shrink-0"
            style={{
              border: '1px solid var(--border)',
              backgroundColor: 'var(--chip-bg)',
            }}
            role="group"
            aria-label="Response language"
            title="Answer language (retrieval stays in English embeddings)"
          >
            <Languages
              className="w-3.5 h-3.5 ml-1.5 shrink-0"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden
            />
            {RESPONSE_LANGUAGES.map((lang) => {
              const active = language === lang.id
              return (
                <button
                  key={lang.id}
                  type="button"
                  onClick={() => setLanguage(lang.id)}
                  className="px-2 py-1.5 rounded-lg transition-colors font-medium"
                  style={{
                    backgroundColor: active
                      ? 'var(--chip-active)'
                      : 'transparent',
                    color: active
                      ? 'var(--chip-active-text)'
                      : 'var(--text-muted)',
                  }}
                  aria-pressed={active}
                  title={lang.title}
                >
                  {lang.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {showEmpty && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-5 sm:gap-6 px-1 sm:px-4">
            <div className="space-y-2 max-w-xl">
              <p
                className="font-serif text-xl sm:text-2xl leading-snug"
                style={{ color: 'var(--text-primary)' }}
              >
                &ldquo;You have a right to perform your duty, but not to the
                fruits.&rdquo;
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Ask anything below, or try a starter prompt.
              </p>
            </div>
            <div className="flex flex-col sm:flex-wrap sm:flex-row justify-center gap-2 w-full max-w-2xl">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleStarter(prompt)}
                  disabled={sending || rateLimited}
                  className="text-left text-sm rounded-xl px-3.5 py-3 sm:py-2.5 transition-colors disabled:opacity-40 w-full sm:w-auto sm:max-w-xs"
                  style={{
                    backgroundColor: 'var(--prompt-chip-bg)',
                    border: '1px solid var(--prompt-chip-border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onCitationClick={onCitationClick}
            onFeedback={onFeedback}
          />
        ))}
        {sending &&
          (!lastIsStreamingAssistant ||
            !messages[messages.length - 1]?.content) && (
            <div
              className="flex items-center gap-2 text-sm pl-1"
              style={{ color: 'var(--text-muted)' }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Reflecting on the verses…
            </div>
          )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={submit}
        className="composer-bar p-3 sm:p-4 flex items-end gap-2 sm:gap-3"
        style={{
          borderTop: '1px solid var(--border)',
          backgroundColor: 'var(--header-bg)',
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending || rateLimited}
          placeholder={
            rateLimited
              ? 'Hourly rate limit reached — try again later'
              : 'Ask about duty, detachment, purpose…'
          }
          className="flex-1 min-w-0 rounded-2xl px-4 sm:px-5 py-3 text-base sm:text-sm focus:outline-none disabled:opacity-50"
          style={{
            backgroundColor: 'var(--input-bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
          aria-label="Message input"
        />
        {sending ? (
          <button
            type="button"
            onClick={onStop}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-2xl transition-colors"
            style={{
              backgroundColor: 'var(--panel-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
            aria-label="Stop generating"
            title="Stop"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={sending || rateLimited || !draft.trim()}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-2xl disabled:opacity-40 transition-colors"
            style={{
              backgroundColor: 'var(--text-primary)',
              color: 'var(--chat-bg)',
            }}
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </form>
    </main>
  )
}

function MessageBubble({ message, onCitationClick, onFeedback }) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`w-[92%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? 'rounded-br-sm' : 'rounded-bl-sm'
        }`}
        style={{
          backgroundColor: isUser
            ? 'var(--bubble-user)'
            : 'var(--bubble-ai)',
          color: isUser ? 'var(--bubble-user-text)' : 'var(--bubble-ai-text)',
          border: isUser ? 'none' : '1px solid var(--bubble-border)',
        }}
      >
        {!isUser && (
          <p
            className="text-[11px] uppercase tracking-wider mb-1 font-medium"
            style={{ color: 'var(--accent)' }}
          >
            Guide
          </p>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="assistant-md">
            {renderAssistantContent(message.content, onCitationClick)}
            {message.streaming && message.content ? (
              <span
                className="inline-block w-1.5 h-4 ml-0.5 align-middle animate-pulse"
                style={{ backgroundColor: 'var(--accent)' }}
              />
            ) : null}
          </div>
        )}
        {!isUser && !message.streaming && message.content && (
          <div
            className="mt-2.5 pt-2 flex items-center gap-0.5"
            style={{ borderTop: '1px solid var(--bubble-border)' }}
          >
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: copied ? 'var(--accent)' : 'var(--text-muted)' }}
              aria-label="Copy reply"
              title="Copy"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onFeedback?.(message.id, 'up')}
              className="p-1.5 rounded-lg"
              style={{
                color:
                  message.feedback === 'up'
                    ? 'var(--accent)'
                    : 'var(--text-muted)',
              }}
              aria-label="Helpful"
              title="Helpful"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onFeedback?.(message.id, 'down')}
              className="p-1.5 rounded-lg"
              style={{
                color:
                  message.feedback === 'down'
                    ? 'var(--accent)'
                    : 'var(--text-muted)',
              }}
              aria-label="Not helpful"
              title="Not helpful"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
