"""Writes data/mission-editor.json for the Mission Editor page.

Reads the field table (FIELDS in tools/missions.py) and the 30 stock records (data/missions_us.csv) from a
checkout of the mission research (games/ggacplus-missions) and flattens them into the STOCK and FIELDS
shapes that src/mission-data.js expects. The site build only reads the JSON; nothing here runs at build time.

  python tools/mission-data.py --src C:/dev/personal/rgr-missions/games/ggacplus-missions
"""
import argparse, csv, json, os, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True, help='games/ggacplus-missions checkout')
ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'mission-editor.json'))
a = ap.parse_args()

src = open(os.path.join(a.src, 'tools', 'missions.py'), encoding='utf-8').read()
block = src[src.index('FIELDS = {'):]
block = block[:block.index('\n}\n') + 3]
ns = {}
exec(block, ns)  # a dict literal of constants
FIELDS = ns['FIELDS']

rows = list(csv.DictReader(open(os.path.join(a.src, 'data', 'missions_us.csv'), encoding='utf-8')))
stock = []
for r in rows:
    rec = {'mission': int(r['mission']), 'enemy_name': r['enemy_name'], 'p': {}, 'e': {}, 'c': {}}
    for name, (po, eo, _) in FIELDS.items():
        if eo is None:
            rec['c'][name] = int(r[name])
        else:
            rec['p'][name] = int(r['p.' + name])
            rec['e'][name] = int(r['e.' + name])
    stock.append(rec)
fields = [{'key': k, 'p': po, 'e': eo, 'note': note} for k, (po, eo, note) in FIELDS.items()]

def git(*args):
    try:
        return subprocess.check_output(['git', '-C', a.src, *args], text=True).strip()
    except Exception:
        return 'unknown'

out = {
    'source': {'repo': 'retro-graphics-research (mission-research)', 'branch': git('rev-parse', '--abbrev-ref', 'HEAD'),
               'commit': git('rev-parse', '--short', 'HEAD'), 'files': ['tools/missions.py FIELDS', 'data/missions_us.csv']},
    'stock': stock, 'fields': fields,
}
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
    f.write('\n')
print('ok', len(stock), 'missions', len(fields), 'fields ->', os.path.abspath(a.out), out['source'])
