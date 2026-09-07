import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout'
import SchedulePage from './pages/SchedulePage'
import EmployeesPage from './pages/EmployeesPage'
import LoginPage from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import AccountPage from './pages/AccountPage'
import RequestOffPage from './pages/RequestOffPage'
import ShiftSwapPage from './pages/ShiftSwapPage'
import NotificationsPage from './pages/NotificationsPage'
import { HandoverPage } from './pages/PendingPages'
import { NotificationsProvider } from './lib/NotificationsContext'
import { AppErrorBoundary, ErrorPreviewPage, ForbiddenPage, NotFoundPage, UnavailablePage } from './pages/ErrorPages'
import { FeedbackProvider } from './components/Feedback'

/** trang chỉ dành cho admin — thành viên thấy màn 403 thay vì bị đẩy đi lặng lẽ */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  return isAdmin ? <>{children}</> : <ForbiddenPage />
}

function Shell() {
  const { user, ready, loadError, refresh } = useAuth()
  if (loadError) return <UnavailablePage error={loadError} onRetry={() => void refresh()} />
  if (!ready) return null
  if (!user) return <LoginPage />
  // mật khẩu ban đầu → bắt đổi trước khi vào app
  if (user.mustChangePassword) return <ChangePasswordPage forced />

  return (
    <NotificationsProvider>
      <Layout>
        <Routes>
        <Route path="/" element={<SchedulePage />} />
        <Route
          path="/nhan-vien"
          element={
            <AdminOnly>
              <EmployeesPage />
            </AdminOnly>
          }
        />
        {/* cài đặt giờ là popover ở thanh trên — link cũ về bảng lịch */}
        <Route path="/cai-dat" element={<Navigate to="/" replace />} />
        <Route path="/xin-nghi" element={<RequestOffPage />} />
        <Route path="/doi-ca" element={<ShiftSwapPage />} />
        {/* màn hình chờ ra mắt — chỉ xem, chưa thao tác được */}
        <Route path="/ban-giao" element={<HandoverPage />} />
        <Route path="/tai-khoan" element={<AccountPage />} />
        <Route path="/doi-mat-khau" element={<Navigate to="/tai-khoan" replace />} />
        <Route path="/loi/:code" element={<ErrorPreviewPage />} />
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="/thong-bao" element={<NotificationsPage />} />
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </NotificationsProvider>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <FeedbackProvider>
          <Shell />
        </FeedbackProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}
