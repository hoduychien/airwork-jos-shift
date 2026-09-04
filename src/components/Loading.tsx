import type { CSSProperties, ReactNode } from 'react'

/* Hallmark · component: loading · theme: custom "Console"
 * Ba mức: thanh tiến trình mỏng (đang gọi API), skeleton (tải lần đầu, chưa có gì để vẽ),
 * lớp phủ busy (đã có dữ liệu, đang tải lại / đang lưu — giữ nguyên bố cục, không giật). */

/** thanh tiến trình 2px ngay dưới thanh trên — hiện khi `active` */
export function LoadingBar({ active, label = 'Đang tải' }: { active: boolean; label?: string }) {
  if (!active) return null
  return <div className="loading-bar" role="progressbar" aria-label={label} aria-busy="true" />
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />
}

/** khối xám nhấp nháy giữ chỗ */
export function Skeleton({ w, h = '1rem', style, className = '' }: { w?: string | number; h?: string | number; style?: CSSProperties; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width: w ?? '100%', height: h, ...style }} aria-hidden />
}

/** skeleton cho bảng dữ liệu (n hàng × cột) */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-busy="true" aria-label="Đang tải dữ liệu">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>
                <Skeleton w="5rem" h="0.6rem" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <Skeleton w={c === 0 ? '9rem' : '6rem'} h="0.9rem" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** skeleton cho bảng lịch: đúng số hàng nhân viên và số cột ngày để không đổi chiều cao khi dữ liệu về */
export function GridSkeleton({ rows = 9, days = 31 }: { rows?: number; days?: number }) {
  return (
    <div className="grid-wrap" aria-busy="true" aria-label="Đang tải lịch">
      <table className="sched">
        <thead>
          <tr>
            <th className="rowhead">Nhân viên</th>
            {Array.from({ length: days }, (_, d) => (
              <th key={d}>
                <div style={{ fontSize: '0.6rem', color: 'var(--color-ink-3)' }}>&nbsp;</div>
                {d + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <td className="rowhead">
                <Skeleton w="6rem" h="0.85rem" />
              </td>
              {Array.from({ length: days }, (_, d) => (
                <td key={d}>
                  <span className="cell skeleton-cell" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** bọc nội dung đã có dữ liệu: khi `busy` phủ mờ + spinner, bố cục giữ nguyên */
export function Busy({ busy, label = 'Đang xử lý…', children }: { busy: boolean; label?: string; children: ReactNode }) {
  return (
    <div className="busy-wrap" data-busy={busy ? 'true' : undefined} aria-busy={busy || undefined}>
      {children}
      {busy && (
        <div className="busy-overlay" role="status">
          <Spinner size={18} />
          <span>{label}</span>
        </div>
      )}
    </div>
  )
}
