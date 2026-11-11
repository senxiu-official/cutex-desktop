import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import * as path from 'node:path'
import type { CopySource, CopySettings, CopyState, RemoteCopy, TransferMeta, TransferChunk } from '../shared/remoteCopies'
import { downloadFilename } from '../shared/downloadFilename'

export type RemoteCopyManagerOptions = {
  /** The dedicated userData/remote-copies directory, never userData itself. */
  root: string
  now?: () => number
  transport: (source: CopySource) => Promise<{
    metadata(signal: AbortSignal): Promise<TransferMeta>
    chunk(meta: TransferMeta, offset: number, maxBytes: number, signal: AbortSignal): Promise<TransferChunk>
  }>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DAY = 86400000
const LARGE = 200 * 1024 * 1024
const clone = <T>(value: T): T => structuredClone(value)
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'
function sourceValue(s: CopySource): CopySource {
  if (!s || !['hostId', 'hostLabel', 'hostIdentity', 'path'].every(k => typeof s[k as keyof CopySource] === 'string') || !s.hostId || !s.hostIdentity || !s.path) throw Error('Invalid copy source')
  if (s.scope && (!['session', 'project'].includes(s.scope.kind) || typeof s.scope.id !== 'string')) throw Error('Invalid scope')
  if (s.artifact && (typeof s.artifact.id !== 'string' || !Number.isSafeInteger(s.artifact.version) || s.artifact.version < 1)) throw Error('Invalid artifact')
  return { hostId: s.hostId, hostLabel: s.hostLabel, hostIdentity: s.hostIdentity, path: s.path,
    ...(s.scope ? { scope: { kind: s.scope.kind, id: s.scope.id } } : {}),
    ...(s.artifact ? { artifact: { id: s.artifact.id, version: s.artifact.version } } : {}) }
}
// What the owner saved to this computer on purpose (保存到这台电脑: an artifact) is never deleted automatically
// (owner 2026-11-10: no timed deletion of user data): always kept, no expiry. Remote file copies follow the retention setting.
const savedOnPurpose = (s: CopySource): boolean => !!s.artifact
function filename(name: string): string {
  return downloadFilename(name)
}
function metaValue(m: TransferMeta): TransferMeta {
  if (!m || typeof m.name !== 'string' || typeof m.path !== 'string' || typeof m.modifiedAt !== 'string' || typeof m.revision !== 'string' || !m.revision || !Number.isSafeInteger(m.size) || m.size < 0 || !Number.isSafeInteger(m.maxChunkBytes) || m.maxChunkBytes < 1 || m.maxChunkBytes > 4194304 || (m.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(m.sha256))) throw Error('Invalid transfer metadata')
  return clone(m)
}
/** Main-process only. Control serialization never waits for network I/O. */
export class RemoteCopyManager {
  private readonly root: string
  private readonly now: () => number
  private readonly ready: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private rows = new Map<string, RemoteCopy>()
  private prefs: CopySettings = { retentionDays: 7, largeFileBytes: LARGE }
  private active = new Map<string, { host: string; controller: AbortController; done: Promise<void> }>()
  private rootIdentity = ''
  private closed = false
  private timer?: ReturnType<typeof setInterval>
  constructor(private readonly options: RemoteCopyManagerOptions) {
    this.root = path.resolve(options.root)
    this.now = options.now ?? Date.now
    this.ready = this.initialize()
    this.timer = setInterval(() => { void this.cleanup().catch(() => {}) }, 3600000)
    this.timer.unref?.()
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.ready).then(work)
    this.queue = next.catch(() => {})
    return next
  }
  private async directory(p: string): Promise<void> {
    // Check every component: realpath alone would silently accept an ancestor junction.
    const parent = path.dirname(p)
    if (parent !== p) await this.directory(parent)
    const s = await fs.lstat(p)
    if (!s.isDirectory() || s.isSymbolicLink() || path.resolve(await fs.realpath(p)).toLowerCase() !== path.resolve(p).toLowerCase()) throw Error('Unsafe copies directory')
  }
  private async guardRoot(): Promise<void> {
    await this.directory(this.root)
    const s = await fs.lstat(this.root)
    if (`${s.dev}:${s.ino}` !== this.rootIdentity) throw Error('Copies root replaced')
  }
  private async entry(id: string, create = false): Promise<string> {
    if (!UUID.test(id)) throw Error('Invalid copy id')
    await this.guardRoot()
    const dir = path.join(this.root, id)
    if (create) await fs.mkdir(dir, { mode: 0o700 })
    await this.directory(dir)
    return dir
  }
  private async regular(p: string): Promise<void> {
    const s = await fs.lstat(p)
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || path.resolve(await fs.realpath(p)).toLowerCase() !== path.resolve(p).toLowerCase()) throw Error('Unsafe copy file')
  }
  private async unlink(id: string, name: string): Promise<void> {
    const dir = await this.entry(id)
    const p = path.join(dir, name)
    try { await this.regular(p) } catch (e) { if (missing(e)) return; throw e }
    await fs.unlink(p)
  }
  private async initialize(): Promise<void> {
    // Verify existing ancestors before creating any child, including on first run.
    const ensure = async (dir: string): Promise<void> => {
      const parent = path.dirname(dir)
      if (parent !== dir) await ensure(parent)
      try { await fs.lstat(dir) } catch (e) { if (!missing(e)) throw e; await fs.mkdir(dir, { mode: 0o700 }) }
      await this.directory(dir)
    }
    await ensure(this.root)
    await this.directory(this.root)
    const s = await fs.lstat(this.root)
    this.rootIdentity = `${s.dev}:${s.ino}`
    try {
      const index = path.join(this.root, 'index.json')
      await this.regular(index)
      if ((await fs.stat(index)).size > 8 * 1024 * 1024) throw Error('Copy index too large')
      const data = JSON.parse(await fs.readFile(index, 'utf8'))
      if (data.settings?.retentionDays === null || (Number.isInteger(data.settings?.retentionDays) && data.settings.retentionDays > 0 && data.settings.retentionDays <= 36500)) this.prefs.retentionDays = data.settings.retentionDays
      if (Array.isArray(data.copies)) for (const raw of data.copies) {
        try {
          if (!UUID.test(raw.id) || typeof raw.name !== 'string' || filename(raw.name) !== raw.name || !Number.isSafeInteger(raw.size) || raw.size < 0 || !Number.isSafeInteger(raw.received) || raw.received < 0 || raw.received > raw.size || !['downloading', 'complete', 'failed', 'canceled', 'expired', 'missing'].includes(raw.status) || !Number.isFinite(Date.parse(raw.createdAt)) || ![raw.downloadedAt, raw.expiresAt].every(v => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)))) || typeof raw.kept !== 'boolean' || !(raw.sha256 === null || /^[a-f0-9]{64}$/.test(raw.sha256))) continue
          const row: RemoteCopy = { id: raw.id, source: sourceValue(raw.source), name: raw.name, size: raw.size, received: raw.received, status: raw.status === 'downloading' ? 'canceled' : raw.status, createdAt: raw.createdAt, downloadedAt: raw.downloadedAt, expiresAt: raw.expiresAt, kept: raw.kept, sha256: raw.sha256 }
          if (savedOnPurpose(row.source)) { row.kept = true; row.expiresAt = null }
          this.rows.set(row.id, row)
        } catch { /* A malformed row never supplies filesystem paths. */ }
      }
    } catch { /* Missing/corrupt metadata never widens cleanup. */ }
    // Only the fixed staging name in verified UUID directories is eligible.
    for (const id of await fs.readdir(this.root)) if (UUID.test(id)) {
      try { await this.unlink(id, 'download.part') } catch { /* Leave untrusted entries alone. */ }
    }
    await this.cleanupRows()
    await this.persist()
  }
  private async persist(): Promise<void> {
    await this.guardRoot()
    const tmp = path.join(this.root, `index-${randomUUID()}.tmp`)
    const handle = await fs.open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try { await handle.writeFile(JSON.stringify({ version: 1, copies: [...this.rows.values()], settings: this.prefs })); await handle.sync() } finally { await handle.close() }
    await this.guardRoot()
    try { await this.regular(path.join(this.root, 'index.json')) } catch (e) { if (!missing(e)) { await fs.unlink(tmp); throw e } }
    await fs.rename(tmp, path.join(this.root, 'index.json'))
  }
  async inspect(source: CopySource): Promise<TransferMeta> {
    await this.ready
    if (this.closed) throw Error('Copies manager disposed')
    const transport = await this.options.transport(sourceValue(source))
    return metaValue(await transport.metadata(new AbortController().signal))
  }
  async start(source: CopySource, expected: { revision: string; size: number }, replaceId?: string): Promise<string> {
    source = sourceValue(source)
    // expected is the main-validated consent snapshot, required even for small files.
    const consent = { revision: expected?.revision, size: expected?.size }
    const id = await this.serial(async () => {
      if (this.closed) throw Error('Copies manager disposed')
      if (!consent.revision || !Number.isSafeInteger(consent.size) || consent.size < 0) throw Error('Metadata consent required')
      if (this.active.size >= 2 || [...this.active.values()].some(a => a.host === source.hostId)) throw Error('Transfer capacity reached')
      if (replaceId) {
        const previous = this.row(replaceId)
        if (previous.source.hostIdentity !== source.hostIdentity || previous.source.path !== source.path || previous.source.hostId !== source.hostId || JSON.stringify(previous.source.scope) !== JSON.stringify(source.scope) || JSON.stringify(previous.source.artifact) !== JSON.stringify(source.artifact)) throw Error('Refresh source mismatch')
      }
      const id = randomUUID()
      const controller = new AbortController()
      this.rows.set(id, { id, source, name: 'download', size: consent.size, received: 0, status: 'downloading', createdAt: new Date(this.now()).toISOString(), downloadedAt: null, expiresAt: null, kept: savedOnPurpose(source) || (replaceId ? this.row(replaceId).kept : false), sha256: null })
      this.active.set(id, { host: source.hostId, controller, done: Promise.resolve() })
      try { await this.persist() } catch (e) { this.active.delete(id); this.rows.delete(id); throw e }
      return id
    })
    const active = this.active.get(id)!
    active.done = this.transfer(id, consent, active.controller.signal, replaceId)
    return id
  }
  private row(id: string): RemoteCopy {
    const row = this.rows.get(id)
    if (!row || !UUID.test(id)) throw Error('Unknown copy')
    return row
  }
  private async transfer(id: string, expected: { revision: string; size: number }, signal: AbortSignal, replaceId?: string): Promise<void> {
    let handle: fs.FileHandle | undefined
    let partIdentity = ''
    let published = false
    const check = () => { signal.throwIfAborted(); if (this.closed) throw Error('Copies manager disposed') }
    try {
      check()
      const row = this.row(id)
      const transport = await this.options.transport(clone(row.source))
      check()
      const meta = metaValue(await transport.metadata(signal))
      check()
      if (meta.revision !== expected.revision || meta.size !== expected.size) throw Error('Source changed since confirmation')
      row.name = filename(meta.name)
      const dir = await this.entry(id, true)
      handle = await fs.open(path.join(dir, 'download.part'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      const opened = await handle.stat()
      partIdentity = `${opened.dev}:${opened.ino}`
      const hash = createHash('sha256')
      let offset = 0
      for (;;) {
        check()
        const max = Math.min(meta.maxChunkBytes, 4194304)
        const chunk = await transport.chunk(meta, offset, max, signal)
        check()
        if (!(chunk.bytes instanceof Uint8Array) || chunk.revision !== meta.revision || chunk.offset !== offset || chunk.total !== meta.size || !Number.isSafeInteger(chunk.next) || chunk.next !== offset + chunk.bytes.byteLength || chunk.bytes.byteLength > max || chunk.next > meta.size || typeof chunk.eof !== 'boolean' || chunk.eof !== (chunk.next === meta.size) || (!chunk.eof && chunk.bytes.byteLength === 0)) throw Error('Invalid transfer chunk')
        await this.entry(id)
        await this.regular(path.join(dir, 'download.part'))
        const current = await fs.lstat(path.join(dir, 'download.part'))
        if (`${current.dev}:${current.ino}` !== partIdentity) throw Error('Partial file replaced')
        let written = 0
        while (written < chunk.bytes.byteLength) {
          const result = await handle.write(chunk.bytes, written, chunk.bytes.byteLength - written, offset + written)
          if (result.bytesWritten <= 0) throw Error('Short local write')
          written += result.bytesWritten
        }
        hash.update(chunk.bytes)
        offset = chunk.next
        row.received = offset
        if (chunk.eof) break
      }
      check()
      const final = metaValue(await transport.metadata(signal))
      check()
      if (final.revision !== meta.revision || final.size !== meta.size || final.path !== meta.path || final.modifiedAt !== meta.modifiedAt || final.sha256 !== meta.sha256) throw Error('Source changed during transfer')
      const digest = hash.digest('hex')
      if (meta.sha256 && digest !== meta.sha256.toLowerCase()) throw Error('Content hash mismatch')
      await handle.sync()
      await handle.close(); handle = undefined
      await this.serial(async () => {
        check()
        const dir = await this.entry(id)
        const part = path.join(dir, 'download.part')
        await this.regular(part)
        const complete = await fs.lstat(part)
        if (`${complete.dev}:${complete.ino}` !== partIdentity || complete.size !== meta.size) throw Error('Local byte count mismatch')
        // The directory is freshly allocated; no destination is overwritten.
        const target = path.join(dir, row.name === 'download.part' ? '_download.part' : row.name)
        try { await fs.lstat(target); throw Error('Copy destination exists') } catch (e) { if (!missing(e)) throw e }
        await fs.rename(part, target)
        published = true
        row.status = 'complete'; row.sha256 = digest
        if (replaceId && this.rows.has(replaceId)) row.kept = this.row(replaceId).kept
        if (savedOnPurpose(row.source)) row.kept = true
        row.downloadedAt = new Date(this.now()).toISOString()
        row.expiresAt = savedOnPurpose(row.source) || this.prefs.retentionDays === null ? null : new Date(this.now() + this.prefs.retentionDays * DAY).toISOString()
        await this.persist()
        if (replaceId && this.rows.has(replaceId) && !this.active.has(replaceId)) {
          try { await this.deleteFiles(this.row(replaceId)); this.rows.delete(replaceId); await this.persist() } catch { /* New copy remains usable if old cleanup is refused. */ }
        }
      })
    } catch (e) {
      await handle?.close().catch(() => {})
      try { await this.unlink(id, 'download.part') } catch { /* Never traverse a replaced entry. */ }
      await this.serial(async () => {
        const row = this.rows.get(id)
        if (row && !published) { row.status = signal.aborted ? 'canceled' : 'failed'; row.error = e instanceof Error ? e.message : 'Transfer failed'; await this.persist() }
      }).catch(() => {})
    } finally { this.active.delete(id) }
  }
  async list(): Promise<CopyState> { return this.serial(async () => clone({ copies: [...this.rows.values()], settings: this.prefs })) }
  async cancel(id: string): Promise<void> {
    await this.ready
    this.row(id)
    const active = this.active.get(id)
    active?.controller.abort()
    await active?.done
  }
  async keep(id: string, kept: boolean): Promise<void> {
    return this.serial(async () => {
      if (typeof kept !== 'boolean') throw Error('Invalid keep')
      const row = this.row(id)
      if (!kept && savedOnPurpose(row.source)) throw Error('Saved artifacts are always kept')
      row.kept = kept
      await this.persist()
    })
  }
  private async deleteFiles(row: RemoteCopy): Promise<void> {
    try {
      await this.unlink(row.id, 'download.part')
      await this.unlink(row.id, row.name === 'download.part' ? '_download.part' : row.name)
      // rmdir only removes an empty verified directory. Unknown files are never swept.
      const dir = await this.entry(row.id)
      await fs.rmdir(dir).catch(e => { if (e.code !== 'ENOTEMPTY') throw e })
    } catch (e) { if (!missing(e)) throw e }
  }
  async remove(id: string): Promise<void> {
    await this.cancel(id)
    return this.serial(async () => { await this.deleteFiles(this.row(id)); this.rows.delete(id); await this.persist() })
  }
  async settings(patch?: { retentionDays: number | null }): Promise<CopySettings> {
    return this.serial(async () => {
      if (patch) {
        if (patch.retentionDays !== null && (!Number.isInteger(patch.retentionDays) || patch.retentionDays < 1 || patch.retentionDays > 36500)) throw Error('Invalid retention')
        this.prefs.retentionDays = patch.retentionDays
        await this.persist()
      }
      return clone(this.prefs)
    })
  }
  private async cleanupRows(): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.status !== 'complete' || this.active.has(row.id)) continue
      try {
        const dir = await this.entry(row.id)
        await this.regular(path.join(dir, row.name === 'download.part' ? '_download.part' : row.name))
        if (!row.kept && !savedOnPurpose(row.source) && row.expiresAt && Date.parse(row.expiresAt) <= this.now()) {
          await this.deleteFiles(row)
          row.status = 'expired'; row.received = 0
        }
      } catch { row.status = 'missing'; row.received = 0 }
    }
  }
  async cleanup(): Promise<void> { return this.serial(async () => { await this.cleanupRows(); await this.persist() }) }
  async file(id: string): Promise<string> {
    return this.serial(async () => {
      const row = this.row(id)
      if (row.status !== 'complete') throw Error('Copy unavailable')
      const dir = await this.entry(id)
      const p = path.join(dir, row.name === 'download.part' ? '_download.part' : row.name)
      await this.regular(p)
      if ((await fs.stat(p)).size !== row.size) throw Error('Copy byte count changed')
      return p
    })
  }
  async dispose(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    await this.ready
    const active = [...this.active.values()]
    active.forEach(a => a.controller.abort())
    await Promise.all(active.map(a => a.done))
    await this.queue
  }
}
