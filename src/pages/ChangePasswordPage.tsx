import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authMode, MIN_PASSWORD_LENGTH } from '../lib/auth'
import { useAuth } from '../lib/AuthContext'
import AuthShell from '../components/AuthShell'
import PageHeader from '../components/PageHeader'
import { useFeedback } from '../components/Feedback'

interface Props {
  /** true khi bắt buộc đổi ở lần đăng nhập đầu — không có nút bỏ qua */
  forced?: boolean
  /** chỉ render form (nhúng trong trang Tài khoản), không có tiêu đề trang / nút Hủy */
  embedded?: boolean
}

export default function ChangePasswordPage({ forced = false, embedded = false }: Props) {
  const { user, changePassword, logout } = useAuth()
  const { toast } = useFeedback()
  const navigate = useNavigate()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirm) {
      setError('Mật khẩu nhập lại không khớp.')
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
      return
    }
    setBusy(true)
    try {
      await changePassword(oldPassword, newPassword)
      setDone(true)
      toast('Đã đổi mật khẩu.')
      if (!forced && !embedded) setTimeout(() => navigate('/'), 600)
      if (embedded) {
        setOldPassword('')
        setNewPassword('')
        setConfirm('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đổi mật khẩu thất bại.')
    } finally {
      setBusy(false)
    }
  }

  const fields = (
    <>
      {authMode === 'local' && (
        <label className="field">
          <span className="field-label">Mật khẩu hiện tại</span>
          <input
            type="password"
            className="input"
            required
            autoFocus={!embedded}
            autoComplete="current-password"
            placeholder="Nhập mật khẩu hiện tại"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
        </label>
      )}
      <label className="field">
        <span className="field-label">Mật khẩu mới (≥ {MIN_PASSWORD_LENGTH} ký tự)</span>
        <input
          type="password"
          className="input"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder={`Ít nhất ${MIN_PASSWORD_LENGTH} ký tự`}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">Nhập lại mật khẩu mới</span>
        <input
          type="password"
          className="input"
          required
          autoComplete="new-password"
          placeholder="Nhập lại mật khẩu mới"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={confirm.length > 0 && confirm !== newPassword ? true : undefined}
        />
      </label>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {done && <div className="alert alert-ok">✓ Đã đổi mật khẩu.</div>}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy} data-loading={busy || undefined}>
          {busy ? 'Đang lưu…' : 'Lưu mật khẩu mới'}
        </button>
        {forced ? (
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Đăng xuất
          </button>
        ) : embedded ? null : (
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Hủy
          </button>
        )}
      </div>
    </>
  )

  if (forced) {
    return (
      <AuthShell mode="mật khẩu lần đầu">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <h1>Đặt mật khẩu mới</h1>
            <p className="auth-note" style={{ marginTop: 4 }}>
              Tài khoản <strong>{user?.username}</strong> đang dùng mật khẩu ban đầu. Đổi mật khẩu để tiếp tục.
            </p>
          </div>
          {fields}
        </form>
      </AuthShell>
    )
  }

  if (embedded) {
    return (
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
        {fields}
      </form>
    )
  }

  return (
    <div className="page page-narrow">
      <PageHeader title="Đổi mật khẩu" lede={`Tài khoản ${user?.username ?? ''}`} />
      <form onSubmit={submit} className="card flex max-w-sm flex-col gap-4">
        {fields}
      </form>
    </div>
  )
}
