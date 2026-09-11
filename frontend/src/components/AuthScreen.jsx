import { useEffect, useState } from 'react'
import { Eye, EyeOff, Lock, Mail, Sprout, UserRound } from 'lucide-react'
import { consumeAuthNotice } from '../authStorage.js'

const NOTICE_COPY = {
  idle: 'You were signed out after 15 minutes of inactivity.',
  closed: 'You were signed out when the app was closed.',
  expired: 'Your session expired. Please sign in again.',
}

export default function AuthScreen({
  view,
  setView,
  onLogin,
  onRegister,
  onForgot,
  onReset,
  resetToken,
  busy,
  error,
  info,
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState(() => consumeAuthNotice())

  useEffect(() => {
    setShowPassword(false)
    setPassword('')
    setConfirm('')
  }, [view])

  const title =
    view === 'register'
      ? 'Create your account'
      : view === 'forgot'
        ? 'Reset your password'
        : view === 'reset'
          ? 'Choose a new password'
          : 'Welcome back'

  const subtitle =
    view === 'register'
      ? 'Save your conversations and pick up where you left off.'
      : view === 'forgot'
        ? 'Enter the email on your account. We will send a reset link if it exists.'
        : view === 'reset'
          ? 'Enter a new password for this account.'
          : 'Sign in to continue your Gita Guide conversations.'

  const submit = (e) => {
    e.preventDefault()
    if (view === 'login') onLogin({ email, password, remember })
    else if (view === 'register') onRegister({ name, email, password, confirm })
    else if (view === 'forgot') onForgot({ email })
    else if (view === 'reset') onReset({ token: resetToken, password, confirm })
  }

  return (
    <div
      className="auth-page min-h-full flex items-center justify-center p-4 sm:p-8"
      style={{ backgroundColor: 'var(--app-bg)', color: 'var(--text-primary)' }}
    >
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Sprout className="w-6 h-6" style={{ color: 'var(--accent)' }} />
          <h1 className="font-serif text-3xl tracking-wide">Gita Guide</h1>
        </div>

        <div
          className="rounded-3xl p-6 sm:p-8 shadow-xl"
          style={{
            backgroundColor: 'var(--panel-elevated)',
            border: '1px solid var(--border)',
          }}
        >
          <h2 className="font-serif text-2xl mb-1">{title}</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>

          {(notice || error || info) && (
            <div
              className="text-sm rounded-2xl px-3.5 py-2.5 mb-4"
              style={{
                backgroundColor: error ? 'var(--accent-soft)' : 'var(--chip-bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            >
              {error ||
                (info && String(info).startsWith('http') ? (
                  <span>
                    Email is not configured on this server. Use this one-time link:{' '}
                    <button
                      type="button"
                      className="underline"
                      style={{ color: 'var(--accent)' }}
                      onClick={() => setView('reset')}
                    >
                      Reset password
                    </button>
                  </span>
                ) : (
                  info || NOTICE_COPY[notice] || notice
                ))}
            </div>
          )}

          <form onSubmit={submit} className="space-y-3.5">
            {view === 'register' && (
              <label className="block text-sm">
                <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  Name
                </span>
                <span className="auth-field">
                  <UserRound className="auth-field-icon" />
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="auth-input"
                  />
                </span>
              </label>
            )}

            {(view === 'login' || view === 'register' || view === 'forgot') && (
              <label className="block text-sm">
                <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  Email
                </span>
                <span className="auth-field">
                  <Mail className="auth-field-icon" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="auth-input"
                  />
                </span>
              </label>
            )}

            {(view === 'login' || view === 'register' || view === 'reset') && (
              <label className="block text-sm">
                <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  {view === 'reset' ? 'New password' : 'Password'}
                </span>
                <span className="auth-field">
                  <Lock className="auth-field-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete={
                      view === 'login' ? 'current-password' : 'new-password'
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="auth-input pr-10"
                  />
                  <button
                    type="button"
                    className="auth-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </span>
              </label>
            )}

            {(view === 'register' || view === 'reset') && (
              <label className="block text-sm">
                <span className="mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  Confirm password
                </span>
                <span className="auth-field">
                  <Lock className="auth-field-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    className="auth-input"
                  />
                </span>
              </label>
            )}

            {view === 'login' && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="auth-check"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className="text-sm"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => {
                    setNotice(null)
                    setView('forgot')
                  }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {view === 'reset' && !resetToken && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                This reset link is missing a token. Request a new one from Forgot
                password.
              </p>
            )}

            <button
              type="submit"
              disabled={busy || (view === 'reset' && !resetToken)}
              className="w-full mt-2 rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
              style={{
                backgroundColor: 'var(--chip-active)',
                color: 'var(--chip-active-text)',
              }}
            >
              {busy
                ? 'Please wait…'
                : view === 'register'
                  ? 'Create account'
                  : view === 'forgot'
                    ? 'Send reset link'
                    : view === 'reset'
                      ? 'Update password'
                      : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            {view === 'login' && (
              <>
                New here?{' '}
                <button
                  type="button"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => {
                    setNotice(null)
                    setView('register')
                  }}
                >
                  Create an account
                </button>
              </>
            )}
            {view === 'register' && (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => {
                    setNotice(null)
                    setView('login')
                  }}
                >
                  Sign in
                </button>
              </>
            )}
            {(view === 'forgot' || view === 'reset') && (
              <button
                type="button"
                style={{ color: 'var(--accent)' }}
                onClick={() => {
                  setNotice(null)
                  setView('login')
                }}
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
