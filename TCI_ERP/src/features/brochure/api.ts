/**
 * Data access for the TCI brochure and its media library (migration 0058).
 *
 * Reads are plain selects (staff RLS); every write is a gated function —
 * save_brochure_version, publish_brochure_version, register / update /
 * retire_media_asset — and each answers with the row it wrote, which goes
 * straight into the cache: nothing else is refetched.
 *
 * Images are private: they are shown through short-lived signed URLs
 * (`useMediaUrls`), cached per storage path, never hotlinked.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, tci } from '../../lib/supabase'
import { editablePayload } from './editor'
import { MediaFileError } from './errors'
import { fileProblem, isMediaMime, mediaStoragePath, metaPayload, metaProblems } from './media'
import type { MediaMetaForm } from './media'
import { MEDIA_BUCKET } from './model'
import type { BrochureContent, BrochureVersion, MediaAsset } from './model'

export const brochureKeys = {
  versions: ['brochure', 'versions'] as const,
  current: ['brochure', 'current'] as const,
  media: ['media', 'assets'] as const,
  url: (path: string) => ['media', 'url', path] as const,
}

const VERSION_COLUMNS =
  'id, version_no, status, content, note, author_id, created_at, published_at, published_by'

// ---------------------------------------------------------------------------
// Brochure versions
// ---------------------------------------------------------------------------

/** Every version, newest first. */
export function useBrochureVersions() {
  return useQuery({
    queryKey: brochureKeys.versions,
    queryFn: async (): Promise<BrochureVersion[]> => {
      const { data, error } = await tci()
        .from('brochure_versions')
        .select(VERSION_COLUMNS)
        .order('version_no', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as BrochureVersion[]
    },
  })
}

/** The current brochure: the latest PUBLISHED version (tci.current_brochure_version), or null. */
export function useCurrentBrochure() {
  return useQuery({
    queryKey: brochureKeys.current,
    queryFn: async (): Promise<BrochureVersion | null> => {
      const { data, error } = await tci()
        .from('brochure_versions')
        .select(VERSION_COLUMNS)
        .eq('status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as BrochureVersion | null
    },
  })
}

/** A new DRAFT version from the editor; the server stamps the images. */
export function useSaveBrochureVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['brochure', 'save'],
    mutationFn: async (input: {
      content: BrochureContent
      note: string
    }): Promise<BrochureVersion> => {
      const { data, error } = await tci().rpc('save_brochure_version', {
        p_content: editablePayload(input.content),
        p_note: input.note.trim() || null,
      })
      if (error) throw error
      return data as unknown as BrochureVersion
    },
    onSuccess: (row) => {
      queryClient.setQueryData<BrochureVersion[]>(brochureKeys.versions, (old) =>
        old ? [row, ...old.filter((v) => v.id !== row.id)] : [row],
      )
    },
  })
}

/** Draft → published; the previously published version retires. */
export function usePublishBrochureVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['brochure', 'publish'],
    mutationFn: async (versionId: string): Promise<BrochureVersion> => {
      const { data, error } = await tci().rpc('publish_brochure_version', {
        p_version_id: versionId,
      })
      if (error) throw error
      return data as unknown as BrochureVersion
    },
    onSuccess: (row) => {
      queryClient.setQueryData<BrochureVersion[]>(brochureKeys.versions, (old) =>
        old?.map((v) =>
          v.id === row.id ? row : v.status === 'published' ? { ...v, status: 'retired' } : v,
        ),
      )
      queryClient.setQueryData(brochureKeys.current, row)
    },
  })
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

/** Every asset, retired ones included (a version may still show them), newest first. */
export function useMediaAssets() {
  return useQuery({
    queryKey: brochureKeys.media,
    queryFn: async (): Promise<MediaAsset[]> => {
      const { data, error } = await tci()
        .from('media_assets')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as MediaAsset[]
    },
  })
}

function replaceAsset(old: MediaAsset[] | undefined, row: MediaAsset): MediaAsset[] | undefined {
  return old?.map((a) => (a.id === row.id ? row : a))
}

