import { describe, expect, it } from 'vitest';
import { createServicePluginHost } from '../src/index.js';
import type { ServiceManifest, Supervisor, SupervisorLease, SupervisorObserver } from '../src/index.js';

const definition = (): ServiceManifest => ({ id: 'review', protocol: 1,
  provides: ['review.read'], methods: ['observe'],
  restart: { maxRestarts: 1, windowMs: 1000, backoffMs: 10 },
});
class Driver implements Supervisor {
  observer!: SupervisorObserver;
  desired = { running: false, revision: 0 };
  closeCount = 0;
  attach(_id: string, _policy: unknown, observer: SupervisorObserver): SupervisorLease {
    this.observer = observer;
    return { setDesired: async input => { this.desired = input; }, close: async () => { this.closeCount++; } };
  }
  run(runId = 'run') {
    const revision = this.desired.revision;
    const observer = this.observer;
    const channel = observer.started({ revision, runId });
    observer.event({ revision, runId, phase: 'running' });
    expect(channel.ready({ occurrence: channel.occurrence, protocol: 1, capabilities: ['review.read'] })).toEqual({ ok: true });
    return channel;
  }
}
function start(driver = new Driver(), input = definition()) {
  const host = createServicePluginHost({ services: [input], supervisor: driver });
  host.grant('review', { capabilities: ['review.read'], methods: ['observe'] });
  host.setEnabled('review', true);
  return { host, driver };
}

describe('independent service authority review', () => {
  it('caller mutation cannot expand a manifest or mutate projected authority', async () => {
    const input = definition();
    const { host, driver } = start(undefined, input);
    (input.provides as string[]).push('review.root');
    (input.methods as string[]).push('owner.control');
    const channel = driver.run();
    expect(() => host.grant('review', { capabilities: ['review.root'], methods: ['observe'] })).toThrow();
    expect(channel.check('observe')).toEqual({ ok: true });
    expect(channel.check('owner.control')).toMatchObject({ ok: false });
    const snapshot = host.snapshot();
    expect(() => (snapshot.capabilities as string[]).push('review.root')).toThrow();
    expect(() => Object.assign(snapshot.services[0]!, { phase: 'ready', capabilities: ['review.root'] })).toThrow();
    expect(host.snapshot().capabilities).toEqual(['review.read']);
    await host.dispose();
  });

  it('same textual service and run ID in a new controller never revives the old channel', async () => {
    const first = start();
    const old = first.driver.run('shared-text-id');
    const captured = old.guard('observe', () => 'side effect');
    await first.host.dispose();
    const second = start();
    const current = second.driver.run('shared-text-id');
    expect(current.occurrence).not.toBe(old.occurrence);
    expect(old.ready({ occurrence: current.occurrence, protocol: 1, capabilities: ['review.read'] })).toMatchObject({ ok: false });
    expect(captured()).toMatchObject({ ok: false });
    expect(current.check('observe')).toEqual({ ok: true });
    await second.host.dispose();
  });

  it('observer revocation during ready publication leaves no usable capability', async () => {
    const { host, driver } = start();
    const unsubscribe = host.subscribe(() => {
      if (host.snapshot().capabilities.includes('review.read')) host.revoke('review');
    });
    const revision = driver.desired.revision;
    const channel = driver.observer.started({ revision, runId: 'revoked-on-ready' });
    driver.observer.event({ revision, runId: 'revoked-on-ready', phase: 'running' });
    channel.ready({ occurrence: channel.occurrence, protocol: 1, capabilities: ['review.read'] });
    expect(host.snapshot().capabilities).toEqual([]);
    expect(channel.check('observe')).toMatchObject({ ok: false });
    expect(driver.desired.running).toBe(false);
    unsubscribe();
    await host.dispose();
  });

  it('a malformed replacement grant cannot partially revoke or widen existing authority', async () => {
    const { host, driver } = start();
    const channel = driver.run();
    expect(() => host.grant('review', { capabilities: ['review.read'], methods: ['observe', 'owner.control'] })).toThrow();
    expect(channel.check('observe')).toEqual({ ok: true });
    expect(host.snapshot().capabilities).toEqual(['review.read']);
    await host.dispose();
  });
});
