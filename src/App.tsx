import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout'
import SchedulePage from './pages/SchedulePage'
import EmployeesPage from './pages/EmployeesPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
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
        <Route
          path="/cai-dat"
          element={
            <AdminOnly>
              <SettingsPage />
            </AdminOnly>
          }
        />
        <Route path="/doi-mat-khau" element={<ChangePasswordPage />} />
        <Route path="/loi/:code" element={<ErrorPreviewPage />} />
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
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
