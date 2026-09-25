// RideRash — TIPS on the title screen: one line at the bottom, rotating.
//
// Everything a new rider has to discover the hard way (nitro is earned, cops
// arrest a DOWNED rider, ghat drops are fatal) and every trick a good one uses,
// one at a time so it is read rather than skimmed. Tap or arrow to step
// through; it pauses while the pointer is on it.
const TIPS = [
  'Nitro is <b>earned</b>: take down a cop for a full charge. Tap <kbd>Space</kbd> on a straight, never into a bend.',
  'Sit in a rider’s <b>slipstream</b> for a couple of seconds, then pull out: the tow slingshots you past and pays nitro.',
  'Hear a siren? <b>Stay on the bike.</b> A cop only arrests a rider who is down: wreck near him and you’re BUSTED.',
  'Wreck a cop and he\u2019s out of the chase: that\u2019s the boldest nitro on the road.',
  'Each rival has a <b>character</b>. Thugs come over to fight, blockers sit on your line, clean racers just race. Learn who’s who.',
  'When the island says a rival is <b>coming for you</b>, move first: brake so he overshoots, or swing as he pulls alongside.',
  'Hit a rider and he remembers. A grudge rider will hunt you for the rest of the race.',
  '<kbd>G</kbd> grabs a rider alongside. Press it again to throw him into traffic or off the road.',
  'The <b>chain</b> reaches further than a kick. Knock a rider off while he’s holding one and it’s yours.',
  'Thread oncoming traffic for near-miss nitro, but a car head-on ends your run.',
  'On the ghat, the drop <b>switches sides</b>. Watch the chevrons: they sit on the side you fall.',
  'Broken lanes narrow the road to one line. Get there first, or wait behind.',
  'In a tunnel, your eyes need a moment. Hold a line going in and coming out.',
  '<kbd>Shift</kbd> tucks for top speed but you can’t fight tucked. Sit up when a rival closes.',
  '<kbd>E</kbd> dodges a swing. Timed right, the attacker whiffs and wobbles and he’s open.',
  'A clean line through a run of bends pays nitro. So does every overtake.',
  'Oil and gravel cut your grip. Straighten up across them, don’t steer.',
  'Finish top four to go through. Prize money buys faster bikes, and crash damage costs you. Go broke and your career is over.',
];

export function initTips(el) {
  if (!el) return;
  let i = Math.floor(Math.random() * TIPS.length), timer = 0, hold = false;
  el.innerHTML = '<span class="tip-k">TIP</span><span class="tip-t" aria-live="polite"></span><span class="tip-n"><button type="button" class="tip-b" data-d="-1" aria-label="Previous tip">‹</button><button type="button" class="tip-b" data-d="1" aria-label="Next tip">›</button></span>';
  const t = el.querySelector('.tip-t');
  const show = (d) => {
    i = (i + d + TIPS.length) % TIPS.length;
    t.classList.remove('in'); void t.offsetWidth;
    t.innerHTML = '<span>' + TIPS[i] + '</span>'; t.classList.add('in');
  };
  const arm = () => { clearInterval(timer); timer = setInterval(() => { if (!hold && el.offsetParent) show(1); }, 7000); };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.tip-b');
    show(b ? +b.dataset.d : 1); arm();
  });
  el.addEventListener('pointerenter', () => { hold = true; });
  el.addEventListener('pointerleave', () => { hold = false; });
  show(0); arm();
}