/** Width and height as the browser decodes the file (recorded on the row). */
export function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.naturalWidth > 0 && img.naturalHeight > 0)
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      else reject(new MediaFileError('media.errors.unreadable'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new MediaFileError('media.errors.unreadable'))
    }
    img.src = url
  })
}

/**
 * Check the file and the metadata in the browser (the same rules the database
 * enforces), store the file under a new `<uuid>.<ext>`, then register it.
 * Registration refuses a path that is not in the bucket (media_not_uploaded).
 */
export function useUploadMediaAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['media', 'upload'],
    mutationFn: async (input: { file: File; meta: MediaMetaForm }): Promise<MediaAsset> => {
      const problem = fileProblem(input.file)
      if (problem || !isMediaMime(input.file.type))
        throw new MediaFileError(problem ?? 'media.errors.fileType')
      const missing = Object.values(metaProblems(input.meta))[0]
      if (missing) throw new MediaFileError(missing)
      const size = await readImageSize(input.file)
      const path = mediaStoragePath(crypto.randomUUID(), input.file.type)
      const { error: upError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, input.file, { contentType: input.file.type, upsert: false })
      if (upError) throw upError
      const { data, error } = await tci().rpc('register_media_asset', {
        p_storage_path: path,
        p_mime_type: input.file.type,
        ...metaPayload(input.meta),
        p_byte_size: input.file.size,
        p_width: size.width,
        p_height: size.height,
      })
      if (error) throw error
      return data as unknown as MediaAsset
    },
    onSuccess: (row) => {
      queryClient.setQueryData<MediaAsset[]>(brochureKeys.media, (old) =>
        old ? [row, ...old] : [row],
      )
    },
  })
}

/** Alt text, source, licence, author and link; the file itself never changes. */
export function useUpdateMediaAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['media', 'update'],
    mutationFn: async (input: { id: string; meta: MediaMetaForm }): Promise<MediaAsset> => {
      const missing = Object.values(metaProblems(input.meta))[0]
      if (missing) throw new MediaFileError(missing)
      const { data, error } = await tci().rpc('update_media_asset', {
        p_id: input.id,
        ...metaPayload(input.meta),
      })
      if (error) throw error
      return data as unknown as MediaAsset
    },
    onSuccess: (row) =>
      queryClient.setQueryData<MediaAsset[]>(brochureKeys.media, (old) => replaceAsset(old, row)),
  })
}

/** Retired, never removed: versions that printed the image keep showing it. */
export function useRetireMediaAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['media', 'retire'],
    mutationFn: async (id: string): Promise<MediaAsset> => {
      const { data, error } = await tci().rpc('retire_media_asset', { p_id: id })
      if (error) throw error
      return data as unknown as MediaAsset
    },
    onSuccess: (row) =>
      queryClient.setQueryData<MediaAsset[]>(brochureKeys.media, (old) => replaceAsset(old, row)),
  })
}

// ---------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------

/** A signed URL lives an hour; it is refreshed well before it runs out. */
const URL_TTL_SECONDS = 3600
const URL_FRESH_MS = 45 * 60_000

async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}

/**
 * Signed URLs for these storage paths, keyed by path (undefined while one is
 * on its way or could not be signed). Each path is signed once and shared by
 * every screen that shows it.
 */
export function useMediaUrls(
  paths: readonly (string | null | undefined)[],
): Record<string, string | undefined> {
  const unique = [
    ...new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0)),
  ]
  const results = useQueries({
    queries: unique.map((path) => ({
      queryKey: brochureKeys.url(path),
      queryFn: () => signedUrl(path),
      staleTime: URL_FRESH_MS,
      gcTime: URL_FRESH_MS,
      refetchInterval: URL_FRESH_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  })
  const out: Record<string, string | undefined> = {}
  unique.forEach((path, i) => {
    out[path] = results[i]?.data
  })
  return out
}
