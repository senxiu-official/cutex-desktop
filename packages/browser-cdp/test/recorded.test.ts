import { describe, expect, it } from 'vitest';
import { BrowserCdpExecutor } from '../src/index.js';
import type { CdpTransport } from '../src/index.js';
import recording from '../fixtures/electron-44.5.1-hidden-fill.json';

type Command = { method: string; params: Record<string, unknown>; result: unknown };
describe('I1 recorded input results with an explicitly synthetic S1 world-routing adapter', () => {
  for (const sample of recording.cases) {
    it(`${sample.carrier}: acknowledged input is ${sample.expectedOutcome}`, async () => {
      const queue = structuredClone(sample.commands) as Command[];
      const isolatedContextId = 7001;
      const transport: CdpTransport = {
        async send(method, params = {}) {
          // The historical recording predates S1. Preserve its bytes/results; this
          // explicit shim checks new routing, NOT actual isolated-world behavior.
          if (method === 'Page.createIsolatedWorld') {
            expect(params.frameId).toBe('id-0');
            expect(params.worldName).toMatch(/^cutex-browser-[a-f0-9]{32}$/);
            expect(params.grantUniveralAccess).toBe(false);
            return { executionContextId: isolatedContextId };
          }
          if (!queue.length) {
            // The capture deliberately ends at the receipt; pure cleanup is not asserted.
            expect(['Runtime.callFunctionOn', 'Runtime.releaseObject', 'Emulation.setFocusEmulationEnabled']).toContain(method);
            return {};
          }
          const command = queue.shift()!;
          expect(method).toBe(command.method);
          const { functionDeclaration: _ownFunction, executionContextId, contextId, ...rest } = params;
          if (method === 'DOM.resolveNode') expect(executionContextId).toBe(isolatedContextId);
          if (method === 'Runtime.evaluate') expect(contextId).toBe(isolatedContextId);
          expect(rest).toEqual(command.params);
          return command.result;
        },
        onEvent: () => () => {}, onDetach: () => () => {},
      };
      let generation = 0;
      const executor = new BrowserCdpExecutor(transport, {
        nextPageGeneration: () => ++generation,
        authorize: () => {}, ensureVisible: () => {}, allowUrl: () => true,
      });
      const snapshot = await executor.read();
      expect(snapshot.nodes).toHaveLength(16);
      const textbox = snapshot.nodes.find(node => node.role === 'textbox' && node.name === '备注')!;
      expect(textbox).toBeDefined();
      const action = executor.act(textbox.ref, 'fill', 'Cutex I1 verified');
      if (sample.expectedOutcome === 'outcome_unknown') {
        await expect(action).rejects.toMatchObject({ code: 'outcome_unknown' });
        await expect(executor.act(textbox.ref, 'fill', 'do not replay')).rejects.toMatchObject({ code: 'stale_ref' });
      } else await expect(action).resolves.toMatchObject({ status: 'dispatched', observed: true });
      expect(queue).toHaveLength(0);
      executor.dispose();
    });
  }
});
