import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { store } from './store'
import { supabase } from './supabase'
import type { Notification } from './swap'

/**
 * Thông báo trong app cho người đang đăng nhập.
 *  - demo: đọc localStorage, làm mới mỗi 20s + khi đổi trang + khi tab được focus lại
 *  - Supabase: thêm realtime trên bảng notifications (user_id = mình)
 * Khi vào trang /thong-bao → đánh dấu đã đọc toàn bộ (sau khi đã hiển thị).
 */

interface NotificationsValue {
  items: Notification[]
  unread: number
  loading: boolean
  refresh(): Promise<void>
  markAllRead(): Promise<void>
  markRead(ids: string[]): Promise<void>
}

const Ctx = createContext<NotificationsValue | null>(null)
const POLL_MS = 20_000

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const userId = user?.id
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const list = await store.listNotifications(userId)
      if (alive.current) setItems(list)
    } catch {
      // thông báo là phụ — không chặn app khi lỗi
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // đổi trang / focus tab / định kỳ
  useEffect(() => {
    void refresh()
  }, [refresh, location.pathname])
  useEffect(() => {
    if (!userId) return
    const t = window.setInterval(() => void refresh(), POLL_MS)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId, refresh])

  // Supabase realtime
  useEffect(() => {
    if (!supabase || !userId) return
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe()
    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [userId, refresh])

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!userId || ids.length === 0) return
      setItems((list) => list.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)))
      try {
        await store.markNotificationsRead(userId, ids)
      } catch {
        void refresh()
      }
    },
    [userId, refresh],
  )
  const markAllRead = useCallback(
    () => markRead(items.filter((n) => !n.read).map((n) => n.id)),
    [items, markRead],
  )

  // vào trang thông báo: hiển thị xong rồi đánh dấu đã đọc (sau một nhịp để người dùng thấy dấu chưa đọc)
  useEffect(() => {
    if (location.pathname !== '/thong-bao') return
    if (!items.some((n) => !n.read)) return
    const t = window.setTimeout(() => void markAllRead(), 1500)
    return () => window.clearTimeout(t)
  }, [location.pathname, items, markAllRead])

  const value = useMemo<NotificationsValue>(
    () => ({ items, unread: items.filter((n) => !n.read).length, loading, refresh, markAllRead, markRead }),
    [items, loading, refresh, markAllRead, markRead],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications phải dùng bên trong <NotificationsProvider>')
  return ctx
}
