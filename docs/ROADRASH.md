# ROADRASH.md — the reference mechanics, and where RideRash diverges

Researched from the primary sources (Wikipedia's *Road Rash* (1991) article,
which cites the Genesis instruction manual page by page) rather than from
memory. This file exists because the user's complaint was correct and specific:
*"what's the goal of the NPCs? They just hover around the player, but that's not
how Road Rash logic works."* Building the pack from intuition produced a pack
that orbits.

---

## 1. The authoritative rules

### Race structure
- **14 opponents** ("finish in fourth place or higher among fourteen other
  racers"). Not five.
- Win a race → advance. **Five races per level, five levels** to finish the game.
- **4th or higher advances.** A podium is not required. (RideRash currently
  requires `pos <= 3` — stricter than the original.)

### Stamina is the combat resource, not HP
- Every racer has a **stamina** bar (player's bottom-left, nearest opponent's
  bottom-right — the manual shows *two* bars, so the game always told you how
  the fight was going).
- **Stamina depleted → you are EJECTED from the bike.** Being knocked off is the
  *loss* condition of a fight, not a separate HP mechanic.
- The player has a separate **bike damage meter** (between the two stamina
  bars). It drops on crashes. **Fully depleted → the race ends for you** and a
  repair bill is deducted. This is distinct from stamina.

### Combat inputs (directional, not one button)
- **Default attack = punch at the nearest opponent.**
- **Hold a direction while attacking = backhand or kick.**
- So the *same* button gives three attacks depending on stick direction. This is
  a mechanic RideRash does not have at all: we bind J/K/L to three attacks.

### Weapons
- **Some opponents wield clubs.**
- **You take the club by attacking the opponent *as they are holding it out to
  strike*.** That timing window is the entire weapon system — it is a parry/steal,
  not a pickup you drive over.

### Cops
- Motor officers (motorcycle police) **appear sporadically** on tracks.
- **They only end your race if they apprehend you *following a crash*.** So the
  cop threat is specific: crash while a cop is near → fined and out. Not a
  general pursuit.

### Dismount behaviour
- After a crash the racer **automatically runs back toward the bike**.
- **The player can steer** to avoid incoming traffic while running back.
- **Holding the brake makes the racer STAND STILL** — a deliberate escape hatch.
- Opponents are likewise ejected when *their* stamina is depleted.

### Rival identity
- Rivals were given **individual names and characters**, and **deliver banter
  between races**. This was added explicitly "to increase the player's sense of
  immersion", i.e. it is a designed feature, not flavour.

### Design rules from the developers
- **"No projectiles"** — an explicit rule, because projectiles broke
  frame-rate-independent simulation. Combat is melee only, forever.
- Combat was inspired by real Grand Prix riders shoving and kicking mid-race.
  The *whole game* is that idea.

---

## 2. Where RideRash diverges

| mechanic | Road Rash | RideRash now | verdict |
|---|---|---|---|
| field size | 14 opponents | 5 (`RIVAL_COUNT`) | **divergent** |
| advance rule | 4th or better | 3rd or better (`pos <= 3`) | **stricter than original** |
| stamina | the combat resource; depletion ejects you | exists, but HP is what knocks you down | **divergent** |
| attacks | 3 attacks from ONE button + direction | 3 buttons, no direction | **divergent** |
| weapons | steal a club by attacking mid-swing | `hasWeapon` flag, no steal window | **missing** |
| cops | sporadic, arrest you if you crash nearby | not implemented | **missing** |
| dismount | auto-run to bike, steerable, brake = stand still | state machine, homing assist | close; brake-to-stand missing |
| rival banter | between races | missing | **missing** |
| no projectiles | explicit rule | honoured (melee only) | **compliant** |

---

## 3. What the pack AI should actually be doing

The user's diagnosis — *"they just hover around the player"* — is right, and the
research explains why. In Road Rash the opponents are **racers first**: they have
a place to defend, a pack to sit in, and a *reason* to attack (to take a
position, or to stop you taking theirs). Contact is a consequence of racing
close, not a behaviour in itself.

The rules that follow from the source material:

1. **Rivals race for POSITION.** Their primary objective is the finish line and
   their place in it. `RACE` should be the default state by a wide margin, and
   a rival should only leave it with a reason.
2. **They attack to gain or hold a PLACE.** The trigger is a rival being *near
   enough to fight over a position* — not merely being near. Attacking someone
   two places back is pointless; attacking the rider directly ahead is the whole
   game.
3. **They defend a line.** A rider who is ahead will block; one who is behind
   will look for a way past. That asymmetry is what makes the pack read as
   racing rather than as a swarm.
4. **They tire.** Stamina gates attacking, exactly as it does for the player.
5. **They get ejected.** Depleted stamina ejects a rival, and the player should
   see that happen — it is the visible payoff of winning a fight.
6. **They have names and they talk.** Between races, at minimum.

---

## 4. Ordered fix list

1. **Positional intent in the NPC** — replace "nearest rider" target selection
   with "the rider I am fighting for a place with". Highest value: it is the
   root of "they hover".
2. **Rivals race more, fight less** — `RACE` should dominate; attack only when
   contesting a position.
3. **Field size → 14** (or as close as the draw budget allows; check
   `draws: 900`).
4. **Advance rule → 4th** to match the original.
5. **Stamina ejection for rivals** — visible payoff.
6. **Brake-to-stand-still while on foot.**
7. **Cops** — sporadic, and specifically they punish *crashing in front of them*.
8. **Rival banter between races.**
9. **Weapon steal window** (attacking a rival mid-swing).
10. **Directional attacks** (one button + direction) — a large input change;
    consider carefully, since J/K/L is arguably clearer for a keyboard game.

Items 1-2 are the user's actual complaint and are done first.