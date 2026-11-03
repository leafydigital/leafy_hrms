import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'

// Sign in, and forgot password: email → 4-digit code from the email → new password → back to sign in.
const RESEND_SECONDS = 60

function CodeBoxes({ value, onChange, disabled, invalid }) {
  const refs = useRef([])
  const digits = Array.from({ length: 4 }, (_, i) => value[i] ?? '')
  const setAt = (i, d) => {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').slice(0, 4))
  }
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) { refs.current[i - 1]?.focus(); setAt(i - 1, '') }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 3) refs.current[i + 1]?.focus()
  }
  const onInput = (i, raw) => {
    const only = raw.replace(/\D/g, '')
    if (only.length > 1) { // pasted or autofilled the whole code
      onChange(only.slice(0, 4))
      refs.current[Math.min(only.length, 4) - 1]?.focus()
      return
    }
    setAt(i, only)
    if (only && i < 3) refs.current[i + 1]?.focus()
  }
  return (
    <div className="mb-2 flex justify-between gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className={`h-14 w-full rounded-xl border text-center text-2xl font-bold tracking-widest focus:outline-none focus:ring-2 ${invalid ? 'border-red-500 bg-red-50/50 focus:ring-red-300' : 'border-gray-300 focus:border-leaf-600 focus:ring-lime-400/40'}`}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? 4 : 1}
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onFocus={(e) => e.target.select()}
          autoFocus={i === 0}
        />
      ))}
    </div>
  )
}

