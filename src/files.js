import { supabase, hasSupabase } from './supabase'

// 파일을 클라우드 저장소에 올리고 첨부 메타데이터를 돌려준다.
// 저장 경로는 영문 uuid (한글 파일명은 키로 쓸 수 없음), 원본 이름은 메타데이터로 보존.
export async function uploadFile(f) {
  if (!hasSupabase) return null
  const { data } = await supabase.auth.getUser()
  const uid = data.user.id
  const ext = (f.name.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'bin'
  const path = `${uid}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('files')
    .upload(path, f, { contentType: f.type || 'application/octet-stream' })
  if (error) throw error
  return { name: f.name, path, size: f.size, ts: Date.now() }
}
