import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true khi chưa cấu hình Supabase — app chạy chế độ demo với localStorage */
export const isLocalMode = !url || !anonKey

export const supabase: SupabaseClient | null = isLocalMode
  ? null
  : createClient(url!, anonKey!)
