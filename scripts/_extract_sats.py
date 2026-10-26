"""One-off: lift the hand-written SATS array out of compendium.html into JSON
so the curation survives the move to a generated catalogue.
Field values use single quotes inside HTML, so a plain "..." match is safe."""
import io, json, re

html = io.open('compendium.html', encoding='utf-8', newline='').read().replace('\r\n', '\n')
start = html.index('const SATS = [')
end = html.index('\n];', start)
body = html[start + len('const SATS = ['):end]

out, bad = [], 0
for line in body.split('\n'):
    line = line.strip().rstrip(',')
    if not (line.startswith('{') and line.endswith('}')):
        continue
    rec = dict(re.findall(r'(\w+):"([^"]*)"', line))
    (out if rec.get('norad') else bad) and None
    if rec.get('norad'):
        out.append(rec)
    else:
        bad += 1
json.dump(out, open('scripts/compendium_curated.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('extracted', len(out), 'entries,', bad, 'unparsed')
print('fields:', sorted({k for r in out for k in r}))
