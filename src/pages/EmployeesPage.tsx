import { useCallback, useEffect, useState } from 'react'
import AppSelect from '../components/AppSelect'
import PageHeader from '../components/PageHeader'
import { Busy, LoadingBar, TableSkeleton } from '../components/Loading'
import { store } from '../lib/store'
import { ACCOUNT_EMAIL_DOMAIN, accountsApi, type AccountInfo } from '../lib/accounts'
import { DEFAULT_PASSWORD, authMode, type Role } from '../lib/auth'
import { useAuth } from '../lib/AuthContext'
import { useFeedback } from '../components/Feedback'
import type { Employee } from '../lib/types'
import { applyMonthData, daysInMonth, prefsOf } from '../lib/types'

const now = new Date()

function newEmployee(order: number): Employee {
  return {
    id: crypto.randomUUID(),
    name: '',
    code: '',
    display_order: order,
    prefer_night: false,
    min_night_shifts: 0,
    no_s1: false,
    no_s2: false,
    no_s3: false,
    max_shifts_per_month: 21,
    active: true,
    days_off: [],
  }
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [editing, setEditing] = useState<Employee | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // hồ sơ gốc (mặc định) + tập nhân viên đã có thiết lập riêng cho tháng đang chọn
  const [baseEmployees, setBaseEmployees] = useState<Employee[]>([])
  const [overridden, setOverridden] = useState<Set<string>>(new Set())
  // tài khoản đăng nhập gắn với từng nhân viên (vai trò, mật khẩu) — quản lý ngay tại đây
  const { user, refresh } = useAuth()
  const { confirm, toast } = useFeedback()
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [accError, setAccError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, dayoffs, prefs, accs] = await Promise.all([
        store.listEmployees(),
        store.getDayOffs(month, year),
        store.getMonthPrefs(month, year),
        accountsApi.list().catch((err: unknown) => {
          setAccError(err instanceof Error ? err.message : 'Không tải được tài khoản.')
          return [] as AccountInfo[]
        }),
      ])
      setBaseEmployees(emps)
      setEmployees(applyMonthData(emps, prefs, dayoffs))
      setOverridden(new Set(Object.keys(prefs)))
      setAccounts(accs)
    } finally {
      setLoading(false)
    }
  }, [month, year])

  const flash = (msg: string) => toast(msg, 'ok')
  /** chạy một thao tác tài khoản: khóa bảng, tải lại, báo kết quả */
  const runAcc = async (fn: () => Promise<void>, ok: string) => {
    setAccError('')
    setSaving(true)
    try {
      await fn()
      await load()
      flash(ok)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Thao tác thất bại.'
      setAccError(msg)
      toast(msg, 'danger')
    } finally {
      setSaving(false)
    }
  }
  const accountFor = (e: Employee) => accounts.find((a) => a.employeeId === e.id)
  const isMe = (a: AccountInfo) => a.id === user?.id || a.username === user?.username
  const setRole = (a: AccountInfo, role: Role) =>
    runAcc(
      async () => {
        await accountsApi.setRole(a.id, role)
        if (isMe(a)) await refresh()
      },
      `Đã đổi vai trò ${a.username} → ${role === 'admin' ? 'Admin' : 'Thành viên'}.`,
    )
  const resetPassword = async (a: AccountInfo) => {
    const ok = await confirm({
      title: `Đặt lại mật khẩu của ${a.username}?`,
      message: `Mật khẩu sẽ về ${DEFAULT_PASSWORD} và người này phải đổi ở lần đăng nhập sau.`,
      confirmLabel: 'Đặt lại',
      danger: true,
    })
    if (!ok) return
    void runAcc(async () => {
      await accountsApi.resetPassword(a.id)
      if (isMe(a)) await refresh()
    }, `Đã đặt lại mật khẩu ${a.username} về ${DEFAULT_PASSWORD} — phải đổi ở lần đăng nhập sau.`)
  }
  const createAccount = (e: Employee) =>
    runAcc(
      () => accountsApi.ensureAccount(accountsApi.loginFor(e.code), e.id),
      `Đã tạo tài khoản ${accountsApi.loginFor(e.code)} (mật khẩu ${DEFAULT_PASSWORD}).`,
    )
  const linkAccount = (a: AccountInfo, employeeId: string) =>
    runAcc(async () => {
      await accountsApi.setEmployee(a.id, employeeId || null)
      if (isMe(a)) await refresh()
    }, `Đã gắn ${a.username} với nhân viên.`)
  const employeeIds = new Set(employees.map((e) => e.id))
  const unlinked = accounts.filter((a) => !a.employeeId || !employeeIds.has(a.employeeId))
  const missingCount = employees.filter((e) => !accountFor(e) && e.code.trim()).length

  useEffect(() => {
    void load()
  }, [load])

  const save = async (e: Employee) => {
    setSaving(true)
    try {
      // hồ sơ gốc: tên, mã, thứ tự; ràng buộc ca trên hồ sơ chỉ là MẶC ĐỊNH cho tháng chưa cấu hình —
      // nhân viên mới lấy ràng buộc vừa nhập làm mặc định, nhân viên cũ giữ nguyên mặc định
      const base = baseEmployees.find((b) => b.id === e.id)
      await store.upsertEmployee(
        base ? { ...base, name: e.name, code: e.code, display_order: e.display_order, active: e.active } : e,
      )
      // ràng buộc ca của THÁNG đang chọn
      await store.saveMonthPrefs(e.id, month, year, prefsOf(e))
      // nhân viên mới có ngay tài khoản (demo: mã NV · Supabase: <mã>@domain) / 123456, member
      if (e.code.trim()) {
        try {
          await accountsApi.ensureAccount(accountsApi.loginFor(e.code), e.id)
        } catch (err) {
          console.warn('Không tạo được tài khoản cho nhân viên:', err)
        }
      }
      await store.saveDayOffs(e.id, month, year, e.days_off)
      setEditing(null)
      await load()
      toast(`Đã lưu ${e.name} — ràng buộc áp dụng cho tháng ${month}/${year}.`)
    } finally {
      setSaving(false)
    }
  }

  /** sao chép thiết lập ràng buộc ca của tháng trước sang tháng này cho mọi nhân viên */
  const copyFromPrevMonth = async () => {
    const prev = new Date(year, month - 2, 1)
    const pm = prev.getMonth() + 1
    const py = prev.getFullYear()
    const ok = await confirm({
      title: `Sao chép ràng buộc ca từ tháng ${pm}/${py}?`,
      message: `Ràng buộc ca (ưu tiên đêm, cấm ca, số ca tối đa) của tháng ${pm}/${py} sẽ ghi đè thiết lập tháng ${month}/${year} cho tất cả nhân viên. Ngày nghỉ không bị ảnh hưởng.`,
      confirmLabel: 'Sao chép',
    })
    if (!ok) return
    setSaving(true)
    try {
      const [prevPrefs, prevOffs] = await Promise.all([store.getMonthPrefs(pm, py), store.getDayOffs(pm, py)])
      const prevEmps = applyMonthData(baseEmployees, prevPrefs, prevOffs)
      for (const e of prevEmps) await store.saveMonthPrefs(e.id, month, year, prefsOf(e))
      await load()
      toast(`Đã sao chép ràng buộc ca từ tháng ${pm}/${py}.`)
    } finally {
      setSaving(false)
    }
  }
  /** bỏ thiết lập riêng của tháng → quay về mặc định trên hồ sơ */
  const resetToDefault = async (e: Employee) => {
    const ok = await confirm({
      title: `Bỏ thiết lập riêng tháng ${month}/${year} của ${e.name}?`,
      message: 'Tháng này sẽ dùng lại ràng buộc mặc định trên hồ sơ.',
      confirmLabel: 'Bỏ thiết lập',
    })
    if (!ok) return
    setSaving(true)
    try {
      await store.clearMonthPrefs(e.id, month, year)
      await load()
      toast(`${e.name}: tháng ${month}/${year} dùng lại mặc định.`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (e: Employee) => {
    const ok = await confirm({
      title: `Xóa nhân viên ${e.name}?`,
      message: 'Người này sẽ không còn xuất hiện trên bảng lịch các tháng sau. Lịch đã chốt không đổi.',
      confirmLabel: 'Xóa',
      danger: true,
    })
    if (!ok) return
    setSaving(true)
    try {
      await store.deleteEmployee(e.id)
      await load()
      toast(`Đã xóa nhân viên ${e.name}.`)
    } finally {
      setSaving(false)
    }
  }

  const onDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const ids = employees.map((e) => e.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ...ids.splice(from, 1))
    setEmployees(ids.map((id) => employees.find((e) => e.id === id)!))
    setDragId(null)
    await store.saveOrder(ids)
  }

  const prefChips = (e: Employee) => {
    const chips: { label: string; tone: string }[] = []
    if (e.prefer_night) chips.push({ label: `Ưu tiên đêm ≥${e.min_night_shifts}`, tone: 'chip-accent' })
    if (e.no_s1) chips.push({ label: 'Không S1', tone: '' })
    if (e.no_s2) chips.push({ label: 'Không S2', tone: '' })
    if (e.no_s3) chips.push({ label: 'Không S3', tone: '' })
    return chips
  }
  const initials = (name: string) =>
    name
      .split(' ')
      .slice(-2)
      .map((w) => w[0])
      .join('')
      .toUpperCase()

  return (
    <div className="page">
      <LoadingBar active={loading || saving} />
      <PageHeader
        title="Nhân viên"
        lede={`Hồ sơ · ràng buộc ca · tài khoản đăng nhập (${authMode === 'local' ? 'mã NV' : `<mã>@${ACCOUNT_EMAIL_DOMAIN}`} / ${DEFAULT_PASSWORD}). Kéo thả để sắp thứ tự trên bảng lịch.`}
        actions={
          <>
            {missingCount > 0 && (
              <button
                className="btn btn-ghost"
                disabled={saving}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Tạo ${missingCount} tài khoản còn thiếu?`,
                    message: `Mỗi tài khoản dùng mật khẩu ban đầu ${DEFAULT_PASSWORD} và phải đổi ở lần đăng nhập đầu.`,
                    confirmLabel: 'Tạo tài khoản',
                  })
                  if (!ok) return
                  void runAcc(async () => {
                    for (const e of employees) {
                      if (!accountFor(e) && e.code.trim())
                        await accountsApi.ensureAccount(accountsApi.loginFor(e.code), e.id)
                    }
                  }, `Đã tạo ${missingCount} tài khoản.`)
                }}
              >
                Tạo {missingCount} tài khoản thiếu
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setEditing(newEmployee(employees.length + 1))}>
              + Thêm nhân viên
            </button>
          </>
        }
      />

      <div className="toolbar">
        <span className="field-label">Ràng buộc & ngày nghỉ của tháng</span>
        <AppSelect
          aria-label="Tháng"
          width="8.75rem"
          options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: m, label: `Tháng ${m}` }))}
          value={month}
          onChange={setMonth}
        />
        <AppSelect
          aria-label="Năm"
          width="6rem"
          options={[year - 1, year, year + 1]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((y) => ({ value: y, label: String(y) }))}
          value={year}
          onChange={setYear}
        />
        <button className="btn btn-ghost btn-sm" disabled={saving || loading} onClick={() => void copyFromPrevMonth()}>
          Sao chép từ tháng trước
        </button>
        <span className="toolbar-spacer" />
        {accError && (
          <span className="alert alert-danger" role="alert" style={{ padding: '0.3rem 0.7rem' }}>
            {accError}
          </span>
        )}
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>{employees.length} người</span>
      </div>

      {loading && employees.length === 0 ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <Busy busy={loading || saving} label={saving ? 'Đang lưu…' : 'Đang tải…'}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '2rem' }} aria-label="Sắp xếp" />
                  <th>Nhân viên</th>
                  <th>Ràng buộc (T{month})</th>
                  <th>Nghỉ cố định (T{month})</th>
                  <th className="num">Tối đa</th>
                  <th>Tài khoản</th>
                  <th>Vai trò</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const chips = prefChips(e)
                  const acc = accountFor(e)
                  return (
                    <tr
                      key={e.id}
                      data-active={acc && isMe(acc) ? 'true' : undefined}
                      draggable
                      onDragStart={() => setDragId(e.id)}
                      onDragOver={(ev) => ev.preventDefault()}
                      onDrop={() => onDrop(e.id)}
                      style={dragId === e.id ? { opacity: 0.5 } : undefined}
                    >
                      <td>
                        <span className="drag-handle" aria-hidden>
                          ⠿
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className="avatar-sm">{initials(e.name)}</span>
                          <span className="min-w-0">
                            <span
                              style={{
                                display: 'block',
                                fontFamily: 'var(--font-display)',
                                fontWeight: 600,
                                lineHeight: 1.2,
                              }}
                            >
                              {e.name}
                            </span>
                            <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
                              {e.code}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1">
                          {chips.length === 0 ? (
                            <span style={{ color: 'var(--color-ink-3)' }}>Làm cả 3 ca</span>
                          ) : (
                            chips.map((c) => (
                              <span key={c.label} className={`chip ${c.tone}`}>
                                {c.label}
                              </span>
                            ))
                          )}
                          {overridden.has(e.id) ? (
                            <button
                              type="button"
                              className="chip chip-ok"
                              title={`Thiết lập riêng cho tháng ${month}/${year} — bấm để bỏ, dùng lại mặc định`}
                              style={{ border: 0, cursor: 'pointer' }}
                              onClick={() => void resetToDefault(e)}
                            >
                              T{month} ×
                            </button>
                          ) : (
                            <span
                              className="chip"
                              title="Chưa cấu hình riêng cho tháng này — đang dùng mặc định trên hồ sơ"
                            >
                              mặc định
                            </span>
                          )}
                        </span>
                      </td>
                      <td
                        className="mono"
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: e.days_off.length ? 'var(--color-ink)' : 'var(--color-ink-3)',
                        }}
                      >
                        {e.days_off.length ? e.days_off.join(', ') : '—'}
                      </td>
                      <td className="num">{e.max_shifts_per_month}</td>
                      <td>
                        {acc ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>
                              {acc.username}
                            </span>
                            {isMe(acc) && <span className="chip chip-accent">bạn</span>}
                            {acc.mustChangePassword ? (
                              <span className="chip chip-warn" title="Đang dùng mật khẩu ban đầu">
                                MK ban đầu
                              </span>
                            ) : (
                              <span className="chip chip-ok">Đã đổi MK</span>
                            )}
                          </span>
                        ) : e.code.trim() ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={saving}
                            onClick={() => void createAccount(e)}
                          >
                            Tạo tài khoản
                          </button>
                        ) : (
                          <span style={{ color: 'var(--color-ink-3)' }}>—</span>
                        )}
                      </td>
                      <td>
                        {acc ? (
                          <AppSelect
                            aria-label={`Vai trò của ${acc.username}`}
                            width="8.75rem"
                            value={acc.role}
                            disabled={saving}
                            onChange={(v) => void setRole(acc, v)}
                            options={[
                              { value: 'admin', label: 'Admin' },
                              { value: 'member', label: 'Thành viên' },
                            ]}
                          />
                        ) : (
                          <span style={{ color: 'var(--color-ink-3)' }}>—</span>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditing({ ...e, days_off: [...e.days_off] })}
                        >
                          Sửa
                        </button>
                        {acc && (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={saving}
                            title="Đặt lại mật khẩu về ban đầu"
                            onClick={() => resetPassword(acc)}
                          >
                            Đặt lại MK
                          </button>
                        )}
                        <button className="btn btn-danger btn-sm" onClick={() => remove(e)}>
                          Xóa
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Busy>
      )}

      {unlinked.length > 0 && (
        <section className="panel" aria-label="Tài khoản chưa gắn nhân viên">
          <div className="panel-head">
            <h2>Tài khoản chưa gắn nhân viên</h2>
            <p>Những tài khoản này đăng nhập được nhưng chưa thuộc về ai trên bảng lịch. Chọn nhân viên để gắn.</p>
          </div>
          <div className="panel-body">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tài khoản</th>
                    <th>Vai trò</th>
                    <th>Gắn với nhân viên</th>
                    <th className="actions" />
                  </tr>
                </thead>
                <tbody>
                  {unlinked.map((a) => (
                    <tr key={a.id} data-active={isMe(a) ? 'true' : undefined}>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className="avatar-sm">{a.username.slice(0, 2).toUpperCase()}</span>
                          <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>
                            {a.username}
                          </span>
                          {isMe(a) && <span className="chip chip-accent">bạn</span>}
                        </span>
                      </td>
                      <td>
                        <AppSelect
                          aria-label={`Vai trò của ${a.username}`}
                          width="8.75rem"
                          value={a.role}
                          disabled={saving}
                          onChange={(v) => void setRole(a, v)}
                          options={[
                            { value: 'admin', label: 'Admin' },
                            { value: 'member', label: 'Thành viên' },
                          ]}
                        />
                      </td>
                      <td>
                        <AppSelect
                          aria-label={`Nhân viên gắn với ${a.username}`}
                          width="10rem"
                          value=""
                          disabled={saving}
                          onChange={(v) => void linkAccount(a, v)}
                          options={[
                            { value: '', label: '— chọn —' },
                            ...employees.map((e) => ({ value: e.id, label: e.name })),
                          ]}
                        />
                      </td>
                      <td className="actions">
                        <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => resetPassword(a)}>
                          Đặt lại MK
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {editing && (
        <EmployeeForm employee={editing} month={month} year={year} onSave={save} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}

function EmployeeForm({
  employee,
  month,
  year,
  onSave,
  onCancel,
}: {
  employee: Employee
  month: number
  year: number
  onSave: (e: Employee) => void
  onCancel: () => void
}) {
  const [e, setE] = useState(employee)
  const D = daysInMonth(month, year)
  const set = (patch: Partial<Employee>) => setE((prev) => ({ ...prev, ...patch }))

  const toggleDay = (d: number) =>
    set({
      days_off: e.days_off.includes(d) ? e.days_off.filter((x) => x !== d) : [...e.days_off, d].sort((a, b) => a - b),
    })

  const invalid = e.name.trim() === '' || e.code.trim() === '' || (e.no_s1 && e.no_s2 && e.no_s3)

  return (
    <div
      className="modal-backdrop overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={employee.name ? `Sửa ${employee.name}` : 'Thêm nhân viên'}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onCancel()
      }}
    >
      <div className="modal modal-wide">
        <div className="auth-head">
          <span>nhân viên</span>
          <span className="eyebrow">tháng {month}/{year}</span>
        </div>
        <h2 style={{ fontSize: 'var(--text-lg)' }}>{employee.name ? `Sửa — ${employee.name}` : 'Thêm nhân viên'}</h2>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <label className="field">
              <span className="field-label">Họ tên</span>
              <input
                className="input"
                value={e.name}
                onChange={(ev) => set({ name: ev.target.value })}
                aria-invalid={e.name.trim() === '' || undefined}
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">Mã NV</span>
              <input className="input" value={e.code} onChange={(ev) => set({ code: ev.target.value })} />
            </label>
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="field-label" style={{ marginBottom: 'var(--space-2xs)' }}>
              Ràng buộc ca — tháng {month}/{year} (chỉ áp dụng cho tháng này)
            </legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={e.prefer_night}
                onChange={(ev) =>
                  set({
                    prefer_night: ev.target.checked,
                    min_night_shifts: ev.target.checked ? e.min_night_shifts || 16 : 0,
                  })
                }
              />
              Ưu tiên ca đêm (S3) — tối thiểu
              <input
                type="number"
                className="input input-num"
                style={{ width: '3.5rem' }}
                min={0}
                max={26}
                disabled={!e.prefer_night}
                value={e.min_night_shifts}
                onChange={(ev) => set({ min_night_shifts: Number(ev.target.value) })}
                aria-label="Số ca đêm tối thiểu mỗi tháng"
              />
              ca đêm/tháng (vẫn có 2-3 ca S1, S2)
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={e.no_s1} onChange={(ev) => set({ no_s1: ev.target.checked })} />
              Không làm ca S1 (sáng)
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={e.no_s2} onChange={(ev) => set({ no_s2: ev.target.checked })} />
              Không làm ca S2 (chiều)
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={e.no_s3} onChange={(ev) => set({ no_s3: ev.target.checked })} />
              Không làm ca S3 (đêm)
            </label>
            {e.no_s1 && e.no_s2 && e.no_s3 && (
              <p className="alert alert-danger" style={{ marginTop: 'var(--space-xs)' }}>
                Không thể chặn cả 3 ca — người này sẽ không xếp được lịch.
              </p>
            )}
          </fieldset>

          <label className="field" style={{ maxWidth: '14rem' }}>
            <span className="field-label">Số ca tối đa/tháng</span>
            <input
              type="number"
              className="input input-num"
              min={0}
              max={31}
              value={e.max_shifts_per_month}
              onChange={(ev) => set({ max_shifts_per_month: Number(ev.target.value) })}
            />
          </label>

          <div className="field">
            <span className="field-label">
              Ngày nghỉ cố định — tháng {month}/{year} ({e.days_off.length} ngày)
            </span>
            <div className="grid grid-cols-7 gap-1 sm:grid-cols-10">
              {Array.from({ length: D }, (_, i) => i + 1).map((d) => {
                const on = e.days_off.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(d)}
                    className="rounded-md py-1 text-center text-xs font-semibold transition-colors"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      border: '1px solid var(--color-line-strong)',
                      background: on ? 'var(--color-accent)' : 'white',
                      color: on ? 'var(--color-accent-ink)' : 'var(--color-ink-2)',
                      cursor: 'pointer',
                    }}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={onCancel}>
              Hủy
            </button>
            <button className="btn btn-primary" disabled={invalid} onClick={() => onSave(e)}>
              Lưu
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
