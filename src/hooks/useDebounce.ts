import { useEffect, useState } from 'react'

/** Trả về giá trị chỉ cập nhật sau khi `value` ngừng đổi trong `delay` ms — dùng cho ô tìm kiếm. */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
