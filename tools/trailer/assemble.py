#!/usr/bin/env python3
# Cut the rendered frame folders into the trailer: crossfaded shots, the game's
# own music bed and stingers, H.264 1080p for X.   python3 assemble.py
import os, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(HERE, 'frames')
MUSIC = os.path.join(HERE, '..', '..', 'assets', 'audio', 'music')
FPS = 24
XF = 6                                   # crossfade frames between shots
ORDER = ['intro', 'landmarks', 'drone_sierra', 'road_sierra', 'road_coastal', 'road_desert', 'drone_ghat', 'brawl',
         'crash', 'cops', 'bust', 'monowheel', 'win', 'outro']

import sys
# optional: python3 assemble.py OUT.mp4 shot[:first_frame] ...   (a draft from what is rendered)
OUT = sys.argv[1] if len(sys.argv) > 1 else 'riderash-trailer-1080p.mp4'
if len(sys.argv) > 2: ORDER = sys.argv[2:]
FIRST = {o.split(':')[0]: int(o.split(':')[1]) if ':' in o else 0 for o in ORDER}
ORDER = [o.split(':')[0] for o in ORDER]
shots = [(s, len([f for f in os.listdir(os.path.join(F, s)) if f.endswith('.jpg')]) - FIRST[s]) for s in ORDER]
for s, n in shots: print(f'{s:14} {n:4} frames')

args, fc, starts = ['ffmpeg', '-y', '-loglevel', 'error'], [], {}
for k, (s, n) in enumerate(shots):
    args += ['-framerate', str(FPS), '-start_number', str(FIRST[s]), '-i', os.path.join(F, s, '%05d.jpg')]
    fc.append(f'[{k}:v]format=yuv420p,setsar=1,settb=AVTB,fps={FPS}[v{k}]')
# the crossfade chain
t = shots[0][1] / FPS
starts[shots[0][0]] = 0.0
prev = 'v0'
for k in range(1, len(shots)):
    off = t - XF / FPS
    starts[shots[k][0]] = off
    fc.append(f'[{prev}][v{k}]xfade=transition=fade:duration={XF / FPS:.4f}:offset={off:.4f}[x{k}]')
    prev = f'x{k}'
    t = off + shots[k][1] / FPS
total = t
print(f'total {total:.2f} s')

# audio: the race track as the bed, the rev on the intro, stingers on the beats
na = len(shots)
args += ['-i', f'{MUSIC}/race1.mp3', '-i', f'{MUSIC}/rev.mp3', '-i', f'{MUSIC}/bust.mp3', '-i', f'{MUSIC}/win.mp3']
bust_at = starts['bust'] + 1.6 if 'bust' in starts else total + 60
win_at = starts['win'] + 0.4 if 'win' in starts else total + 60
fc += [
    f'[{na}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,volume=0.85,afade=t=in:st=0.6:d=1.2,afade=t=out:st={total - 2.2:.3f}:d=2.2[bed]',
    f'[{na + 1}:a]volume=0.9,adelay=0|0[rev]',
    f'[{na + 2}:a]volume=0.8,adelay={int(bust_at * 1000)}|{int(bust_at * 1000)}[bst]',
    f'[{na + 3}:a]volume=0.8,adelay={int(win_at * 1000)}|{int(win_at * 1000)}[wn]',
    f'[bed][rev][bst][wn]amix=inputs=4:duration=first:normalize=0,alimiter=limit=0.95[a]',
]
out = os.path.join(HERE, OUT)
args += ['-filter_complex', ';'.join(fc), '-map', f'[{prev}]', '-map', '[a]',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', f'{total:.3f}', out]
subprocess.run(args, check=True)
print('wrote', out, f'{os.path.getsize(out) / 1e6:.1f} MB')
