#!/usr/bin/env python3
"""
Reference oracle for the ANDX Web2 assessment (independent of the system under test).

Implements spec sections 4.1-4.6 in plain Python (single process, in memory) and emits an
expected-answers file in the same shape as web2-kit/expected/*.json, so the official checker can be
pointed at ANY seed:

  node web2-kit/generator/andx-gen.js gen --preset small --seed 3 --out ./data-small-3
  python3 tools/oracle/oracle.py --data ./data-small-3 --out ./expected-small-3.json
  node web2-kit/generator/andx-gen.js check --expected ./expected-small-3.json

Verify the oracle itself against the official file:
  python3 tools/oracle/oracle.py --data ./data-small --compare web2-kit/expected/small-seed7.json

Scope: small and medium presets (needs RAM roughly 1 GB per 1M events). Not intended for 'full'.
Written independently from the spec; it must never import or share code with the services.
"""
import argparse, bisect, datetime, gzip, hashlib, json, random, re, sys
from collections import defaultdict

RE_EID = re.compile(r'^[0-9a-f]{16}$'); RE_CLIP = re.compile(r'^c_\d{7}$')
RE_CAMP = re.compile(r'^k_\d{5}$');    RE_USER = re.compile(r'^u_\d{6}$')
RE_TS = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
UTC = datetime.timezone.utc
LO = int(datetime.datetime(2020, 1, 1, tzinfo=UTC).timestamp() * 1000)
HI = int(datetime.datetime(2100, 1, 1, tzinfo=UTC).timestamp() * 1000)
LATE_MS = 6 * 3600 * 1000
HOUR = 3600 * 1000

def isint(x): return isinstance(x, int) and not isinstance(x, bool)

def parse_ts(s):
    if not isinstance(s, str) or not RE_TS.match(s): return None
    try: d = datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC)
    except ValueError: return None
    return int(d.timestamp() * 1000)

def iso(ms): return datetime.datetime.fromtimestamp(ms / 1000, UTC).strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (ms % 1000)

def validate(line):
    """-> (record|None, kind). kind in view|clip_text|invalid"""
    try: o = json.loads(line)
    except Exception: return None, 'invalid'
    if not isinstance(o, dict): return None, 'invalid'
    v = o.get('v')
    if not (isint(v) and v in (1, 2)): return None, 'invalid'
    if not (isinstance(o.get('event_id'), str) and RE_EID.match(o['event_id'])): return None, 'invalid'
    t = o.get('type')
    if v == 1 and not (t is None or t == 'view_snapshot'): return None, 'invalid'
    if v == 2 and t not in ('view_snapshot', 'clip_text'): return None, 'invalid'
    if not (isinstance(o.get('clip_id'), str) and RE_CLIP.match(o['clip_id'])): return None, 'invalid'
    if not (isinstance(o.get('campaign_id'), str) and RE_CAMP.match(o['campaign_id'])): return None, 'invalid'
    if t == 'clip_text':
        c, tr = o.get('caption'), o.get('transcript')
        if isinstance(c, str) and len(c) <= 5000 and isinstance(tr, str) and len(tr) <= 20000: return o, 'clip_text'
        return None, 'invalid'
    if not (isinstance(o.get('creator_id'), str) and RE_USER.match(o['creator_id'])): return None, 'invalid'
    if v == 1:
        ob, em, vw = parse_ts(o.get('observed_at')), parse_ts(o.get('emitted_at')), o.get('views')
    else:
        ob, em, vw = o.get('observed_at_ms'), o.get('emitted_at_ms'), o.get('view_count')
        if not (isint(ob) and isint(em)): return None, 'invalid'
    if ob is None or em is None or not isint(vw): return None, 'invalid'
    if not (LO <= ob < HI and LO <= em < HI): return None, 'invalid'
    if not (0 <= vw <= 2_000_000_000): return None, 'invalid'
    if em < ob: return None, 'invalid'
    return dict(eid=o['event_id'], clip=o['clip_id'], camp=o['campaign_id'], user=o['creator_id'], ob=ob, em=em, views=vw), 'view'

