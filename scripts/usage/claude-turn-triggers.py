#!/usr/bin/env python3
"""Classify every Claude turn by what started it (owner, delegation task / result, Claude Task, alarm, ...) and sum its
cost (steps x context). usage: claude-turn-triggers.py <claude-accounts dir> <since ISO UTC> <out.json>
Reads only projects/*/*.jsonl. Tool counts are approximate (first record per message)."""
import glob, json, os, re, sys, collections
root = os.path.expanduser(sys.argv[1]); since = sys.argv[2]; out = sys.argv[3]
def cat(t):
    if t.startswith('EXTERNAL_INPUT_JSON'):
        m = re.search(r'"eventType":"([^"]+)"', t); e = m.group(1) if m else '?'
        if '[delegation results]' in t: return 'delegation_result'
        if re.search(r'\[delegation [^\]]*\] from', t) or e in ('delegation', 'DELEGATION'): return 'delegation_task'
        if '[delegation reminder]' in t: return 'delegation_reminder'
        return {'claude_task': 'claude_task', 'agent_message': 'agent_message', 'alarm': 'alarm'}.get(e, 'ext:' + e)
    if t.startswith('<task-notification>'): return 'cc_task_notification'
    if t.startswith('This session is being continued'): return 'compaction_resume'
    if t.startswith('[Request interrupted'): return 'interrupted'
    if t.startswith('<local-command') or t.startswith('<command-name>'): return 'local_command'
    if re.search(r'\[delegation [^\]]*\] from', t[:300]): return 'delegation_task'
    return 'owner'
turns = []
for f in glob.glob(os.path.join(root, '*', 'projects', '*', '*.jsonl')):
    sid = os.path.basename(f)[:8]; cur = None; seen = set()
    for line in open(f, encoding='utf-8', errors='ignore'):
        try: d = json.loads(line)
        except ValueError: continue
        ts = d.get('timestamp') or ''
        if d.get('type') == 'user' and not d.get('isSidechain'):
            ct = (d.get('message') or {}).get('content')
            if isinstance(ct, list):
                if any(isinstance(x, dict) and x.get('type') == 'tool_result' for x in ct): continue
                ct = ' '.join(x.get('text', '') for x in ct if isinstance(x, dict))
            t = (ct or '').strip()
            if not t: continue
            if cur and cur['cat'] in ('local_command',) and False: pass
            cur = dict(sid=sid, cwd=(d.get('cwd') or '')[-28:], ts=ts, cat=cat(t), head=t[:160].replace('\n', ' '),
                       steps=0, ctx=0, mx=0, cw=0, out=0, tools=0, edits=0, sub_steps=0, sub_ctx=0)
            if ts >= since: turns.append(cur)
            continue
        if d.get('type') != 'assistant' or cur is None or ts < since: continue
        m = d.get('message') or {}; u = m.get('usage')
        if not u or m.get('id') in seen: continue
        seen.add(m.get('id'))
        ctx = (u.get('input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0)
        if d.get('isSidechain'):
            cur['sub_steps'] += 1; cur['sub_ctx'] += ctx; continue
        cur['steps'] += 1; cur['ctx'] += ctx; cur['mx'] = max(cur['mx'], ctx); cur['cw'] += u.get('cache_creation_input_tokens') or 0; cur['out'] += u.get('output_tokens') or 0
        for x in m.get('content') or []:
            if isinstance(x, dict) and x.get('type') == 'tool_use':
                cur['tools'] += 1
                if x.get('name') in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit'): cur['edits'] += 1
json.dump(turns, open(out, 'w'))
agg = collections.defaultdict(lambda: collections.Counter())
for t in turns:
    a = agg[t['cat']]; a['turns'] += 1; a['steps'] += t['steps']; a['ctx'] += t['ctx'] + t['sub_ctx']; a['cw'] += t['cw']; a['out'] += t['out']
    if t['steps'] <= 2: a['tiny'] += 1; a['tiny_ctx'] += t['ctx']
tot = sum(a['ctx'] for a in agg.values())
print(f'turns={len(turns)} input={tot/1e9:.2f}B')
for k, a in sorted(agg.items(), key=lambda kv: -kv[1]['ctx']):
    print(f"{k:22} turns={a['turns']:5} steps={a['steps']:6} input={a['ctx']/1e6:8.1f}M ({a['ctx']/tot*100:4.1f}%) per-turn={a['ctx']/a['turns']/1e6:6.2f}M write={a['cw']/1e6:6.1f}M out={a['out']/1e3:6.0f}k tiny(<=2 steps)={a['tiny']} cost={a['tiny_ctx']/1e6:.1f}M")
