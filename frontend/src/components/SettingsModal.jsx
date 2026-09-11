import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { getLlmStatus, updateLlmSettings, apiFieldErrors } from '../api.js'

const CUSTOM_MODEL = '__custom__'

const FALLBACK_COMPANIES = [
  {
    id: 'ollama',
    label: 'Ollama (local)',
    needs_key: false,
    needs_base_url: false,
    models: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5'],
    key_placeholder: '',
    hint: 'Free local models. Install Ollama, then pull a model.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    needs_key: true,
    needs_base_url: false,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini', 'o3-mini'],
    key_placeholder: 'sk-…',
    hint: 'Uses your OpenAI API key.',
  },
  {
    id: 'google',
    label: 'Google',
    needs_key: true,
    needs_base_url: false,
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    key_placeholder: 'AIza…',
    hint: '',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    needs_key: true,
    needs_base_url: false,
    models: [
      'claude-sonnet-4-5',
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
    ],
    key_placeholder: 'sk-ant-…',
    hint: '',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    needs_key: true,
    needs_base_url: false,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    key_placeholder: 'sk-…',
    hint: '',
  },
  {
    id: 'xai',
    label: 'Grok (xAI)',
    needs_key: true,
    needs_base_url: false,
    models: ['grok-3', 'grok-3-mini', 'grok-2-latest'],
    key_placeholder: 'xai-…',
    hint: '',
  },
  {
    id: 'groq',
    label: 'Groq',
    needs_key: true,
    needs_base_url: false,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    key_placeholder: 'gsk_…',
    hint: '',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    needs_key: true,
    needs_base_url: false,
    models: ['mistral-small-latest', 'mistral-large-latest'],
    key_placeholder: '…',
    hint: '',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    needs_key: true,
    needs_base_url: false,
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
    key_placeholder: 'sk-or-…',
    hint: '',
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    needs_key: true,
    needs_base_url: true,
    models: [],
    key_placeholder: 'sk-…',
    hint: 'Any host that speaks the OpenAI Chat Completions API.',
  },
]

const COMPANY_LABELS = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  google: 'Google',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  xai: 'Grok',
  groq: 'Groq',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  custom: 'Custom',
}

export function companyLabel(id, model) {
  const name = COMPANY_LABELS[id] || (id === 'ollama' ? 'Ollama' : id || 'Ollama')
  return `${name} · ${model || 'model'}`
}

function fieldBorder(hasError) {
  return {
    backgroundColor: 'var(--input-bg)',
    color: 'var(--text-primary)',
    border: `1px solid ${hasError ? 'var(--error)' : 'var(--border)'}`,
    boxShadow: hasError ? '0 0 0 3px var(--error-soft)' : 'none',
  }
}

function FieldError({ text }) {
  if (!text) return null
  return (
    <p className="text-xs mt-1.5" style={{ color: 'var(--error)' }} role="alert">
      {text}
    </p>
  )
}

