"""Extract a deterministic mechanical cycle from a licensed engine recording.
No white/brown noise is generated. Use the input license supplied by the owner.
Offline asset-authoring helper only; requires Python, numpy and scipy.
The game and its normal Vite build do not require Python.
The phase-synchronous average discards unsynchronised air/road hiss; a harmonic
projection then produces an exactly periodic, compact engine waveform.
"""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter,sosfiltfilt,hilbert,find_peaks

parser=argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('--output',default='work/v11-audio/extracted')
parser.add_argument('--start',type=float,default=0)
parser.add_argument('--duration',type=float,default=2)
parser.add_argument('--fundamental',type=float)
parser.add_argument('--source-url',default='')
parser.add_argument('--license',default='UNVERIFIED: DO NOT DISTRIBUTE')
args=parser.parse_args()
file=Path(args.source);rate,raw=wavfile.read(file)
x=raw.astype(np.float64)
if np.issubdtype(raw.dtype,np.integer):x/=max(abs(np.iinfo(raw.dtype).min),np.iinfo(raw.dtype).max)
if x.ndim>1:x=x.mean(axis=1)
x=x[int(args.start*rate):int((args.start+args.duration)*rate)]
if len(x)<rate*.3:raise ValueError('Need at least 0.3 seconds of engine PCM')
x-=x.mean();high=min(2400,rate*.45)
clean=sosfiltfilt(butter(4,[35,high],fs=rate,btype='bandpass',output='sos'),x)
if args.fundamental:f0=args.fundamental
else:
 fftsize=1<<(len(clean)*2-1).bit_length()
 ac=np.fft.irfft(np.abs(np.fft.rfft(clean,fftsize))**2)[:len(clean)]
 ac/=np.maximum(1,len(clean)-np.arange(len(clean)));ac/=max(1e-12,ac[0])
 lo=int(rate/260);hi=min(len(clean)-1,int(rate/35));peaks,_=find_peaks(ac[lo:hi],prominence=.03)
 candidates=peaks+lo
 if len(candidates)==0:raise ValueError('No stable engine period; choose a stationary segment or specify --fundamental')
 strongest=ac[candidates].max();possible=candidates[ac[candidates]>=max(.25,strongest*.85)]
 lag=int(possible[0] if len(possible) else candidates[np.argmax(ac[candidates])]);f0=rate/lag
phase_signal=sosfiltfilt(butter(3,[max(20,f0*.78),min(high,f0*1.22)],fs=rate,btype='bandpass',output='sos'),clean)
phase=np.unwrap(np.angle(hilbert(phase_signal)))
# Exclude filter/Hilbert edges; interpolate each complete cycle independently
# so slow recorded RPM drift doesn't smear its mechanical waveform.
margin=min(int(rate*.1),len(clean)//8)
start=int(np.ceil(phase[margin]/(2*np.pi)));end=int(np.floor(phase[-margin]/(2*np.pi)))
size=2048;cycles=[]
for turn in range(start,end):
 target=2*np.pi*(turn+np.arange(size)/size)
 cycles.append(np.interp(target,phase,clean))
if len(cycles)<6:raise ValueError('Need at least six complete engine cycles')
cycles=np.array(cycles)
# Trim outliers per phase bin; this is signal cleanup, not a random noise layer.
cycles.sort(axis=0);trim=len(cycles)//8
cycle=cycles[trim:len(cycles)-trim if trim else len(cycles)].mean(axis=0)
cycle-=cycle.mean()
coeff=np.fft.rfft(cycle);keep=min(48,int(high/f0));coeff[keep+1:]=0
# Gentle harmonic-edge taper avoids a sharp band limit without adding hiss.
for k in range(max(1,keep-8),keep+1):coeff[k]*=.5+.5*np.cos(np.pi*(k-(keep-8))/8)
cycle=np.fft.irfft(coeff,size);peak=np.max(np.abs(cycle));cycle/=max(1e-9,peak)
coeff=np.fft.rfft(cycle)
real=(coeff.real*2/size)[:keep+1];imag=(-coeff.imag*2/size)[:keep+1];real[0]=imag[0]=0
# Repeat a whole-number cycle at its estimated source frequency for inspection.
preview=np.interp(np.arange(int(rate*3))*f0/rate%1,np.arange(size+1)/size,np.r_[cycle,cycle[0]])*.7
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
wavfile.write(out/'mechanical-cycle-preview.wav',rate,(preview*32767).astype('<i2'))
report={'source':str(file.resolve()),'sourceURL':args.source_url,'license':args.license,'sourceSHA256':hashlib.sha256(file.read_bytes()).hexdigest(),'method':'Phase-synchronous trimmed cycle average, followed by harmonic projection; no generated random noise.','sourceRate':rate,'sourceSegmentStart':args.start,'sourceSegmentDuration':len(x)/rate,'estimatedFundamentalHz':float(f0),'cyclesAveraged':len(cycles),'harmonics':keep,'real':real.tolist(),'imag':imag.tolist(),'cycle':cycle.tolist(),'preview':'mechanical-cycle-preview.wav'}
(out/'mechanical-cycle.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ['real','imag','cycle']},ensure_ascii=False))
