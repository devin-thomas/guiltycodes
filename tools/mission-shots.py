"""Converts the PS2 Accent Core Plus screenshots the Mission Editor page uses to WebP in src/mission-shots/.

The folder is gitignored: the site does not commit game imagery. The site build copies it to dist/assets/missions/
when it exists, and the page shows an empty frame for any shot that is missing.

Sources (captures root, default E:/holding bay/retro-graphics-research/captures, override with --src or GC_CAPTURES):
  ggacplus-missions/ui-library/manifest.json   201 entries: file, scene, mission, res, caption. Used for
      native/ms-info-stock-noNN.png (NN 1-30, the info screen of each slot; 26-30 were unlocked on a throwaway card),
      one native fight shot per mission that has one, and a few scene shots for the walk-through box.
      The 3x/ files and native-research-run/ (26-30 there are wrapped repeats of 1-5) are never read.
  ggacplus-missions/ms-info-stock-noNN.png     fallback for NN 1-25 when the library is missing
  ggacplus-missions/ms-m1-patch-a1-info.png, ms-m1-patch-c1-fight.png    the Mission 1 demo proof
Never read: captures/acplusr-footage (the PC +R release, not PS2).

Writes info-NN.webp, fight-NN.webp, demo-*.webp, ui/<name>.webp and shots.json (what exists, with captions).
"""
import argparse, json, os, shutil, sys
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--src', default=os.environ.get('GC_CAPTURES', r'E:\holding bay\retro-graphics-research\captures'))
ap.add_argument('--out', default=os.path.join(here, '..', 'src', 'mission-shots'))
a = ap.parse_args()
M = os.path.join(a.src, 'ggacplus-missions')
if 'acplusr-footage' in os.path.abspath(M).lower():
    sys.exit('refusing to read +R footage')
shutil.rmtree(a.out, ignore_errors=True)
os.makedirs(os.path.join(a.out, 'ui'))

def conv(src, dst, q=72):
    im = Image.open(src).convert('RGB')
    im.save(dst, 'WEBP', quality=q, method=6)
    return os.path.getsize(dst)

FEATURED = ['title-press-start', 'main-menu-mission', 'mission-select-start', 'charsel-grid', 'fight-m01-combo', 'clear-congratulations']
total, n = 0, 0
shots = {'info': {}, 'fights': {}, 'featured': []}

def add(src, dst):
    global total, n
    total += conv(src, dst); n += 1
    return Image.open(dst).size

# the library manifest: a list of entries, or {shots|items|images|files|entries: [...]}; entries have file, scene, mission,
# res, caption (a bare filename also works)
lib = os.path.join(M, 'ui-library')
entries = []
mf = os.path.join(lib, 'manifest.json')
if os.path.exists(mf):
    raw = json.load(open(mf, encoding='utf-8'))
    items = raw
    if isinstance(raw, dict):
        items = next((raw[k] for k in ('shots', 'items', 'images', 'files', 'entries') if k in raw), raw)
    for e in items:
        e = {'file': e} if isinstance(e, str) else e
        f = e.get('file') or e.get('filename') or e.get('path')
        if f and f.startswith('native/') and os.path.exists(os.path.join(lib, f)):
            e['file'] = f
            entries.append(e)
by_name = {os.path.splitext(os.path.basename(e['file']))[0]: e for e in entries}

for i in range(1, 31):
    e = by_name.get(f'ms-info-stock-no{i:02d}')
    src = os.path.join(lib, e['file']) if e else os.path.join(M, f'ms-info-stock-no{i:02d}.png')
    if i > 25 and not e:
        continue  # the old stock captures for 26-30 are wrapped repeats of 1-5
    if not os.path.exists(src):
        continue
    add(src, os.path.join(a.out, f'info-{i:02d}.webp'))
    shots['info'][str(i)] = {'file': f'info-{i:02d}.webp', 'caption': (e or {}).get('caption', '')}
for name in ('a1-info', 'c1-fight'):
    add(os.path.join(M, f'ms-m1-patch-{name}.png'), os.path.join(a.out, 'demo-' + name.split('-')[1] + '.webp'))

for e in entries:
    if e.get('scene') == 'fight' and e.get('mission') and str(e['mission']) not in shots['fights']:
        m = str(e['mission'])
        name = os.path.splitext(os.path.basename(e['file']))[0]
        add(os.path.join(lib, e['file']), os.path.join(a.out, f'fight-{int(m):02d}.webp'))
        shots['fights'][m] = {'file': f'fight-{int(m):02d}.webp', 'caption': e.get('caption', '')}
for name in FEATURED:
    e = by_name.get(name)
    if not e:
        continue
    w, h = add(os.path.join(lib, e['file']), os.path.join(a.out, 'ui', name + '.webp'))
    shots['featured'].append({'file': name + '.webp', 'scene': e.get('scene') or name, 'caption': e.get('caption') or name, 'mission': e.get('mission'), 'width': w, 'height': h})
json.dump(shots, open(os.path.join(a.out, 'shots.json'), 'w', encoding='utf-8'), indent=1)
print(f"{n} images, {total/1024:.0f} KiB -> {os.path.abspath(a.out)}; info {len(shots['info'])}, fights {len(shots['fights'])}, featured {len(shots['featured'])}")
