import { supabase, hasSupabase } from './supabase'

// 파일 첨부 저장소 (2026-07-15 제거했다가 2026-07-31 부활 — 캡처·미리보기·다운로드 요청).
// 실물은 Supabase Storage 'files' 버킷에, 메타데이터(name·path·size·type)는 메모에 실려 동기화된다.
// 저장 경로는 영문 uuid (한글 파일명은 키로 쓸 수 없음), 원본 이름은 메타데이터로 보존.

const MAX_SIZE = 25 * 1048576

export async function uploadFile(f) {
  if (!hasSupabase) return null
  if (f.size > MAX_SIZE) throw new Error('25MB 이하 파일만 올릴 수 있습니다')
  const { data } = await supabase.auth.getUser()
  const uid = data.user.id
  const ext = (f.name.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'bin'
  const path = `${uid}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('files')
    .upload(path, f, { contentType: f.type || 'application/octet-stream' })
  if (error) throw error
  return { name: f.name, path, size: f.size, type: f.type || '', ts: Date.now() }
}

// 서명 URL — 미리보기(새 탭)·썸네일·다운로드 공용. downloadName을 주면 그 이름으로 내려받는다.
export async function fileUrl(path, downloadName) {
  const { data, error } = await supabase.storage
    .from('files')
    .createSignedUrl(path, 3600, downloadName ? { download: downloadName } : undefined)
  if (error) throw error
  return data.signedUrl
}

export async function removeStoredFile(path) {
  await supabase.storage.from('files').remove([path])
}

// 이미지 여부 — 썸네일 미리보기 대상 판별. type이 없는 옛 첨부는 확장자로 판단.
export const isImageFile = (f) =>
  (f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.path)
