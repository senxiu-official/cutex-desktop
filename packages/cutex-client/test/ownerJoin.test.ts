import { CutexClient } from '../src/client';
import { describe, expect, it } from 'vitest';

describe('explicit owner join transport', () => {
  it('preserves the exact consent for direct input and atomic queue steering', async () => {
    const calls: any[] = [];
    const join = { askId: 'ask-a', attempt: 2, expectedTurnId: 'turn-a', runtimeGeneration: 7 };
    const client = new CutexClient({ baseUrl: 'http://fixture.invalid', token: 'fixture' }, {
      fetch: async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ cutex: { result: { disposition: 'steered', turnId: 'turn-a' } } })); },
    });
    await client.submitInput('agent', [{ type: 'text', text: 'shared input' }], 'auto', { joinDelegation: join });
    await client.queueSteer('agent', 'queue-a', 3, { ifIdle: 'fail', joinDelegation: join });
    expect(calls.map(x => x.params.joinDelegation)).toEqual([join, join]);
    expect(calls.map(x => x.method)).toEqual(['cutex/userInput/submit', 'cutex/userInput/queue/steer']);
    expect(calls[1].params.ifIdle).toBe('fail');
    await client.submitInput('agent', [{ type: 'text', text: 'ordinary' }], 'auto');
    expect(calls[2].params).not.toHaveProperty('joinDelegation');
  });
});
