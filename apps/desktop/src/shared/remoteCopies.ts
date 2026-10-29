/** Device-local owned copies. Local paths never cross the preload bridge. */
export type CopySource = {
  hostId: string
  hostLabel: string
  hostIdentity: string
  path: string
  scope?: { kind: 'session' | 'project'; id: string }
  artifact?: { id: string; version: number }
}
export type TransferMeta = {
  path: string
  name: string
  size: number
  modifiedAt: string
  revision: string
  maxChunkBytes: number
  sha256?: string
}
export type TransferChunk = {
  bytes: Uint8Array
  offset: number
  total: number
  next: number
  eof: boolean
  revision: string
}
export type RemoteCopy = {
  id: string
  source: CopySource
  name: string
  size: number
  received: number
  status: 'downloading' | 'complete' | 'failed' | 'canceled' | 'expired' | 'missing'
  createdAt: string
  downloadedAt: string | null
  expiresAt: string | null
  kept: boolean
  sha256: string | null
  error?: string
}
export type CopySettings = { retentionDays: number | null; largeFileBytes: number }
export type CopyState = { copies: RemoteCopy[]; settings: CopySettings }
