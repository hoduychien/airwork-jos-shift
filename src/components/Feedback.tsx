import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/* Hallmark · component: feedback (confirm modal + toast) · theme: custom "Console"
 * confirm(): modal thay cho window.confirm, trả Promise<boolean>. toast(): thông báo góc phải dưới,
 * tự tắt sau 3.5s, thành công im lặng (không chặn thao tác). */

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** hành động phá hủy (xóa, đặt lại) → nút xác nhận màu đỏ */
  danger?: boolean
}

export type ToastTone = 'ok' | 'danger' | 'info'
interface Toast {
  id: number
  tone: ToastTone
  text: string
}

interface FeedbackContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  toast: (text: string, tone?: ToastTone) => void
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve })
      }),
    [],
  )
  const close = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }

  const toast = useCallback((text: string, tone: ToastTone = 'ok') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, tone, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'danger' ? 6000 : 3500)
  }, [])

  // Esc = hủy, Enter = xác nhận
  useEffect(() => {
    if (!pending) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close(false)
      if (ev.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({ confirm, toast }), [confirm, toast])

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {pending && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) close(false)
          }}
        >
          <div className="modal confirm-modal" data-danger={pending.danger ? 'true' : undefined}>
            <div className="auth-head">
              <span>airwork-jos-shift</span>
              <span>{pending.danger ? 'xác nhận · nguy hiểm' : 'xác nhận'}</span>
            </div>
            <h2 id="confirm-title">{pending.title}</h2>
            {pending.message && <div className="confirm-msg">{pending.message}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
                {pending.cancelLabel ?? 'Hủy'}
              </button>
              <button
                type="button"
                className={`btn ${pending.danger ? 'btn-danger-solid' : 'btn-primary'}`}
                autoFocus
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? 'Đồng ý'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone} role="status">
            <span className="toast-mark" aria-hidden>
              {t.tone === 'ok' ? '✓' : t.tone === 'danger' ? '!' : 'i'}
            </span>
            <span>{t.text}</span>
            <button type="button" className="toast-close" aria-label="Đóng" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback phải dùng bên trong <FeedbackProvider>')
  return ctx
}
