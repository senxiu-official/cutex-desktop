import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteCopyManager, type RemoteCopyManagerOptions } from '../src/main/remoteCopies'
import type { CopySource, TransferMeta, TransferChunk } from '../src/shared/remoteCopies'
const scratch = path.join(tmpdir(), 'remote-copies-tests')
const source: CopySource = { hostId: 'a', hostLabel: 'A', hostIdentity: 'identity-a', path: '/remote/data.bin' }
const managers: RemoteCopyManager[] = [], dirs: string[] = []
async function root() {
  await fs.mkdir(scratch, { recursive: true })
  const dir = await fs.mkdtemp(path.join(scratch, 'case-')); dirs.push(dir)
  return path.join(dir, 'copies')
}
function transport(bytes: Uint8Array, mutate?: (c: TransferChunk) => TransferChunk) {
  let calls = 0
  const meta: TransferMeta = { path: source.path, name: 'data.bin', size: bytes.length, modifiedAt: '2026-10-28T00:00:00Z', revision: 'r1', maxChunkBytes: 1024 * 1024 }
  return { meta, calls: () => calls, factory: async () => ({
    metadata: async () => { calls++; return { ...meta } },
    chunk: async (_m: TransferMeta, offset: number, max: number) => {
      const data = bytes.slice(offset, offset + max)
      const c = { bytes: data, offset, total: meta.size, next: offset + data.length, eof: offset + data.length === meta.size, revision: meta.revision }
      return mutate ? mutate(c) : c
    },
  }) }
}
function manager(options: RemoteCopyManagerOptions) { const m = new RemoteCopyManager(options); managers.push(m); return m }
async function settled(m: RemoteCopyManager, id: string) {
  for (let i = 0; i < 1000; i++) {
    const row = (await m.list()).copies.find(r => r.id === id)!
    if (row.status !== 'downloading') { await m.cancel(id); return row }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw Error('Transfer did not settle')
}
async function download(m: RemoteCopyManager, s = source) {
  const meta = await m.inspect(s), id = await m.start(s, { revision: meta.revision, size: meta.size })
  return { id, row: await settled(m, id) }
}
afterEach(async () => {
  await Promise.all(managers.splice(0).map(m => m.dispose().catch(() => {})))
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) {
    if (!path.resolve(dir).startsWith(path.resolve(scratch) + path.sep)) throw Error('Unsafe test cleanup')
    await fs.rm(dir, { recursive: true, force: true })
  }
})
describe('owned remote copies', () => {
  it('preserves ZIP/compound extensions while shortening a long remote filename', async () => {
    for (const suffix of ['.zip', '.tar.gz']) {
      const t = transport(new Uint8Array([1, 2])); t.meta.name = 'a'.repeat(190) + suffix
      const m = manager({ root: await root(), transport: t.factory })
      const { id, row } = await download(m)
      expect(row.status).toBe('complete'); expect(row.name).toHaveLength(160)
      expect(row.name.endsWith(suffix)).toBe(true)
      expect(path.basename(await m.file(id))).toBe(row.name)
    }
  })
  it('streams >10 MiB exactly, hashes bytes, verifies final metadata and exposes no local paths', async () => {
    const bytes = Uint8Array.from({ length: 11 * 1024 * 1024 + 193 }, (_, i) => i % 251)
    const t = transport(bytes), m = manager({ root: await root(), transport: t.factory })
    const { id, row } = await download(m)
    expect(row.status).toBe('complete'); expect(row.received).toBe(bytes.length)
    expect(row.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect((await fs.readFile(await m.file(id))).equals(Buffer.from(bytes))).toBe(true)
    expect(t.calls()).toBe(3)
    expect(JSON.stringify(await m.list())).not.toContain(scratch)
    expect(await fs.readdir(path.dirname(await m.file(id)))).toEqual(['data.bin'])
  })
  it.each([
    ['offset', (c: TransferChunk) => ({ ...c, offset: c.offset + 1 })],
    ['revision', (c: TransferChunk) => ({ ...c, revision: 'different' })],
    ['total', (c: TransferChunk) => ({ ...c, total: c.total + 1 })],
    ['short body', (c: TransferChunk) => ({ ...c, bytes: c.bytes.slice(1) })],
    ['early EOF', (c: TransferChunk) => ({ ...c, next: 1, bytes: c.bytes.slice(0, 1), eof: true })],
    ['missing EOF', (c: TransferChunk) => ({ ...c, eof: false })],
    ['no progress', (c: TransferChunk) => ({ ...c, bytes: new Uint8Array(), next: c.offset, eof: false })],
  ] as const)('rejects bad %s and cleans partials', async (_label, mutate) => {
    const r = await root(), t = transport(new Uint8Array([1, 2, 3]), mutate)
    const m = manager({ root: r, transport: t.factory }), { id, row } = await download(m)
    expect(row.status).toBe('failed'); expect(await fs.readdir(path.join(r, id))).toEqual([])
    await expect(m.file(id)).rejects.toThrow('unavailable')
  })
  it('requires exact revision/size consent, including above 200 MiB', async () => {
    const t = transport(new Uint8Array()); t.meta.size = 201 * 1024 * 1024
    const m = manager({ root: await root(), transport: t.factory })
    expect((await m.settings()).largeFileBytes).toBe(200 * 1024 * 1024)
    await expect(m.start(source, undefined!)).rejects.toThrow('consent')
    const a = await m.start(source, { revision: 'stale', size: t.meta.size })
    expect((await settled(m, a)).status).toBe('failed')
    const b = await m.start(source, { revision: t.meta.revision, size: t.meta.size - 1 })
    expect((await settled(m, b)).status).toBe('failed')
  })
  it('checks metadata again after EOF before publication', async () => {
    const t = transport(new Uint8Array([1, 2]))
    const factory = async () => {
      const base = await t.factory(); let reads = 0
      return { ...base, metadata: async () => ({ ...t.meta, revision: ++reads === 2 ? 'changed' : 'r1' }) }
    }
    const r = await root(), m = manager({ root: r, transport: factory }), { id, row } = await download(m)
    expect(row.status).toBe('failed'); expect(await fs.readdir(path.join(r, id))).toEqual([])
  })
  it.each([true, false])('enforces optional artifact content SHA256 (correct=%s)', async correct => {
    const t = transport(new Uint8Array([1, 2])); t.meta.sha256 = correct ? createHash('sha256').update(new Uint8Array([1, 2])).digest('hex') : '0'.repeat(64)
    const m = manager({ root: await root(), transport: t.factory })
    expect((await download(m)).row.status).toBe(correct ? 'complete' : 'failed')
  })
  it('publishes an empty file only with verified EOF', async () => {
    const m = manager({ root: await root(), transport: transport(new Uint8Array()).factory }), { id, row } = await download(m)
    expect(row.status).toBe('complete'); expect((await fs.stat(await m.file(id))).size).toBe(0)
  })
  it('cancels pending transport, deletes partial bytes and leaves controls responsive', async () => {
    const t = transport(new Uint8Array(2 * 1024 * 1024)); let entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const factory: RemoteCopyManagerOptions['transport'] = async () => ({ metadata: async () => t.meta,
      chunk: async (meta, offset, max, signal) => {
        if (offset === 0) return (await t.factory()).chunk(meta, offset, max)
        entered(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }))
      },
    })
    const r = await root(), m = manager({ root: r, transport: factory }), id = await m.start(source, t.meta)
    await waiting; await m.keep(id, true)
    expect((await m.list()).copies[0]!.received).toBe(1024 * 1024)
    await m.cancel(id)
    expect((await m.list()).copies[0]!.status).toBe('canceled'); expect(await fs.readdir(path.join(r, id))).toEqual([])
  })
  it('limits one active transfer per host and two globally without blocking settings', async () => {
    const t = transport(new Uint8Array([1]))
    const factory: RemoteCopyManagerOptions['transport'] = async () => ({
      metadata: async signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })),
      chunk: async () => { throw Error('unreachable') },
    })
    const m = manager({ root: await root(), transport: factory }), a = await m.start(source, t.meta)
    await expect(m.start(source, t.meta)).rejects.toThrow('capacity')
    const b = await m.start({ ...source, hostId: 'b' }, t.meta)
    await expect(m.start({ ...source, hostId: 'c' }, t.meta)).rejects.toThrow('capacity')
    expect((await m.list()).copies).toHaveLength(2); await m.settings({ retentionDays: null })
    await Promise.all([m.cancel(a), m.cancel(b)])
  })
  it('preserves old file on failed refresh, replaces it only after success', async () => {
    let bad = false
    const t = transport(new Uint8Array([4, 5]), c => bad ? { ...c, revision: 'bad' } : c)
    const m = manager({ root: await root(), transport: t.factory }), first = await download(m), old = await m.file(first.id)
    bad = true
    const failed = await m.start(source, t.meta, first.id)
    expect((await settled(m, failed)).status).toBe('failed')
    expect(await fs.readFile(old)).toEqual(Buffer.from([4, 5])); expect(await m.file(first.id)).toBe(old)
    bad = false
    const success = await m.start(source, t.meta, first.id)
    expect((await settled(m, success)).status).toBe('complete')
    expect((await m.list()).copies.some(r => r.id === first.id)).toBe(false)
    await expect(fs.stat(old)).rejects.toThrow()
  })
  it('preserves a keep change made while its replacement is downloading', async () => {
    const t = transport(new Uint8Array([4, 5]))
    let pause = false, resume!: () => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { resume = resolve })
    const m = manager({ root: await root(), transport: async s => {
      const connection = await t.factory()
      return { ...connection, chunk: async (...args) => { if (pause) { entered(); await gate }; return connection.chunk(args[0], args[1], args[2]) } }
    } })
    const first = await download(m)
    pause = true
    const next = await m.start(source, t.meta, first.id)
    await waiting; await m.keep(first.id, true); resume()
    expect((await settled(m, next)).kept).toBe(true)
  })
  it('persists keep/off, only changes future retention, retains expired/missing metadata', async () => {
    let now = Date.parse('2026-10-28T00:00:00Z')
    const r = await root(), t = transport(new Uint8Array([7]))
    let m = manager({ root: r, now: () => now, transport: t.factory })
    const normal = await download(m), kept = await download(m)
    expect(JSON.parse(await fs.readFile(path.join(r, 'index.json'), 'utf8')).version).toBe(1)
    await m.keep(kept.id, true); await m.settings({ retentionDays: null })
    const forever = await download(m); expect(forever.row.expiresAt).toBeNull()
    expect((await m.list()).copies.find(c => c.id === normal.id)!.expiresAt).toBe('2026-11-04T00:00:00.000Z')
    await m.dispose(); now += 8 * 86400000
    m = manager({ root: r, now: () => now, transport: t.factory })
    const state = await m.list(); expect(state.settings.retentionDays).toBeNull()
    expect(state.copies.find(c => c.id === normal.id)!.status).toBe('expired')
    expect(state.copies.find(c => c.id === kept.id)!.kept).toBe(true)
    expect(await fs.readFile(await m.file(kept.id))).toEqual(Buffer.from([7]))
    await fs.unlink(await m.file(forever.id)); await m.cleanup()
    expect((await m.list()).copies.find(c => c.id === forever.id)!.status).toBe('missing')
    await m.keep(kept.id, false); await m.cleanup()
    expect((await m.list()).copies.find(c => c.id === kept.id)!.status).toBe('expired')
  })
  it('sanitizes remote names and refuses local path ids', async () => {
    const t = transport(new Uint8Array([1])); t.meta.name = '../../CON:bad?.bin'
    const r = await root(), m = manager({ root: r, transport: t.factory }), { id, row } = await download(m)
    expect(row.name).not.toMatch(/[\\/:?]/); expect(path.dirname(await m.file(id))).toBe(path.join(r, id))
    await expect(m.remove('../outside')).rejects.toThrow('Unknown copy')
  })
  it('cleans only known startup partials, ignoring forged paths and unknown files', async () => {
    const r = await root(), id = randomUUID(); await fs.mkdir(path.join(r, id), { recursive: true })
    await fs.writeFile(path.join(r, id, 'download.part'), 'partial'); await fs.writeFile(path.join(r, id, 'unknown'), 'keep')
    const sentinel = path.join(path.dirname(r), 'sentinel'); await fs.writeFile(sentinel, 'safe')
    await fs.writeFile(path.join(r, 'index.json'), JSON.stringify({ copies: [{ id: '../', name: sentinel, status: 'complete' }] }))
    const m = manager({ root: r, transport: transport(new Uint8Array()).factory })
    expect((await m.list()).copies).toEqual([]); expect(await fs.readdir(path.join(r, id))).toEqual(['unknown'])
    expect(await fs.readFile(sentinel, 'utf8')).toBe('safe')
  })
  it('refuses an entry junction without touching outside sentinel files', async () => {
    const r = await root(), t = transport(new Uint8Array([9]))
    let m = manager({ root: r, transport: t.factory }); const { id } = await download(m), original = await m.file(id)
    await m.dispose(); await fs.unlink(original); await fs.rmdir(path.dirname(original))
    const outside = path.join(path.dirname(r), 'outside'); await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'data.bin'), 'sentinel'); await fs.writeFile(path.join(outside, 'download.part'), 'partial sentinel')
    await fs.symlink(outside, path.join(r, id), 'junction')
    try {
      m = manager({ root: r, transport: t.factory }); expect((await m.list()).copies[0]!.status).toBe('missing')
      await expect(m.remove(id)).rejects.toThrow('Unsafe')
      expect(await fs.readFile(path.join(outside, 'data.bin'), 'utf8')).toBe('sentinel')
      expect(await fs.readFile(path.join(outside, 'download.part'), 'utf8')).toBe('partial sentinel')
      await m.dispose()
    } finally { await fs.unlink(path.join(r, id)) }
  })
  it('rejects a root junction without modifying outside metadata', async () => {
    const r = await root(), outside = path.join(path.dirname(r), 'outside'); await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'index.json'), 'sentinel'); await fs.symlink(outside, r, 'junction')
    try {
      const m = manager({ root: r, transport: transport(new Uint8Array()).factory })
      await expect(m.list()).rejects.toThrow('Unsafe')
      expect(await fs.readFile(path.join(outside, 'index.json'), 'utf8')).toBe('sentinel')
    } finally { await fs.unlink(r) }
  })
  it('refuses hardlinked copy files and leaves outside bytes intact', async () => {
    const r = await root(), m = manager({ root: r, transport: transport(new Uint8Array([1])).factory })
    const { id } = await download(m), file = await m.file(id), sentinel = path.join(path.dirname(r), 'outside.bin')
    await fs.writeFile(sentinel, 'safe'); await fs.unlink(file); await fs.link(sentinel, file)
    await expect(m.file(id)).rejects.toThrow('Unsafe'); await expect(m.remove(id)).rejects.toThrow('Unsafe')
    expect(await fs.readFile(sentinel, 'utf8')).toBe('safe')
  })
  it('runs hourly expiry cleanup with the injected clock', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let now = Date.parse('2026-10-28T00:00:00Z')
    const m = manager({ root: await root(), now: () => now, transport: transport(new Uint8Array([1])).factory })
    const { id } = await download(m)
    now += 8 * 86400000
    await vi.advanceTimersByTimeAsync(3600000)
    expect((await m.list()).copies.find(c => c.id === id)!.status).toBe('expired')
  })
  it('recovers interrupted rows at startup and never publishes their partial bytes', async () => {
    const r = await root(), t = transport(new Uint8Array([1]))
    let m = manager({ root: r, transport: t.factory })
    const { id } = await download(m), file = await m.file(id)
    const state = await m.list(); await m.dispose()
    await fs.unlink(file)
    await fs.writeFile(path.join(r, id, 'download.part'), 'interrupted')
    state.copies[0]!.status = 'downloading'
    await fs.writeFile(path.join(r, 'index.json'), JSON.stringify(state))
    m = manager({ root: r, transport: t.factory })
    expect((await m.list()).copies[0]!.status).toBe('canceled')
    expect(await fs.readdir(path.join(r, id))).toEqual([])
    await expect(m.file(id)).rejects.toThrow('unavailable')
  })
  it('rejects valid-looking forged rows with traversal names and preserves outside sentinels', async () => {
    const r = await root(), t = transport(new Uint8Array([1]))
    let m = manager({ root: r, transport: t.factory })
    const { id } = await download(m), state = await m.list(); await m.dispose()
    const sentinel = path.join(path.dirname(r), 'sentinel')
    await fs.writeFile(sentinel, 'safe')
    state.copies[0]!.name = '../../sentinel'
    state.copies[0]!.expiresAt = '2000-01-01T00:00:00.000Z'
    await fs.writeFile(path.join(r, 'index.json'), JSON.stringify(state))
    m = manager({ root: r, transport: t.factory })
    expect((await m.list()).copies).toHaveLength(0)
    await expect(m.remove(id)).rejects.toThrow('Unknown copy')
    expect(await fs.readFile(sentinel, 'utf8')).toBe('safe')
  })
  it('rejects an ancestor junction before creating anything underneath it', async () => {
    const r = await root(), outside = path.join(path.dirname(r), 'outside')
    await fs.mkdir(outside); await fs.symlink(outside, r, 'junction')
    try {
      const m = manager({ root: path.join(r, 'must-not-create'), transport: transport(new Uint8Array()).factory })
      await expect(m.list()).rejects.toThrow('Unsafe')
      expect(await fs.readdir(outside)).toEqual([])
    } finally { await fs.unlink(r) }
  })
  it('keeps the exact scoped/artifact source binding for metadata and every chunk', async () => {
    const t = transport(new Uint8Array([3]))
    const pinned: CopySource = { ...source, path: 'relative/path', scope: { kind: 'project', id: 'p1' }, artifact: { id: 'af-pinned', version: 3 } }
    const seen: CopySource[] = []
    const m = manager({ root: await root(), transport: async s => { seen.push(s); return t.factory() } })
    expect((await download(m, pinned)).row.status).toBe('complete')
    expect(seen).toEqual([pinned, pinned])
  })
  // Owner 2026-11-10: what the owner saves to this computer (an artifact) is never deleted automatically.
  it('keeps an artifact save forever: kept, no expiry, untouched by clean-up passes and restarts; un-keeping is refused', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let now = Date.parse('2026-10-28T00:00:00Z')
    const r = await root()
    const t = transport(new Uint8Array([4, 5]))
    const saved: CopySource = { ...source, path: 'af-keep', artifact: { id: 'af-keep', version: 2 } }
    let m = manager({ root: r, now: () => now, transport: t.factory })
    const art = await download(m, saved), remote = await download(m)
    expect(art.row).toMatchObject({ status: 'complete', kept: true, expiresAt: null })
    expect(remote.row).toMatchObject({ status: 'complete', kept: false, expiresAt: '2026-11-04T00:00:00.000Z' })
    await expect(m.keep(art.id, false)).rejects.toThrow('always kept')
    now += 400 * 86400000
    await vi.advanceTimersByTimeAsync(3600000)
    await m.cleanup()
    let rows = (await m.list()).copies
    expect(rows.find(c => c.id === art.id)).toMatchObject({ status: 'complete', kept: true, expiresAt: null })
    expect(rows.find(c => c.id === remote.id)!.status).toBe('expired')
    expect(await fs.readFile(await m.file(art.id))).toEqual(Buffer.from([4, 5]))
    // A save written before this rule (kept false, an expiry in the past) is kept at the next start.
    await m.dispose()
    const index = path.join(r, 'index.json'), state = JSON.parse(await fs.readFile(index, 'utf8'))
    Object.assign(state.copies.find((c: { id: string }) => c.id === art.id), { kept: false, expiresAt: '2000-01-01T00:00:00.000Z' })
    await fs.writeFile(index, JSON.stringify(state))
    m = manager({ root: r, now: () => now, transport: t.factory })
    rows = (await m.list()).copies
    expect(rows.find(c => c.id === art.id)).toMatchObject({ status: 'complete', kept: true, expiresAt: null })
  })
  it('a re-downloaded artifact save stays kept with no expiry', async () => {
    const t = transport(new Uint8Array([6]))
    const saved: CopySource = { ...source, path: 'af-again', artifact: { id: 'af-again', version: 1 } }
    const m = manager({ root: await root(), transport: t.factory })
    const first = await download(m, saved)
    const meta = await m.inspect(saved), id = await m.start(saved, { revision: meta.revision, size: meta.size }, first.id)
    expect(await settled(m, id)).toMatchObject({ status: 'complete', kept: true, expiresAt: null })
  })
})
