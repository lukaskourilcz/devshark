"""Build a self-contained, offline owner review. Standard-library only.
Usage: python3 docs/ux-review-round3-2026-11-05/build-review.py
"""
from pathlib import Path
import base64
import json
import mimetypes

ROOT = Path(__file__).resolve().parent

def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))

def embedded(name):
    path = ROOT / name
    mime = mimetypes.guess_type(str(path))[0]
    assert mime and mime.startswith('image/')
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii')

captures = read('capture-manifest.json')
references = read('references.json')
data = dict(
    baseline='ca5900282d5e4cc2aa115d5d02585ac056a6d58d',
    findings=read('findings.json'), scenes=read('scenes.json'), captures=captures,
    references=references, coverage=read('coverage.json'), research=read('research-log.json'),
    images={row['id']+'-'+phase: embedded('screens/'+row['id']+'-'+phase+'.png')
            for row in captures for phase in ('before', 'after')},
    referenceImages={ref['id']: embedded(ref['image']) for ref in references},
)
assert len({f['id'] for f in data['findings']}) == len(data['findings'])
assert len({c['id'] for c in captures}) == len(captures)
for finding in data['findings']:
    assert any(c['scene'] in finding['scenes'] for c in captures), finding['id']
payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
template = (ROOT / 'review-template.html').read_text(encoding='utf-8')
assert template.count('__REVIEW_DATA__') == 1
(ROOT / 'index.html').write_text(template.replace('__REVIEW_DATA__', payload), encoding='utf-8')
print(f'Built {len(data["findings"])} decisions, {len(captures)} matched pairs, {len(references)} inspected references.')
