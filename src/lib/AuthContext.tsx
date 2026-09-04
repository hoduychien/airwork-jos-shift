import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { authMode, localAuth, supabaseAuth, type AuthUser } from './auth'

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  /** lỗi khi tải phiên đăng nhập / vai trò (vd. Supabase không phản hồi) → màn 503 */
  loadError: unknown
  isAdmin: boolean
  /** demo: mã nhân viên + mật khẩu · Supabase: email + mật khẩu */
  login(username: string, password: string): Promise<void>
  logout(): Promise<void>
  changePassword(oldPassword: string, newPassword: string): Promise<void>
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)

  const refresh = useCallback(async () => {
    try {
      const u = authMode === 'local' ? await localAuth.currentUser() : await supabaseAuth.currentUser()
      setUser(u)
      setLoadError(null)
    } catch (err) {
      setLoadError(err)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (!supabase) return
    const { data: sub } = supabase.auth.onAuthStateChange(() => void refresh())
    return () => sub.subscription.unsubscribe()
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      loadError,
      isAdmin: user?.role === 'admin',
      async login(username, password) {
        if (authMode === 'local') {
          const u = await localAuth.login(username, password)
          setUser(u)
        } else {
          await supabaseAuth.login(username, password)
          await refresh()
        }
      },
      async logout() {
        if (authMode === 'local') localAuth.logout()
        else await supabaseAuth.logout()
        setUser(null)
      },
      async changePassword(oldPassword, newPassword) {
        if (!user) return
        if (authMode === 'local') {
          const u = await localAuth.changePassword(user.username, oldPassword, newPassword)
          setUser(u)
        } else {
          await supabaseAuth.changePassword(newPassword)
          await refresh()
        }
      },
      refresh,
    }),
    [user, ready, loadError, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth phải dùng bên trong <AuthProvider>')
  return ctx
}
