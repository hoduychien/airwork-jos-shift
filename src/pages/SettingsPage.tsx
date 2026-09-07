import { useEffect, useState } from 'react'
import { store } from '../lib/store'
import type { Settings } from '../lib/types'
import { DEFAULT_SETTINGS, SHIFT_LABELS, WORK_SHIFTS } from '../lib/types'
import PageHeader from '../components/PageHeader'
import Stepper from '../components/Stepper'
import { useFeedback } from '../components/Feedback'
import { Busy, LoadingBar, Spinner } from '../components/Loading'

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const { toast } = useFeedback()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void store
      .getSettings()
      .then(setS)
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await store.saveSettings(s)
      toast('Đã lưu cài đặt — áp dụng từ lần tạo lịch tiếp theo.')
    } finally {
      setSaving(false)
    }
  }

  const num = (v: string) => Math.max(0, Number(v) || 0)

  return (
    <div className="page">
      <LoadingBar active={loading || saving} />
      <PageHeader
        title="Cài đặt"
        lede="Tham số thuật toán chia ca — tài khoản & vai trò quản lý ở trang Nhân viên"
        actions={
          <>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || loading}
              data-loading={saving || undefined}
            >
              {saving && <Spinner size={14} />}
              {saving ? 'Đang lưu…' : 'Lưu cài đặt'}
            </button>
          </>
        }
      />

      <div>
        <Busy busy={loading} label="Đang tải cài đặt…">
          <section className="panel" aria-label="Tham số thuật toán">
            <div className="panel-head">
              <h2>Tham số thuật toán</h2>
              <p>Áp dụng từ lần «Tạo lịch» tiếp theo. Quy tắc cứng (cùng ca 2 ngày liền, nghỉ ≥ 16h) luôn được giữ.</p>
            </div>
            <div className="panel-body">
              <section className="form-section">
                <div>
                  <h3>Độ phủ</h3>
                  <p className="hint">
                    Số người tối thiểu trực mỗi ca, mỗi ngày — đặt riêng cho từng ca (vd S1, S2 cần 3
                    người, S3 chỉ cần 2).
                  </p>
                </div>
                <div className="form-row">
                  {WORK_SHIFTS.map((k) => (
                    <label key={k} className="field">
                      <span className="field-label">{SHIFT_LABELS[k]}</span>
                      <Stepper
                        value={s.min_per_shift[k]}
                        min={1}
                        max={10}
                        aria-label={`Số người ${k}`}
                        onChange={(v) => setS({ ...s, min_per_shift: { ...s.min_per_shift, [k]: v } })}
                      />
                    </label>
                  ))}
                  <span className="hint" style={{ alignSelf: 'end' }}>
                    Tổng {s.min_per_shift.S1 + s.min_per_shift.S2 + s.min_per_shift.S3} người/ngày
                  </span>
                </div>
              </section>

              <section className="form-section">
                <div>
                  <h3>Giờ các ca</h3>
                  <p className="hint">Chỉ để hiển thị, không ảnh hưởng thuật toán.</p>
                </div>
                <div className="form-row">
                  {(['S1', 'S2', 'S3'] as const).map((k) => (
                    <label key={k} className="field">
                      <span className="field-label">{k}</span>
                      <input
                        className="input"
                        style={{ width: '9rem' }}
                        value={s.shift_hours[k]}
                        onChange={(e) =>
                          setS({
                            ...s,
                            shift_hours: {
                              ...s.shift_hours,
                              [k]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="form-section">
                <div>
                  <h3>Chuỗi làm liên tục</h3>
                  <p className="hint">Số ngày làm liền nhau, cùng một ca.</p>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span className="field-label">Tối thiểu (ngày)</span>
                    <input
                      type="number"
                      className="input input-num"
                      min={1}
                      max={7}
                      value={s.streak_min}
                      onChange={(e) => setS({ ...s, streak_min: num(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Tối đa (ngày)</span>
                    <input
                      type="number"
                      className="input input-num"
                      min={2}
                      max={10}
                      value={s.streak_max}
                      onChange={(e) => setS({ ...s, streak_max: num(e.target.value) })}
                    />
                  </label>
                </div>
              </section>

              <section className="form-section">
                <div>
                  <h3>Nghỉ giữa 2 chuỗi</h3>
                  <p className="hint">Mục tiêu mềm khi xếp; nghỉ dài hơn vẫn hợp lệ.</p>
                </div>
                <div className="form-row">
                  <label className="field">
                    <span className="field-label">Tối thiểu (ngày)</span>
                    <input
                      type="number"
                      className="input input-num"
                      min={1}
                      max={4}
                      value={s.rest_min}
                      onChange={(e) => setS({ ...s, rest_min: num(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Tối đa (ngày)</span>
                    <input
                      type="number"
                      className="input input-num"
                      min={1}
                      max={5}
                      value={s.rest_max}
                      onChange={(e) => setS({ ...s, rest_max: num(e.target.value) })}
                    />
                  </label>
                </div>
              </section>
            </div>
            <div className="panel-foot">
              Cấm mọi chuyển ca S2→S1, S3→S2, S3→S1 giữa 2 ngày liền kề — không cấu hình được.
            </div>
          </section>
        </Busy>
      </div>
    </div>
  )
}
