import { useEffect, useState } from 'react'
import { store } from '../lib/store'
import type { Settings } from '../lib/types'
import { DEFAULT_SETTINGS, SHIFT_LABELS, WORK_SHIFTS } from '../lib/types'
import { useFeedback } from './Feedback'
import { Spinner } from './Loading'
import Stepper from './Stepper'

/* Cài đặt thuật toán chia ca — nội dung popover ở thanh trên (giống popup thông báo).
 * Tải khi mở, lưu bằng nút ở chân; đóng popover do Topbar xử lý. */

export default function SettingsPopover({ onDone }: { onDone: () => void }) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { toast } = useFeedback()

  useEffect(() => {
    let alive = true
    void store
      .getSettings()
      .then((v) => {
        if (alive) setS(v)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const patch = (p: Partial<Settings>) => {
    setS((prev) => ({ ...prev, ...p }))
    setDirty(true)
  }
  const save = async () => {
    setSaving(true)
    try {
      await store.saveSettings(s)
      setDirty(false)
      toast('Đã lưu cài đặt — áp dụng từ lần tạo lịch tiếp theo.')
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const total = s.min_per_shift.S1 + s.min_per_shift.S2 + s.min_per_shift.S3

  return (
    <>
      <div className="popover-head">
        <strong>Cài đặt chia ca</strong>
        <span className="notif-body">Áp dụng từ lần «Tạo lịch» tiếp theo</span>
      </div>

      <div className="popover-scroll settings-pop" aria-busy={loading || undefined}>
        <section className="settings-pop-group">
          <div className="settings-pop-title">
            <h4>Số người mỗi ca</h4>
            <span className="settings-pop-sum">{total} người/ngày</span>
          </div>
          {WORK_SHIFTS.map((k) => (
            <div key={k} className="settings-pop-row">
              <span>
                <span className="settings-pop-label">{SHIFT_LABELS[k]}</span>
                <span className="settings-pop-hint">{s.shift_hours[k]}</span>
              </span>
              <Stepper
                size="sm"
                min={1}
                max={10}
                disabled={loading}
                value={s.min_per_shift[k]}
                aria-label={`Số người ${k}`}
                onChange={(v) => patch({ min_per_shift: { ...s.min_per_shift, [k]: v } })}
              />
            </div>
          ))}
        </section>

        <section className="settings-pop-group">
          <div className="settings-pop-title">
            <h4>Chuỗi làm liên tục</h4>
            <span className="settings-pop-sum">ngày liền, cùng một ca</span>
          </div>
          <div className="settings-pop-row">
            <span className="settings-pop-label">Tối thiểu</span>
            <Stepper size="sm" min={1} max={7} disabled={loading} value={s.streak_min} suffix="ngày" aria-label="Chuỗi làm tối thiểu" onChange={(v) => patch({ streak_min: v })} />
          </div>
          <div className="settings-pop-row">
            <span className="settings-pop-label">Tối đa</span>
            <Stepper size="sm" min={2} max={10} disabled={loading} value={s.streak_max} suffix="ngày" aria-label="Chuỗi làm tối đa" onChange={(v) => patch({ streak_max: v })} />
          </div>
        </section>

        <section className="settings-pop-group">
          <div className="settings-pop-title">
            <h4>Nghỉ giữa 2 chuỗi</h4>
            <span className="settings-pop-sum">mục tiêu mềm khi xếp</span>
          </div>
          <div className="settings-pop-row">
            <span className="settings-pop-label">Tối thiểu</span>
            <Stepper size="sm" min={1} max={4} disabled={loading} value={s.rest_min} suffix="ngày" aria-label="Nghỉ tối thiểu" onChange={(v) => patch({ rest_min: v })} />
          </div>
          <div className="settings-pop-row">
            <span className="settings-pop-label">Tối đa</span>
            <Stepper size="sm" min={1} max={5} disabled={loading} value={s.rest_max} suffix="ngày" aria-label="Nghỉ tối đa" onChange={(v) => patch({ rest_max: v })} />
          </div>
        </section>

        <p className="settings-pop-note">
          Quy tắc cứng luôn giữ: 2 ngày làm liền cùng ca, nghỉ ≥ 16h, không chuyển S2→S1, S3→S2, S3→S1 liền kề.
        </p>
      </div>

      <div className="popover-foot settings-pop-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Đóng
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={loading || saving || !dirty}
          data-loading={saving || undefined}
          onClick={() => void save()}
        >
          {saving && <Spinner size={12} />}
          {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
        </button>
      </div>
    </>
  )
}
