#!/usr/bin/env python3
"""Per-session Claude token usage from Claude Code's own session logs (read-only).

Works for any Claude config dir: cutex's (~/.cutex/claude-home) and Claude desktop / CLI (~/.claude),
so the two can be compared over the same window.

  python3 scripts/claude-usage-report.py --since 60            # last 60 minutes, cutex + ~/.claude
  python3 scripts/claude-usage-report.py --since 300 --home ~/.claude

Columns: requests, average context per request (cache read + cache write + uncached input),
cache reads, cache writes, uncached input, output. Cache reads dominate subscription usage when
contexts are large: every request re-reads the whole conversation.
"""
import argparse, datetime, glob, json, os, time

def scan(home, since):
    rows = {}
    for f in glob.glob(os.path.join(os.path.expanduser(home), 'projects', '*', '*.jsonl')):
        if os.path.getmtime(f) < since:
            continue
        key = (os.path.basename(os.path.dirname(f))[-40:], os.path.basename(f)[:8])
        a = rows.setdefault(key, dict(req=0, inp=0, cr=0, cw=0, out=0, models=set()))
        seen = set()
        for line in open(f, errors='ignore'):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get('message') or {}
            u = m.get('usage')
            if d.get('type') != 'assistant' or not u or not d.get('timestamp'):
                continue
            if datetime.datetime.fromisoformat(d['timestamp'].replace('Z', '+00:00')).timestamp() < since:
                continue
            if m.get('id') in seen:
                continue
            seen.add(m.get('id'))
            a['req'] += 1
            a['inp'] += u.get('input_tokens', 0) or 0
            a['cr'] += u.get('cache_read_input_tokens', 0) or 0
            a['cw'] += u.get('cache_creation_input_tokens', 0) or 0
            a['out'] += u.get('output_tokens', 0) or 0
            if m.get('model'):
                a['models'].add(m['model'])
    return {k: v for k, v in rows.items() if v['req']}

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--since', type=float, default=60, help='minutes back (default 60)')
    p.add_argument('--home', action='append', help='Claude config dir(s); default: ~/.cutex/claude-home and ~/.claude')
    a = p.parse_args()
    since = time.time() - a.since * 60
    for home in a.home or ['~/.cutex/claude-home', '~/.claude']:
        rows = scan(home, since)
        print(f'== {home}  (last {a.since:g} min)')
        tot = dict(req=0, inp=0, cr=0, cw=0, out=0)
        for (proj, sid), v in sorted(rows.items(), key=lambda kv: -(kv[1]['cr'] + kv[1]['cw'])):
            ctx = (v['cr'] + v['cw'] + v['inp']) / v['req']
            print(f"  {sid} {proj[-28:]:28} req={v['req']:4} avgctx={ctx/1000:7.0f}k read={v['cr']/1e6:7.2f}M write={v['cw']/1e6:6.2f}M out={v['out']/1000:6.1f}k {','.join(sorted(v['models']))}")
            for k in tot:
                tot[k] += v[k]
        if tot['req']:
            print(f"  TOTAL req={tot['req']} read={tot['cr']/1e6:.2f}M write={tot['cw']/1e6:.2f}M uncached={tot['inp']/1000:.1f}k out={tot['out']/1000:.1f}k")
        else:
            print('  (no requests)')

if __name__ == '__main__':
    main()