export default function SettingsModal({
  open,
  onClose,
  temperature,
  setTemperature,
  onClearChats,
  onClearBookmarks,
  bookmarkCount,
  user,
  onUserUpdate,
}) {
  const [provider, setProvider] = useState(user?.llm_provider || 'ollama')
  const [model, setModel] = useState(user?.llm_model || 'llama3.2')
  const [customModel, setCustomModel] = useState(false)
  const [baseUrl, setBaseUrl] = useState(user?.llm_base_url || '')
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [saveErr, setSaveErr] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => {
    if (!open) return
    setProvider(user?.llm_provider || 'ollama')
    setModel(user?.llm_model || 'llama3.2')
    setBaseUrl(user?.llm_base_url || '')
    setApiKey('')
    setClearKey(false)
    setSaveMsg(null)
    setSaveErr(null)
    setFieldErrors({})
    getLlmStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [open, user])

  const companies = status?.companies?.length ? status.companies : FALLBACK_COMPANIES
  const company =
    companies.find((c) => c.id === provider) ||
    companies.find((c) => c.id === 'ollama') ||
    null

  const modelOptions = useMemo(() => {
    const listed = company?.models || []
    const ollamaInstalled = status?.ollama_models || []
    if (provider === 'ollama' && ollamaInstalled.length) {
      return Array.from(new Set([...ollamaInstalled, ...listed]))
    }
    return listed
  }, [company, provider, status])

  if (!open) return null

  const needsKey = Boolean(company?.needs_key)
  const needsBaseUrl = Boolean(company?.needs_base_url)
  const showCustomInput =
    customModel ||
    modelOptions.length === 0 ||
    (Boolean(model) && !modelOptions.includes(model))
  const selectValue = showCustomInput ? CUSTOM_MODEL : model

  const switchCompany = (id) => {
    const next = companies.find((c) => c.id === id)
    setProvider(id)
    setFieldErrors({})
    setSaveErr(null)
    setSaveMsg(null)
    setCustomModel(!(next?.models || []).length)
    if (next?.models?.length) {
      const installed = status?.ollama_models || []
      if (id === 'ollama' && installed.length) setModel(installed[0])
      else setModel(next.models[0])
    } else {
      setModel('')
    }
    if (id !== 'custom') setBaseUrl(id === 'ollama' ? user?.llm_base_url || '' : '')
  }

  const saveLlm = async () => {
    const nextFields = {}
    if (!model.trim()) nextFields.model = 'Choose or type a model name.'
    if (needsKey && !apiKey.trim() && !user?.has_api_key) {
      nextFields.api_key = 'Add an API key to use this company.'
    }
    if (needsKey && clearKey && !apiKey.trim()) {
      nextFields.api_key = 'Add an API key to use this company.'
    }
    if (needsBaseUrl && !baseUrl.trim()) {
      nextFields.base_url = 'Add the API base URL for this host.'
    }
    if (Object.keys(nextFields).length) {
      setFieldErrors(nextFields)
      setSaveErr(Object.values(nextFields)[0])
      setSaveMsg(null)
      return
    }

    setSaving(true)
    setSaveMsg(null)
    setSaveErr(null)
    setFieldErrors({})
    try {
      const payload = {
        llm_provider: provider,
        llm_model: model.trim(),
        llm_base_url: needsBaseUrl || provider === 'ollama' ? baseUrl.trim() || null : null,
        clear_api_key: clearKey,
      }
      if (!clearKey && apiKey.trim()) payload.api_key = apiKey.trim()
      const next = await updateLlmSettings(payload)
      onUserUpdate?.(next)
      setApiKey('')
      setClearKey(false)
      setSaveMsg(
        provider === 'ollama'
          ? 'Local model saved.'
          : `${company?.label || 'Company'} is ready. Settings saved.`
      )
    } catch (e) {
      const parsed = apiFieldErrors(e, 'Could not save model settings.')
      setFieldErrors(parsed.fields || {})
      setSaveErr(parsed.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[min(92vh,40rem)] overflow-y-auto rounded-2xl p-5 shadow-xl"
        style={{
          backgroundColor: 'var(--panel-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="settings-title" className="font-serif text-xl">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium mb-2">Answer model</p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Pick a company, then a model. Default is a free local model via
              Ollama. Type a model name if it is not in the list.
            </p>

            <label className="block text-sm mb-3">
              <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                Company
              </span>
              <select
                value={provider}
                onChange={(e) => switchCompany(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={fieldBorder(Boolean(fieldErrors.provider))}
                aria-invalid={Boolean(fieldErrors.provider)}
              >
                {(companies.length ? companies : FALLBACK_COMPANIES).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <FieldError text={fieldErrors.provider} />
            </label>

            {company?.hint && (
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                {company.hint}
              </p>
            )}

            {provider === 'ollama' && (
              <div
                className="text-xs rounded-xl px-3 py-2 mb-3"
                style={{
                  backgroundColor: fieldErrors.provider
                    ? 'var(--error-soft)'
                    : 'var(--accent-soft)',
                  border: `1px solid ${
                    fieldErrors.provider ? 'var(--error)' : 'var(--border)'
                  }`,
                  color: fieldErrors.provider ? 'var(--error)' : 'inherit',
                }}
              >
                {status?.ollama_message ||
                  'Checking Ollama… Install from ollama.com, then run ollama pull llama3.2'}
              </div>
            )}

            <label className="block text-sm mb-3">
              <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                Model
              </span>
              <select
                value={selectValue}
                onChange={(e) => {
                  const value = e.target.value
                  setFieldErrors((prev) => ({ ...prev, model: undefined }))
                  if (value === CUSTOM_MODEL) {
                    setCustomModel(true)
                    return
                  }
                  setCustomModel(false)
                  setModel(value)
                }}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={fieldBorder(Boolean(fieldErrors.model))}
                aria-invalid={Boolean(fieldErrors.model)}
              >
                {provider === 'ollama' && (status?.ollama_models || []).length > 0 && (
                  <optgroup label="Installed on this machine">
                    {status.ollama_models.map((name) => (
                      <option key={`inst-${name}`} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(company?.models || [])
                  .filter((name) => !(status?.ollama_models || []).includes(name))
                  .length > 0 && (
                  <optgroup
                    label={
                      provider === 'ollama' ? 'Suggested (pull if missing)' : 'Available models'
                    }
                  >
                    {(company?.models || [])
                      .filter((name) => !(status?.ollama_models || []).includes(name))
                      .map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                  </optgroup>
                )}
                {modelOptions.length === 0 && !customModel && (
                  <option value="" disabled>
                    No listed models
                  </option>
                )}
                <option value={CUSTOM_MODEL}>Type a model name…</option>
              </select>
              {showCustomInput && (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value)
                    setFieldErrors((prev) => ({ ...prev, model: undefined }))
                  }}
                  placeholder="Type the exact model id"
                  className="w-full rounded-xl px-3 py-2 text-sm mt-2"
                  style={fieldBorder(Boolean(fieldErrors.model))}
                  aria-invalid={Boolean(fieldErrors.model)}
                />
              )}
              <FieldError text={fieldErrors.model} />
            </label>

            {needsBaseUrl && (
              <label className="block text-sm mb-3">
                <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  API base URL
                </span>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value)
                    setFieldErrors((prev) => ({ ...prev, base_url: undefined }))
                  }}
                  placeholder="https://api.groq.com/openai/v1"
                  className="w-full rounded-xl px-3 py-2 text-sm"
                  style={fieldBorder(Boolean(fieldErrors.base_url))}
                  aria-invalid={Boolean(fieldErrors.base_url)}
                />
                <FieldError text={fieldErrors.base_url} />
              </label>
            )}

            {needsKey && (
              <label className="block text-sm mb-2">
                <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  API key {user?.has_api_key ? `(saved ${user.api_key_hint || ''})` : ''}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setClearKey(false)
                    setFieldErrors((prev) => ({ ...prev, api_key: undefined }))
                  }}
                  placeholder={
                    user?.has_api_key
                      ? 'Leave blank to keep the saved key'
                      : company?.key_placeholder || 'sk-…'
                  }
                  className="w-full rounded-xl px-3 py-2 text-sm"
                  style={fieldBorder(Boolean(fieldErrors.api_key))}
                  aria-invalid={Boolean(fieldErrors.api_key)}
                />
                <FieldError text={fieldErrors.api_key} />
                {user?.has_api_key && (
                  <label className="mt-2 inline-flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clearKey}
                      onChange={(e) => setClearKey(e.target.checked)}
                    />
                    Remove saved key
                  </label>
                )}
              </label>
            )}

            {(saveMsg || saveErr) && (
              <p
                className="text-xs mb-2"
                style={{ color: saveErr ? 'var(--error)' : 'var(--text-secondary)' }}
              >
                {saveErr || saveMsg}
              </p>
            )}
            <button
              type="button"
              onClick={saveLlm}
              disabled={saving}
              className="w-full rounded-xl py-2 text-sm font-medium disabled:opacity-50"
              style={{
                backgroundColor: 'var(--chip-active)',
                color: 'var(--chip-active-text)',
              }}
            >
              {saving ? 'Checking company…' : 'Save model'}
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="temp-range" className="text-sm font-medium">
                Response temperature
              </label>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {temperature.toFixed(2)}
              </span>
            </div>
            <input
              id="temp-range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: 'var(--accent)' }}
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Lower is more focused; higher is more varied. Default 0.40.
            </p>
          </div>

          <div
            className="pt-4 space-y-2"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Data
            </p>
            <button
              type="button"
              onClick={onClearChats}
              className="w-full text-left text-sm rounded-xl px-3 py-2.5 transition-colors"
              style={{
                backgroundColor: 'var(--chip-bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              Clear all conversations
            </button>
            <button
              type="button"
              onClick={onClearBookmarks}
              disabled={bookmarkCount === 0}
              className="w-full text-left text-sm rounded-xl px-3 py-2.5 transition-colors disabled:opacity-40"
              style={{
                backgroundColor: 'var(--chip-bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              Clear saved verses ({bookmarkCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
