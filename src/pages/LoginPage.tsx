import { useState } from 'react'
import { authMode, DEFAULT_PASSWORD } from '../lib/auth'
import { useAuth } from '../lib/AuthContext'
import AuthShell from '../components/AuthShell'

/** Đăng nhập chế độ demo: tài khoản = mã nhân viên, mật khẩu ban đầu 123456 */
function LocalLogin() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1>Đăng nhập</h1>
        <p className="auth-note" style={{ marginTop: 4 }}>
          Dùng mã nhân viên của bạn. Chỉ tài khoản admin mới được xếp lịch.
        </p>
      </div>
      <label className="field">
        <span className="field-label">Tài khoản</span>
        <input
          className="input"
          required
          autoFocus
          autoComplete="username"
          placeholder="Mã nhân viên, ví dụ ChienHD2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </label>
      <label className="field">
        <span className="field-label">Mật khẩu</span>
        <input
          type="password"
          className="input"
          required
          autoComplete="current-password"
          placeholder="Mật khẩu ban đầu là 123456"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      <button type="submit" className="btn btn-primary justify-center" disabled={busy} data-loading={busy || undefined}>
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
      <p className="auth-note">
        Mật khẩu ban đầu <strong className="mono">{DEFAULT_PASSWORD}</strong> — bạn sẽ được yêu cầu đổi ở lần đăng nhập đầu tiên.
      </p>
    </form>
  )
}

/** Đăng nhập Supabase: email + mật khẩu (tài khoản do admin tạo trong Supabase Auth) */
function PasswordLogin() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1>Đăng nhập</h1>
        <p className="auth-note" style={{ marginTop: 4 }}>
          Dùng email và mật khẩu admin đã cấp. Chỉ tài khoản admin mới được xếp lịch.
        </p>
      </div>
      <label className="field">
        <span className="field-label">Email</span>
        <input
          type="email"
          required
          autoFocus
          autoComplete="username"
          className="input"
          placeholder="account@fpt.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </label>
      <label className="field">
        <span className="field-label">Mật khẩu</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          className="input"
          placeholder="Nhập mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      <button type="submit" className="btn btn-primary justify-center" disabled={busy} data-loading={busy || undefined}>
        {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </button>
      <p className="auth-note">Quên mật khẩu? Nhờ admin đặt lại trong Supabase → Authentication → Users.</p>
    </form>
  )
}

export default function LoginPage() {
  return <AuthShell mode="đăng nhập">{authMode === 'local' ? <LocalLogin /> : <PasswordLogin />}</AuthShell>
}