def open_events(d):
    import os
    p = os.path.join(d, 'events.ndjson')
    if os.path.exists(p): return open(p, encoding='utf8')
    return gzip.open(p + '.gz', 'rt', encoding='utf8')

def ingest(d, camps):
    invalid, late, acc, unk = set(), set(), {}, {}
    with open_events(d) as f:
        for line in f:
            line = line.rstrip('\n')
            if line.endswith('\r'): line = line[:-1]
            if not line: continue
            r, kind = validate(line)
            if kind == 'invalid':
                key = None
                try:
                    o = json.loads(line)
                    if isinstance(o, dict) and isinstance(o.get('event_id'), str): key = o['event_id']
                except Exception: pass
                invalid.add(key or hashlib.sha256(line.encode()).hexdigest()); continue
            if kind == 'clip_text': continue
            if r['em'] - r['ob'] > LATE_MS: late.add(r['eid']); continue
            if r['camp'] not in camps: unk[r['eid']] = r; continue
            acc[r['eid']] = r
    return invalid, late, acc, unk

class Index:
    def __init__(self, acc):
        by = defaultdict(list)
        for r in acc.values(): by[r['clip']].append(r)
        self.obs, self.views, self.info = {}, {}, {}
        for c, l in by.items():
            l.sort(key=lambda r: r['ob'])
            self.obs[c] = [r['ob'] for r in l]; self.views[c] = [r['views'] for r in l]
            self.info[c] = (l[0]['camp'], l[0]['user'])
    def V(self, c, t):
        o = self.obs.get(c)
        if not o: return 0
        i = bisect.bisect_left(o, t)          # strictly before t
        return self.views[c][i - 1] if i else 0

def allocate(earned, budget):
    """earned: {clip: cents} -> {clip: paid}. Spec 4.5."""
    raw = sum(earned.values())
    if raw <= budget: return dict(earned), raw
    paid, rem = {}, {}
    for c, e in earned.items(): paid[c] = e * budget // raw; rem[c] = (e * budget) % raw
    left = budget - sum(paid.values())
    for c in sorted(earned, key=lambda c: (-rem[c], c))[:left]: paid[c] += 1
    return paid, raw

