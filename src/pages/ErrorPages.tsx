import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

/* Hallmark · component: error-screen · theme: custom "Console"
 * Một mẫu cho mọi mã lỗi: dòng mono đầu panel, mã lỗi lớn, tiêu đề, giải thích, hành động.
 * Tông màu theo mức độ: 404 mực · 403 cảnh báo · 500 nguy hiểm · 503 cảnh báo. */

export type ErrorCode = 404 | 403 | 500 | 503 | 401

interface ErrorScreenProps {
  code: ErrorCode
  title: string
  message: ReactNode
  /** chi tiết kỹ thuật (thông báo lỗi, stack) — thu gọn mặc định */
  detail?: string
  actions?: ReactNode
}

const TONE: Record<ErrorCode, 'ink' | 'warn' | 'danger'> = {
  404: 'ink',
  401: 'warn',
  403: 'warn',
  500: 'danger',
  503: 'warn',
}

const LABEL: Record<ErrorCode, string> = {
  404: 'not found',
  401: 'unauthorized',
  403: 'forbidden',
  500: 'internal error',
  503: 'service unavailable',
}

export function ErrorScreen({ code, title, message, detail, actions }: ErrorScreenProps) {
  const [open, setOpen] = useState(false)
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  const stamp = new Date().toLocaleString('vi-VN')
  return (
    <div className="error-wrap" role="alert" aria-live="assertive">
      <div className="error-panel" data-tone={TONE[code]}>
        <div className="auth-head">
          <span className="flex items-center gap-2">
            <span className="user-avatar" aria-hidden style={{ background: 'var(--color-accent)' }}>
              AW
            </span>
            airwork-jos-shift
          </span>
          <span>
            lỗi · {code} {LABEL[code]}
          </span>
        </div>

        <div className="error-code" aria-hidden>
          {code}
        </div>
        <div>
          <h1>{title}</h1>
          <p className="error-msg">{message}</p>
        </div>

        <div className="error-meta mono">
          <span>path {path || '/'}</span>
          <span>{stamp}</span>
        </div>

        {detail && (
          <div>
            <button type="button" className="link-quiet" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? '▾ Ẩn chi tiết kỹ thuật' : '▸ Chi tiết kỹ thuật'}
            </button>
            {open && <pre className="error-detail">{detail}</pre>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  )
}

// ---------------- các màn hình cụ thể ----------------

export function NotFoundPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <ErrorScreen
      code={404}
      title="Không tìm thấy trang"
      message={
        <>
          Đường dẫn <code className="mono">{pathname}</code> không tồn tại hoặc đã bị đổi.
        </>
      }
      actions={
        <>
          <Link to="/" className="btn btn-primary">
            Về bảng lịch
          </Link>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>
            Quay lại
          </button>
        </>
      }
    />
  )
}

export function ForbiddenPage() {
  const { user, logout } = useAuth()
  return (
    <ErrorScreen
      code={403}
      title="Bạn không có quyền vào trang này"
      message={
        <>
          Trang này chỉ dành cho <strong>admin</strong>. Tài khoản <strong>{user?.username}</strong> đang ở vai trò{' '}
          {user?.role === 'admin' ? 'admin' : 'thành viên'}. Nếu bạn cần quyền, nhờ admin đổi vai trò trong Cài đặt.
        </>
      }
      actions={
        <>
          <Link to="/" className="btn btn-primary">
            Về bảng lịch
          </Link>
          <button className="btn btn-ghost" onClick={() => void logout()}>
            Đăng nhập tài khoản khác
          </button>
        </>
      }
    />
  )
}

export function UnauthorizedPage() {
  const { logout } = useAuth()
  return (
    <ErrorScreen
      code={401}
      title="Phiên đăng nhập đã hết hạn"
      message="Vui lòng đăng nhập lại để tiếp tục. Dữ liệu chưa lưu có thể bị mất."
      actions={
        <button className="btn btn-primary" onClick={() => void logout()}>
          Đăng nhập lại
        </button>
      }
    />
  )
}

export function ServerErrorPage({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : error ? String(error) : undefined
  return (
    <ErrorScreen
      code={500}
      title="Có lỗi xảy ra trong ứng dụng"
      message="Một thao tác vừa rồi làm ứng dụng gặp lỗi không mong muốn. Thử tải lại; nếu vẫn lỗi, gửi phần chi tiết kỹ thuật bên dưới cho người quản trị."
      detail={detail}
      actions={
        <>
          <button className="btn btn-primary" onClick={() => (onRetry ? onRetry() : window.location.reload())}>
            Tải lại
          </button>
          <Link to="/" className="btn btn-ghost" onClick={onRetry}>
            Về bảng lịch
          </Link>
        </>
      }
    />
  )
}

export function UnavailablePage({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : error ? String(error) : undefined
  return (
    <ErrorScreen
      code={503}
      title={offline ? 'Bạn đang ngoại tuyến' : 'Không kết nối được máy chủ dữ liệu'}
      message={
        offline
          ? 'Thiết bị không có kết nối mạng. Kiểm tra Wi‑Fi / 4G rồi thử lại.'
          : 'Máy chủ dữ liệu (Supabase) không phản hồi hoặc đang bảo trì. Lịch đã chốt vẫn xem được khi kết nối trở lại.'
      }
      detail={detail}
      actions={
        <>
          <button className="btn btn-primary" onClick={() => (onRetry ? onRetry() : window.location.reload())}>
            Thử lại
          </button>
          <Link to="/" className="btn btn-ghost">
            Về bảng lịch
          </Link>
        </>
      }
    />
  )
}

/** lỗi mạng / máy chủ không phản hồi → 503, còn lại → 500 */
export function isUnavailableError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = (err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '')).toLowerCase()
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|503|502|504|timeout|econn|unavailable/.test(msg)
}

// ---------------- Error boundary: bắt lỗi render/runtime → 500, lỗi mạng → 503 ----------------

interface BoundaryProps {
  children: ReactNode
}
interface BoundaryState {
  error: unknown
}

export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[airwork-jos-shift] lỗi giao diện', error, info.componentStack)
  }

  componentDidMount() {
    window.addEventListener('unhandledrejection', this.onRejection)
  }
  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.onRejection)
  }
  /** promise bị từ chối không ai bắt (tải dữ liệu thất bại) cũng đưa về màn lỗi */
  private onRejection = (ev: PromiseRejectionEvent) => {
    this.setState({ error: ev.reason ?? new Error('Unhandled rejection') })
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (error) {
      return isUnavailableError(error) ? (
        <UnavailablePage error={error} onRetry={this.reset} />
      ) : (
        <ServerErrorPage error={error} onRetry={this.reset} />
      )
    }
    return this.props.children
  }
}

/** /loi/:code — xem trước từng màn lỗi (dùng cho QA) */
export function ErrorPreviewPage() {
  const { code } = useParams()
  switch (code) {
    case '403':
      return <ForbiddenPage />
    case '401':
      return <UnauthorizedPage />
    case '500':
      return <ServerErrorPage error={new Error('Ví dụ: Cannot read properties of undefined (reading "matrix")')} />
    case '503':
      return <UnavailablePage error={new TypeError('Failed to fetch')} />
    default:
      return <NotFoundPage />
  }
}
