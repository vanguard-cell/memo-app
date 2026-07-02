import { createClient } from '@supabase/supabase-js'

// Supabase 프로젝트 연결 정보. anon key는 공개되어도 안전한 키다 (RLS가 데이터를 보호).
// 프로젝트 생성 후 여기에 채운다. 비어 있으면 앱은 로컬 전용 모드로 동작한다.
const SUPABASE_URL = 'https://vfnwworlsricfxyxditc.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmbnd3b3Jsc3JpY2Z4eXhkaXRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MjM1MTgsImV4cCI6MjA5ODQ5OTUxOH0.xXwDp4lSQ0FiKe2bCWTo28OOYUJtUuSmwX9YINE8has'

export const hasSupabase = SUPABASE_URL.startsWith('https://')
export const supabase = hasSupabase ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null
