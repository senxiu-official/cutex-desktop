#!/usr/bin/env python3
"""Context size per request from Claude Code logs. usage: claude-context-report.py <claude config dir> <since ISO>"""
import datetime, glob, json, os, sys
home = os.path.expanduser(sys.argv[1]); since = datetime.datetime.fromisoformat(sys.argv[2]).timestamp()
sess = {}; allc = []
for f in glob.glob(os.path.join(home, 'projects', '*', '*.jsonl')):
    if os.path.getmtime(f) < since: continue
    seen = set(); key = os.path.basename(f)[:8]
    for line in open(f, encoding='utf-8', errors='ignore'):
        if '"usage"' not in line: continue
        try: d = json.loads(line)
        except ValueError: continue
        m = d.get('message') or {}; u = m.get('usage')
        if d.get('type') != 'assistant' or not u or not d.get('timestamp'): continue
        if datetime.datetime.fromisoformat(d['timestamp'].replace('Z', '+00:00')).timestamp() < since: continue
        if m.get('id') in seen: continue
        seen.add(m.get('id'))
        ctx = (u.get('input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0)
        s = sess.setdefault(key, dict(req=0, ctx=0, mx=0, cw=0, out=0, side=bool(d.get('isSidechain')), cwd=(d.get('cwd') or '')[-30:]))
        s['req'] += 1; s['ctx'] += ctx; s['mx'] = max(s['mx'], ctx); s['cw'] += u.get('cache_creation_input_tokens') or 0; s['out'] += u.get('output_tokens') or 0
        allc.append(ctx)
allc.sort(); n = len(allc); tot = sum(allc)
if not n: print('no requests'); sys.exit()
q = lambda p: allc[min(n - 1, int(n * p))]
print(f'requests={n} input={tot/1e9:.2f}B avgctx={tot/n/1e3:.0f}k p50={q(.5)/1e3:.0f}k p90={q(.9)/1e3:.0f}k max={allc[-1]/1e3:.0f}k')
for lo, hi in [(0, 100e3), (100e3, 200e3), (200e3, 300e3), (300e3, 450e3), (450e3, 600e3), (600e3, 2e6)]:
    sub = [c for c in allc if lo <= c < hi]
    print(f'  ctx {lo/1e3:4.0f}-{hi/1e3:4.0f}k: {len(sub)/n*100:5.1f}% of requests, {sum(sub)/tot*100:5.1f}% of input')
print('top sessions by input:')
for k, s in sorted(sess.items(), key=lambda kv: -kv[1]['ctx'])[:14]:
    print(f"  {k} {s['cwd']:30} req={s['req']:5} avg={s['ctx']/s['req']/1e3:4.0f}k max={s['mx']/1e3:4.0f}k input={s['ctx']/1e6:6.1f}M write={s['cw']/1e6:5.1f}M out={s['out']/1e3:5.0f}k")
