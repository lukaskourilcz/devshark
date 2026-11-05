"""Build the offline, self-contained owner review. Standard-library only.
Run from any directory: python3 docs/ux-review-platform-comments-2026-11-05/build-review.py
Screens are authenticated only with local fictional fixtures where labelled.
"""
from pathlib import Path
import base64
import json

ROOT = Path(__file__).resolve().parent

def read(name):
    return json.loads((ROOT / name).read_text())

def embedded(path):
    return 'data:image/webp;base64,' + base64.b64encode((ROOT / path).read_bytes()).decode('ascii')

captures = read('capture-manifest.json')
references = []
data = dict(findings=read('findings.json'), scenes=read('scenes.json'), captures=captures,
            references=references,
            images={row['id']+'-'+phase: embedded('screens/'+row['id']+'-'+phase+'.webp')
                    for row in captures for phase in ('before', 'after')},
            referenceImages={ref['id']: embedded(ref['image']) for ref in references})
# Data cannot terminate the JSON script element, even if future copy contains HTML.
payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
template = (ROOT / 'review-template.html').read_text()
assert template.count('__REVIEW_DATA__') == 1
(ROOT / 'index.html').write_text(template.replace('__REVIEW_DATA__', payload))
print(f'Built {len(data["findings"])} decisions, {len(captures)} matched pairs, {len(references)} inspected references.')
