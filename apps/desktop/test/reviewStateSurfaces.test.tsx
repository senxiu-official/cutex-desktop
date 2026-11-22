// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const env = vi.hoisted(() => ({ online: false, agents: [{ threadId: 'child', name: 'Child', status: 'running' }] }));
vi.mock('../src/renderer/src/i18n', () => ({ useI18n: () => ({t: (k: string) => k}) }));
vi.mock('../src/renderer/src/store', () => ({ useApp: {getState: () => ({})} }));
vi.mock('../src/renderer/src/components/StatusChip', () => ({StatusMore: () => null}));
vi.mock('../src/renderer/src/lib/background', () => ({ useAgentOnline: () => env.online, useSubAgentLive: () => ({}), activeSubAgents: () => env.online ? env.agents : [] }));
vi.mock('../src/renderer/src/lib/subagents', () => ({ unconfirmedSubAgents: () => env.online ? [] : env.agents }));
vi.mock('../src/renderer/src/lib/agentFeaturesView', () => ({useAgentFeatures: () => ({})}));
vi.mock('../src/renderer/src/lib/claudeTasks', () => ({canOpenSubAgent: () => false}));
vi.mock('../src/renderer/src/lib/finishedSubagents', () => ({finishedSubAgents: () => []}));
vi.mock('../src/renderer/src/lib/subagentMetaStore', () => ({useSubAgentMeta: () => ({}), useSubAgentSpans: () => ({})}));
vi.mock('../src/renderer/src/lib/statusItemsView', () => ({useSessionTimeline: () => null}));
vi.mock('../src/renderer/src/lib/conversationScope', () => ({ useConvViewHost: () => 'host', useConvScope: () => ({}) }));
import {useShownSubAgents} from '../src/renderer/src/modules/subagents/useSubagentsStatus';
import {endLocalFollowUp, subagentFollowUpKey, resetLocalFollowUps, localFollowUpEnded, pruneFollowUps} from '../src/renderer/src/lib/localFollowUp';
import {beginOperation, stopWaitingItem, clearOperationItem, replaceOperationItems, operationItem, useBackgroundOperations} from '../src/renderer/src/lib/backgroundOperations';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>, el: HTMLDivElement;
beforeEach(() => { env.online = false; resetLocalFollowUps(); useBackgroundOperations.setState({operations: []}); el = document.createElement('div'); document.body.append(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });
function Panel() { return h('div', null, useShownSubAgents('parent').map(a => h('span', {key:a.threadId}, a.name))); }
it('REVIEW: a subagent whose follow-up ended must stay hidden on reconnect', () => {
  act(() => root.render(h(Panel)));
  expect(el.textContent).toContain('Child');
  act(() => endLocalFollowUp([subagentFollowUpKey('host', 'parent', 'child')]));
  expect(el.textContent).not.toContain('Child');
  env.online = true;
  act(() => root.render(h(Panel)));
  expect(el.textContent, 'reconnect must not restore a disposed child').not.toContain('Child');
});
it('REVIEW: a local end-follow-up record must not expire while the same item can still be reconstructed', () => {
  const key = subagentFollowUpKey('host', 'parent', 'child');
  endLocalFollowUp([key], 1000);
  // Adapted (c1596d287 dropped marks after 30 days): no age limit. A later end-follow-up, months on, keeps it.
  endLocalFollowUp([subagentFollowUpKey('host', 'parent', 'other')], 1000 + 400 * 24 * 3600 * 1000);
  expect(pruneFollowUps(localFollowUpEnded())[key]).toBe(1000);
  expect(localFollowUpEnded()[key]).toBe(1000);
});
it('REVIEW: clearing a disposed runtime-upgrade item must prevent its reappearance on the next progress snapshot', () => {
  const id = beginOperation('host', 'operations.kind.runtimeUpgrade', [{key:'a',name:'A'},{key:'b',name:'B'}]);
  stopWaitingItem({operationId:id,key:'a'});
  clearOperationItem({operationId:id,key:'a'});
  expect(operationItem({operationId:id,key:'a'})).toBeUndefined();
  replaceOperationItems(id, [{key:'a',name:'A',state:'running'},{key:'b',name:'B',state:'running'}]);
  expect(operationItem({operationId:id,key:'a'}), 'a late snapshot must not revive a cleared disposed item').toBeUndefined();
});

it('REVIEW: W7 must not identify the original requester as the stopper of an owner-stopped delegation', async () => {
  const {delegationStatus} = await import('../src/renderer/src/lib/delegations');
  // r289 owner_close(... requester=None, outcome=stop) records the same interruptReason=stopped;
  // AskSummary.requester remains the original delegating agent, not the owner who clicked Stop.
  const s = delegationStatus({execution:'interrupted',closed:'stopped',requester:{kind:'agent',cutexSessionId:'aria',name:'Aria'},attempt:{n:1,state:'interrupted',interruptReason:'stopped'}} as any);
  // Adapted: the status no longer carries an actor at all (no stopper on the record).
  expect(s.key).toBe('stopped');
  expect(JSON.stringify(s), 'the summary has no evidence that Aria stopped this owner-closed delegation').not.toContain('Aria');
});
