import json, re, subprocess, sys
d = json.load(open(sys.argv[2]))['sentences']; wav = sys.argv[1]
def toks(s): return re.findall(r"[a-z']+", s.lower().replace('nineteen oh eight','1908').replace('two thousand nine','2009').replace('nineteen seventy-five','1975'))
def wer(r, h):
    r, h = toks(r), toks(h); prev = list(range(len(h)+1))
    for i in range(1, len(r)+1):
        cur = [i]+[0]*len(h)
        for j in range(1, len(h)+1): cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+(r[i-1]!=h[j-1]))
        prev = cur
    return prev[-1]/max(1,len(r))
te = tn = 0
for k in range(0, int(d[-1]['end'])+1, 60):
    exp = ' '.join(x['text'] for x in d if k <= x['start'] < k+60)
    if not exp: continue
    subprocess.run(['ffmpeg','-loglevel','error','-y','-ss',str(k),'-t','62','-i',wav,'-ar','16000','-ac','1','/tmp/seg.wav'], check=True)
    hyp = subprocess.run(['curl','-sf','http://127.0.0.1:7432/inference','-F','file=@/tmp/seg.wav','-F','language=en','-F','response_format=text'], capture_output=True, text=True).stdout
    e = wer(exp, hyp); n = len(toks(exp)); te += e*n; tn += n; print(f'{k:>3}-{k+60:<3} s  error {e*100:4.0f}%  ({n} palabras)')
print(f'error medio ponderado: {te/tn*100:.1f}%')
