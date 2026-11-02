# Subtítulos SRT + capítulos + metadatos del episodio a partir de su timeline. Uso: EPISODIO=ep2 python meta_episodio.py timeline.json salida_prefijo
import json, re, sys, os, importlib
ep = importlib.import_module(os.environ.get('EPISODIO', 'ep2')); BEATS = ep.BEATS
tl = json.load(open(sys.argv[1])); pref = sys.argv[2]; LEAD = float(os.environ.get('LEAD', 0.5))
def fmt(v): ms = int(round(v * 1000)); return f"{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}"
cues = []
for s in tl['sentences']:
    a, b = LEAD + s['start'], LEAD + s['end']; chunks = []
    for w in s['text'].split():
        if chunks and len(chunks[-1]) + len(w) < 42 and not re.search(r'[.!?]$', chunks[-1]): chunks[-1] += ' ' + w
        else: chunks.append(w)
    tot = sum(len(c) for c in chunks); t = a
    for c in chunks: d = (b - a) * len(c) / tot; cues.append(f"{len(cues)+1}\n{fmt(t)} --> {fmt(t+d)}\n{c}\n"); t += d
open(f'subtitulos-{pref}.srt', 'w').write('\n'.join(cues))
def start_of(prefix):
    i = next(i for i, b in enumerate(BEATS) if b['text'].startswith(prefix)); return 0.0 if i == 0 else LEAD + tl['sentences'][i]['start'] - 0.1
ts = lambda v: f"{int(v)//60}:{int(v)%60:02d}"
chap = [('The question and a 1975 mystery', 'What would you do if'), ('Now imagine it is you', 'Now imagine'), ('The science of the lucid brain', 'The signal was not a fluke'),
        ('What happens next: the shadow shows up', 'Week one'), ('Hermes, the Emerald Tablet and the Kybalion', 'People have noticed'), ('Carl Jung, alchemy and the shadow', 'Carl Jung spent'),
        ('How to start tonight', 'So, how do you start'), ('The one question to ask', 'A dream is the only place')]
chapters = '\n'.join(f"{ts(start_of(p))} {n}" for n, p in chap)
m = json.load(open('meta-ep2.json')); head = m['descripcion'].split('\n\n')[0]; rest = m['descripcion'].split('Sources and further reading')[1]
body = m['descripcion'].split('\n\n')[1]
m['descripcion'] = f"{head}\n\n{body}\n\n{chapters}\n\nSources and further reading{rest}"
json.dump(m, open(f'meta-{pref}.json', 'w'), indent=1); print(len(cues), 'subtítulos\n' + chapters)
