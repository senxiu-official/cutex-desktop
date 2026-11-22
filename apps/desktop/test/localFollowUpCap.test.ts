// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { endLocalFollowUp, localFollowUpEnded, MAX_ENTRIES, resetLocalFollowUps, subagentFollowUpKey } from '../src/renderer/src/lib/localFollowUp';
beforeEach(() => resetLocalFollowUps());
it('REVIEW: cap evicts an older occurrence and retains the newest occurrence', () => {
  const keys = Array.from({length:MAX_ENTRIES}, (_,i) => subagentFollowUpKey('h','a',`old-${i}`));
  endLocalFollowUp(keys,1000);
  const recent = subagentFollowUpKey('h','a','recent');
  endLocalFollowUp([recent],1001);
  expect(localFollowUpEnded()[recent]).toBe(1001);
  expect(Object.keys(localFollowUpEnded())).toHaveLength(MAX_ENTRIES);
});
it('REVIEW: cap must retain a just-ended occurrence even when timestamps tie', () => {
  const keys = Array.from({length:MAX_ENTRIES}, (_,i) => subagentFollowUpKey('h','a',`old-${i}`));
  endLocalFollowUp(keys,1000);
  const recent = subagentFollowUpKey('h','a','recent');
  endLocalFollowUp([recent],1000);
  expect(Object.keys(localFollowUpEnded())).toHaveLength(MAX_ENTRIES);
  expect(localFollowUpEnded()[recent], 'the just-confirmed row must hide immediately, not be discarded by the cap').toBe(1000);
});
it('on equal times the later write survives, also after a reload of the stored order', () => {
  const keys = Array.from({length:MAX_ENTRIES}, (_,i) => subagentFollowUpKey('h','a',`old-${i}`));
  endLocalFollowUp(keys,1000);
  // Re-ending the first mark makes it the newest write; the next tie evicts old-1, not old-0.
  endLocalFollowUp([keys[0]!],1000);
  endLocalFollowUp([subagentFollowUpKey('h','a','recent')],1000);
  const ended = localFollowUpEnded();
  expect(ended[keys[0]!]).toBe(1000);
  expect(ended[keys[1]!]).toBeUndefined();
  expect(Object.keys(ended).at(-1)).toBe(subagentFollowUpKey('h','a','recent'));
  expect(JSON.parse(localStorage.getItem('cutex-desktop.localFollowUpEnded')!)).toEqual(ended);
});