def compute(idx, allc):
    percamp = defaultdict(dict)
    for c, (k, u) in idx.info.items():
        cp = allc[k]; end = parse_ts(cp['end_at'])
        percamp[k][c] = min(cp['per_clip_cap_cents'], idx.V(c, end) * cp['cpm_cents'] // 1000)
    paid, spend = {}, {}
    for k, m in percamp.items():
        p, raw = allocate(m, allc[k]['budget_cents']); paid.update(p)
        spend[k] = dict(campaign_id=k, budget_cents=allc[k]['budget_cents'], raw_earnings_cents=raw,
                        spend_cents=sum(p.values()), budget_exhausted=raw > allc[k]['budget_cents'],
                        paid_clips=sum(1 for v in p.values() if v > 0))
    return paid, spend

def creator_view(idx, paid, uid):
    by = defaultdict(lambda: [0, 0])
    for c, p in paid.items():
        k, u = idx.info[c]
        if u == uid and p > 0: by[k][0] += 1; by[k][1] += p
    camps = [dict(campaign_id=k, clips=v[0], earned_cents=v[1]) for k, v in sorted(by.items())]
    return dict(creator_id=uid, total_cents=sum(c['earned_cents'] for c in camps), campaigns=camps)

def top_clips(idx, camp_clips, k, f, t):
    res = []
    for c in camp_clips.get(k, ()):
        g = idx.V(c, t) - idx.V(c, f)
        if g > 0: res.append((-g, c, idx.info[c][1]))
    res.sort()
    return res

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True); ap.add_argument('--out')
    ap.add_argument('--compare', help='official expected JSON to verify this oracle against')
    ap.add_argument('--creators', type=int, default=200); ap.add_argument('--queries', type=int, default=10)
    ap.add_argument('--sample-seed', type=int, default=1)
    a = ap.parse_args()
    camps = {c['campaign_id']: c for c in json.load(open(a.data + '/campaigns.json'))}
    late_c = {c['campaign_id']: c for c in json.load(open(a.data + '/campaigns-late.json'))}
    invalid, late, acc, unk = ingest(a.data, camps)
    before = dict(stats=dict(distinct_valid_events=len(acc), late_dropped=len(late),
                             dlq_pending=dict(invalid_schema=len(invalid), unknown_campaign=len(unk))))
    allc = {**camps, **late_c}
    still = 0
    for e, r in list(unk.items()):
        if r['camp'] in late_c: acc[e] = r
        else: still += 1
    final_stats = dict(distinct_valid_events=len(acc), late_dropped=len(late),
                       dlq_pending=dict(invalid_schema=len(invalid), unknown_campaign=still))
    idx = Index(acc); paid, spend = compute(idx, allc)
    camp_clips = defaultdict(list)
    for c, (k, u) in idx.info.items(): camp_clips[k].append(c)

    if a.compare:
        E = json.load(open(a.compare)); bad = 0
        def chk(name, ok):
            nonlocal bad
            if not ok: bad += 1; print('MISMATCH', name)
        chk('before_replay.stats', before['stats'] == E['before_replay']['stats'])
        chk('final.stats', final_stats == E['final']['stats'])
        for w in E['final']['spend']:
            s = spend.get(w['campaign_id'], dict(raw_earnings_cents=0, spend_cents=0, budget_exhausted=False, paid_clips=0))
            chk('spend ' + w['campaign_id'], all(s[k] == w[k] for k in ('raw_earnings_cents', 'spend_cents', 'budget_exhausted', 'paid_clips')))
        for w in E['final']['earnings']:
            chk('earnings ' + w['creator_id'], creator_view(idx, paid, w['creator_id']) == {k: w[k] for k in ('creator_id', 'total_cents', 'campaigns')})
        for q in E['final']['top']:
            r = top_clips(idx, camp_clips, q['campaign_id'], parse_ts(q['from']), parse_ts(q['to']))
            got = [[c, u, -g] for g, c, u in r[:len(q['items'])]]
            chk('top ' + q['campaign_id'], got == [[x['clip_id'], x['creator_id'], x['views_gained']] for x in q['items']] and len(r) == q['total'])
        print('oracle vs official:', 'ALL MATCH' if not bad else f'{bad} MISMATCHES'); sys.exit(1 if bad else 0)

    rnd = random.Random(a.sample_seed)
    users = sorted({u for (_, u) in idx.info.values()})
    earners = sorted({idx.info[c][1] for c, p in paid.items() if p > 0})
    pick = sorted(set(rnd.sample(earners, min(a.creators, len(earners))) + ['u_999999']))
    queries = []
    big = sorted(camp_clips, key=lambda k: -len(camp_clips[k]))[:max(a.queries, 1)]
    for i in range(a.queries):
        k = big[i % len(big)]; f_h = rnd.randrange(0, 150); t_h = min(168, f_h + rnd.randrange(6, 72))
        f = parse_ts('2026-01-05T00:00:00.000Z') + f_h * HOUR; t = parse_ts('2026-01-05T00:00:00.000Z') + t_h * HOUR
        r = top_clips(idx, camp_clips, k, f, t)
        queries.append(dict(campaign_id=k, from_=iso(f), to=iso(t), total=len(r),
                            items=[dict(clip_id=c, creator_id=u, views_gained=-g) for g, c, u in r[:100]]))
    for q in queries: q['from'] = q.pop('from_')
    out = dict(meta=dict(source='tools/oracle/oracle.py', data=a.data),
               before_replay=before,
               final=dict(stats=final_stats, spend=[spend[k] for k in sorted(spend)],
                          earnings=[creator_view(idx, paid, u) for u in pick], top=queries))
    json.dump(out, open(a.out or 'expected.json', 'w'))
    print('wrote', a.out or 'expected.json', before['stats'], final_stats)

if __name__ == '__main__': main()