export default function Login() {
  const { signIn } = useAuth()
  const [mode, setMode] = useState('login') // login | forgot | code | newpw
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErr, setFieldErr] = useState({})
  const [notice, setNotice] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const go = (m) => { setMode(m); setError(''); setFieldErr({}); setNotice('') }

  const submitLogin = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    const { error } = await signIn(email.trim(), password)
    if (error) setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
    setBusy(false)
  }

  const sendCode = async (e) => {
    e?.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setFieldErr({ email: 'Enter your company email address.' })
    setBusy(true); setError(''); setFieldErr({})
    const { data, error } = await db.auth.requestPasswordReset(email.trim())
    setBusy(false)
    if (error) return setError(error.message)
    setNotice(data.message)
    setCode('')
    setCooldown(RESEND_SECONDS)
    setMode('code')
  }

  const verify = async (e) => {
    e?.preventDefault()
    if (!/^\d{4}$/.test(code)) return setFieldErr({ code: 'Enter all 4 digits.' })
    setBusy(true); setError(''); setFieldErr({})
    const { data, error } = await db.auth.verifyResetCode(email.trim(), code)
    setBusy(false)
    if (error) { setFieldErr({ code: error.message }); if (error.expired) setCode(''); return }
    setResetToken(data.reset_token)
    setNotice('')
    setMode('newpw')
  }

  // Submit automatically once all four digits are in.
  useEffect(() => { if (mode === 'code' && code.length === 4 && !busy) verify() }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const savePassword = async (e) => {
    e.preventDefault()
    const errs = {}
    if (newPassword.length < 8) errs.newPassword = 'Use at least 8 characters.'
    if (confirmPassword !== newPassword) errs.confirmPassword = 'The two passwords do not match.'
    if (Object.keys(errs).length) return setFieldErr(errs)
    setBusy(true); setError(''); setFieldErr({})
    const { data, error } = await db.auth.resetPassword(resetToken, newPassword)
    setBusy(false)
    if (error) return setError(error.message)
    setPassword(''); setNewPassword(''); setConfirmPassword(''); setResetToken(''); setCode('')
    setMode('login')
    setNotice(data.message)
  }

  const title = { login: 'Sign in', forgot: 'Forgot password', code: 'Enter the code', newpw: 'Set a new password' }[mode]
  const subtitle = {
    login: 'Use the work email your HR team set up for you.',
    forgot: 'Enter your company email. We will email you a 4-digit code.',
    code: <>We sent a 4-digit code to <b className="text-ink">{email.trim()}</b>. It expires in 10 minutes.</>,
    newpw: 'Code verified. Choose a new password for your HRMS account.',
  }[mode]
  const onSubmit = { login: submitLogin, forgot: sendCode, code: verify, newpw: savePassword }[mode]

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-12 lg:flex">
        <img src="/logo-white.png" alt="Leafy Digital" className="h-36 w-auto self-start" />
        <div>
          <h2 className="text-4xl font-bold leading-tight text-white">
            People, pay and projects —<br />
            <span className="text-lime-400">in one place.</span>
          </h2>
          <p className="mt-4 max-w-md text-gray-400">
            Leafy Digital's internal HR system for leave, attendance, payroll, projects, tasks and team chat.
          </p>
        </div>
        <p className="text-xs text-gray-500">© Leafy Digital · Internal use only</p>
      </div>

      <div className="flex items-center justify-center p-6" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
        <form onSubmit={onSubmit} noValidate className="w-full max-w-sm">
          <img src="/logo-black.png" alt="Leafy Digital" className="mb-8 h-24 w-auto lg:hidden" />
          {mode !== 'login' && (
            <button type="button" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-ink" onClick={() => go(mode === 'code' ? 'forgot' : 'login')}>
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-gray-500">{subtitle}</p>

          {(mode === 'login' || mode === 'forgot') && (
            <>
              <label className={`label${fieldErr.email ? ' text-red-600' : ''}`} htmlFor="email">Company email</label>
              <input id="email" type="email" className={`input ${fieldErr.email ? 'border-red-500 bg-red-50/40' : ''}`} value={email}
                onChange={(e) => { setEmail(e.target.value); setFieldErr({}) }} required autoComplete="username" inputMode="email" />
              {fieldErr.email ? <p className="mb-4 mt-1 text-xs font-medium text-red-600">{fieldErr.email}</p> : <div className="mb-4" />}
            </>
          )}
          {mode === 'login' && (
            <>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative mb-4">
                <input id="password" type={showPw ? 'text' : 'password'} className="input pr-10" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-ink" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </>
          )}

          {mode === 'code' && (
            <>
              {notice && <p className="mb-4 flex items-start gap-2 rounded-lg bg-lime-50 px-3 py-2 text-sm text-leaf-800"><MailCheck size={16} className="mt-0.5 shrink-0" />{notice}</p>}
              <CodeBoxes value={code} onChange={(v) => { setCode(v); setFieldErr({}) }} disabled={busy} invalid={!!fieldErr.code} />
              {fieldErr.code ? <p className="mb-4 text-xs font-medium text-red-600">{fieldErr.code}</p> : <div className="mb-4" />}
              <p className="mb-4 text-center text-xs text-gray-500">
                Didn't get it?{' '}
                {cooldown > 0 ? <span>Resend in {cooldown}s</span> : <button type="button" className="font-semibold text-leaf-700 underline" onClick={sendCode} disabled={busy}>Send a new code</button>}
              </p>
            </>
          )}

          {mode === 'newpw' && (
            <>
              <label className={`label${fieldErr.newPassword ? ' text-red-600' : ''}`} htmlFor="new-password">New password</label>
              <input id="new-password" type="password" className={`input ${fieldErr.newPassword ? 'border-red-500 bg-red-50/40' : ''}`} value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setFieldErr((f) => ({ ...f, newPassword: undefined })) }} autoComplete="new-password" autoFocus />
              {fieldErr.newPassword ? <p className="mb-4 mt-1 text-xs font-medium text-red-600">{fieldErr.newPassword}</p> : <p className="mb-4 mt-1 text-xs text-gray-500">At least 8 characters.</p>}
              <label className={`label${fieldErr.confirmPassword ? ' text-red-600' : ''}`} htmlFor="confirm-password">Confirm new password</label>
              <input id="confirm-password" type="password" className={`input ${fieldErr.confirmPassword ? 'border-red-500 bg-red-50/40' : ''}`} value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setFieldErr((f) => ({ ...f, confirmPassword: undefined })) }} autoComplete="new-password" />
              {fieldErr.confirmPassword ? <p className="mb-4 mt-1 text-xs font-medium text-red-600">{fieldErr.confirmPassword}</p> : <div className="mb-4" />}
            </>
          )}

          {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {notice && mode === 'login' && <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

          <button className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Please wait…' : { login: 'Sign in', forgot: 'Send code', code: 'Verify code', newpw: 'Save password' }[mode]}
          </button>
          {mode === 'login' && (
            <div className="mt-5 text-center text-xs text-gray-500">
              <button type="button" className="underline" onClick={() => go('forgot')}>Forgot password?</button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
