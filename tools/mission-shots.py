"""Converts the PS2 Accent Core Plus screenshots the Mission Editor page uses to WebP in src/mission-shots/.

The folder is gitignored: the site does not commit game imagery. The site build copies it to dist/assets/missions/
when it exists, and the page shows an empty frame for any shot that is missing.

Sources (captures root, default E:/holding bay/retro-graphics-research/captures, override with --src or GC_CAPTURES):
  ggacplus-missions/ms-info-stock-noNN.png         the real info screen of Mission NN, stock disc (NN 1-25)
  ggacplus-missions/ms-m1-patch-a1-info.png        the info screen after the Mission 1 demo patch
  ggacplus-missions/ms-m1-patch-c1-fight.png       the fight that patch starts
  ggacplus-missions/ui-library/manifest.json       (when it arrives) menu, select, HUD and clear screens
Never read: captures/acplusr-footage (the PC +R release, not PS2).

ms-info-stock-no26..30 are skipped on purpose: the stock selector wraps after 25, so those files are No. 1 to 5 again.
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

total, n = 0, 0
for i in range(1, 26):
    total += conv(os.path.join(M, f'ms-info-stock-no{i:02d}.png'), os.path.join(a.out, f'info-{i:02d}.webp')); n += 1
total += conv(os.path.join(M, 'ms-m1-patch-a1-info.png'), os.path.join(a.out, 'demo-info.webp')); n += 1
total += conv(os.path.join(M, 'ms-m1-patch-c1-fight.png'), os.path.join(a.out, 'demo-fight.webp')); n += 1

# ui-library: arrives later from the capture agent. Tolerant reader: a list of entries, or {key: entry}; an entry is a
# filename or an object with file/filename/path and title/name/label.
ui = []
lib = os.path.join(M, 'ui-library')
mf = os.path.join(lib, 'manifest.json')
if os.path.exists(mf):
    raw = json.load(open(mf, encoding='utf-8'))
    items = raw.get('shots', raw.get('items', raw)) if isinstance(raw, dict) else raw
    if isinstance(items, dict):
        items = [{'key': k, **(v if isinstance(v, dict) else {'file': v})} for k, v in items.items()]
    for e in items:
        if isinstance(e, str):
            e = {'file': e}
        f = e.get('file') or e.get('filename') or e.get('path')
        if not f or not os.path.exists(os.path.join(lib, f)) or not f.lower().endswith(('.png', '.jpg', '.jpeg')):
            continue
        name = os.path.splitext(os.path.basename(f))[0]
        total += conv(os.path.join(lib, f), os.path.join(a.out, 'ui', name + '.webp')); n += 1
        ui.append({'file': name + '.webp', 'title': e.get('title') or e.get('name') or e.get('label') or e.get('key') or name, 'source': f})
json.dump(ui, open(os.path.join(a.out, 'ui.json'), 'w', encoding='utf-8'), indent=1)
print(f'{n} images, {total/1024:.0f} KiB -> {os.path.abspath(a.out)}; ui-library entries: {len(ui)}')
