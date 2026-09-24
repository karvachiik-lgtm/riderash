// RideRash — tuning constants. Metres, seconds, radians.

export const CFG = {
  // --- world ---
  // ROAD WIDTH IS SIZED TO THE FIELD, not to a lane count.
  //
  // At 7.5 m the whole carriageway was 2.08 bike-widths across (WHEELBASE 1.40),
  // and the usable racing room was less again once the rails are excluded, so a
  // 15-rider field had nowhere to be three-abreast: the pack compressed into one
  // line, every pass was a head-on shove, and the commit-window attack had no
  // lateral space to develop in (the attacker could never get ALONGSIDE). The
  // road was the binding constraint on the combat, so it is now 11.0 m.
  //
  // 11.0 m is ~3.05 bike-widths each side of the centreline, which is the room a
  // Road Rash start line actually needs: two riders attacking abreast, a third
  // line inside them, and still a lane of tarmac between the outermost fighter
  // and the rail. It is also ~3 lanes at LANE 3.6, so the lane markings below
  // still divide it without a remainder that reads as a wide hard shoulder.
  ROAD_W: 11.0,           // full carriageway width
  LANE: 3.6,
  KERB_H: 0.15,
  KERB_W: 0.8,
  VERGE_W: 9.0,           // grass/scrub either side before the wall of props
  GUARD_H: 0.75,
  TRACK_LEN: 5200,        // metres of road built once, ridden twice (out and back)
  SEG: 8,                 // length of one road segment in metres
  // 7200 m of physical road was built for maps that are 5000-5300 m long, so
  // ~1900 m of scenery -- trees, hoardings, bollards, buildings -- was placed
  // past the finish line and drawn every frame the player looked down the road.
  // Sized to the longest map (CANYON, 5300 m) plus a margin for the camera's
  // look-ahead, which is where the draw budget was going.
  // A FLOOR, NOT THE LENGTH: main.js raises this at load to the longest race in
  // the career schedule (SERIES x lenMul) + ROAD_PAST_FINISH. The maps outgrew a
  // hand-set 5600 m and the road ended before most finish lines.
  ROAD_SEGS: 700,
  ROAD_PAST_FINISH: 500,  // m of road beyond the longest finish, for the look-ahead

  // --- bike physics ---
  // TOP SPEED IS THE MEASURED TERMINAL SPEED, not a wish.
  //
  // This said 61 (~136 mph) and `physics.step()` independently said 61 as a
  // literal, while the actual engine/drag balance converged at **53.9 m/s** —
  // and because `revFrac` is `speed / topSpeed`, the engine curve was being
  // evaluated against a speed the bike could never reach, so the last 12% of
  // the rev band was dead.
  //
  // Worse, MAX_SPEED is a DENOMINATOR: the HUD bar, the speed FX and the engine
  // audio all read `speed / CFG.MAX_SPEED`. With the value at 61 those effects
  // peaked at 0.88 and never reached full, so the bike was silently quieter and
  // less dramatic at top speed than designed.
  //
  // Solved properly as a fixed point — `revFrac` depends on topSpeed and
  // topSpeed is the terminal of the curve it produces — the consistent value is
  // 48.16 m/s (~108 mph). That is also a plausible 1980s-90s sport bike, and it
  // makes the number mean one thing everywhere.
  MAX_SPEED: 48.16,       // m/s ~ 108 mph — the actual terminal of the engine/drag balance
  ACCEL: 13.5,
  BRAKE: 26,
  ENGINE_BRAKE: 3.2,
  DRAG: 0.00035,          // quadratic, so top speed self-limits
  ROLL: 8.0,
  STEER_RATE: 2.05,       // rad/s of yaw authority at low speed
  STEER_RATE_FAST: 0.62,  // less authority at speed, as on a real bike
  LEAN_MAX: 0.62,         // radians of visual lean
  GRIP: 9.5,              // lateral recovery
  WHEELBASE: 1.40,
  WHEEL_R: 0.31,

  // --- combat ---
  // ARCS COVER THE FLANK, NOT JUST THE NOSE, and this is the fix for "the player
  // can never land a hit". The design of this game is the ROADSIDE BRAWL: you
  // pull ALONGSIDE a rival and swing. The AI already works that way -- it
  // commits from `ALONGSIDE_LAT 3.2 m` of lateral offset, which is roughly 90
  // degrees off the nose -- but the punch arc was +/- 0.95 rad (54 deg) of
  // FORWARD, so a rider beside you was outside it by construction.
  //
  // MEASURED in the live page (harness/_combatdiag.mjs), instrumenting a real
  // alongside pass: closest approach 1.58 m, attack active, target at 73-131
  // degrees off the nose, and the arc test rejected EVERY one. The gate's
  // zero-hits was not flaky AI, it was an arc that could not see the only place
  // the fight actually happens.
  //
  // Road Rash itself is blunt about this: you punch whoever is beside you. The
  // arcs below reach a little past the perpendicular so an alongside pass
  // connects, while the CHAIN stays widest because it is a swung weapon.
  PUNCH_RANGE: 2.9,
  PUNCH_ARC: 1.85,        // rad either side of forward (~106 deg, reaches the flank)
  PUNCH_DMG: 9,
  PUNCH_CD: 0.42,
  PUNCH_WIND: 0.09,       // wind-up before the hit lands
  KICK_RANGE: 3.3,
  KICK_ARC: 1.70,         // rad (~97 deg)
  KICK_DMG: 13,
  KICK_CD: 0.72,
  KICK_WIND: 0.15,
  CHAIN_RANGE: 4.6,
  CHAIN_ARC: 2.30,        // rad (~132 deg, a swung weapon sweeps behind the hip)
  CHAIN_DMG: 22,
  CHAIN_CD: 1.35,
  CHAIN_WIND: 0.22,
  CHAIN_HOLD: 0.5,
  STAMINA_MAX: 100,
  // GRAPPLE: reach across, grab the rider alongside, drag him onto your line,
  // then THROW him off it. A hold, not a blow -- the two bikes are tied together
  // for GRAPPLE_HOLD seconds while the victim bleeds and struggles.
  GRAPPLE_RANGE: 2.5,
  GRAPPLE_ARC: 1.95,
  GRAPPLE_DMG: 4,         // on the grab itself
  GRAPPLE_THROW_DMG: 16,  // on the throw
  GRAPPLE_DPS: 7,         // while held
  GRAPPLE_CD: 3.0,
  GRAPPLE_WIND: 0.16,
  GRAPPLE_HOLD: 1.25,     // s the hold lasts before the automatic throw
  GRAPPLE_GAP: 1.05,      // m of lateral gap the hold pulls the two bikes to (bars + knees)
  GRAPPLE_BREAK: 0.2,     // break meter per struggle press (1.0 breaks free)
  STAMINA_COST: { punch: 5, kick: 9, chain: 17, grapple: 14 },
  STAMINA_REGEN: 13.5,
  STAMINA_REGEN_SPEED: 0.045, // extra regen per m/s, so speed feeds stamina
  COMBO_WINDOW: 2.4,
  COMBO_MULT: 0.28,       // each combo step adds this much damage
  CHAIN_DISARM: 0.35,     // chance a chain hit knocks the weapon out of a hand

  // --- rider health and crashes ---
  HP_MAX: 100,
  HP_REGEN: 0.55,
  COUNTDOWN: 3.2,             // s of grid hold before the flag drops
  CRASH_SPEED_LOSS: 0.72,
  TRAFFIC_COLLISION: true,    // set false to isolate traffic hits when debugging
  CAR_HIT_DMG: 26,            // hitting traffic: an oncoming car takes a quarter of your health
  // TRAFFIC HIT BOX, in metres. The car body mesh is BoxGeometry(1.82, 0.72, 4.3)
  // -> half 0.91 wide x 2.15 long. These were 1.35 / 2.9, i.e. a box about
  // 1.5x the car's width, so a rider could pass visibly THROUGH a car's corner
  // and register nothing while hits that landed felt like they came from
  // nowhere -- the reason "the cars have no collision" is a reasonable thing to
  // believe while watching the screen. Traffic collision itself was always
  // working (PLAYTEST.md, three live tests).
  //
  // Now 1.15 / 2.60: still deliberately forgiving at the corners (arcade, and
  // a rider is 0.4 m of bike plus elbows), but no longer wider than the car by
  // half. Raising these makes the game EASIER; lowering them near the rail is
  // what produced the 229-frame pinning in HANDOFF 5.5, so re-run _nondet after
  // touching them and confirm pinnedFrames stays 0.
  TRAFFIC_HIT_HALF_W: 1.15,
  TRAFFIC_HIT_HALF_L: 2.60,
  // TRAFFIC DENSITY. Cars are laid down every TRAFFIC_GAP_MIN..(MIN+SPAN)
  // metres of road, so this pair sets how far apart they are -- bigger gap =
  // fewer cars. It was 180 + r()*320, i.e. one car every 180-500 m over a
  // 5600 m road, which built **17 cars**; measured, that is dense enough that
  // the road reads as an obstacle course rather than a road with traffic on it,
  // and with races now ~3100 m (PLAYTEST OPEN-2) the rider meets them far more
  // often per race than when the tracks were 5000 m.
  //
  // Now one every 380-1000 m: roughly 9-11 cars over the built length, so
  // threading one is a decision rather than a constant. Raise the span to thin
  // further; do not go below ~260 or the pack and the traffic fight for the
  // same tarmac at the start line.
  TRAFFIC_GAP_MIN: 380,
  TRAFFIC_GAP_SPAN: 620,
  TRAFFIC_SWERVE_RATE: 0.02,   // per s, per eligible car ahead: chance it drifts over the centre line
  TRAFFIC_FLEET_LEN: 5600, // m of road the fleet is laid over (see buildTraffic)

  // --- bike-to-bike contact -------------------------------------------------
  // Contact is scored in the road frame as a CLOSING SPEED along the contact
  // normal (see BikePhys.contact). These thresholds decide what a given closing
  // speed MEANS, and they were hardcoded in main.js's contact pass.
  //
  // Re-tuned after the pack learned to fight (PLAYTEST.md BUG-2). Once rival
  // attacks started landing, ordinary racing contact exceeded the old 13 m/s
  // wreck threshold often enough to decide races: measured a single contact
  // taking 20.5 m/s off the player and shoving them to lateral 3.75 (the rail).
  // `_nondet` player distance fell 113 m -> 96 m with one run in four ending
  // DOWN, which is the pack winning by collision rather than by racing.
  //
  //   CONTACT_NOISE   below this it is rubbing, not a hit: no spark, no sound.
  //   CONTACT_NOTIFY  a solid hit -- sparks, thud, camera shake, a place lost.
  //   CONTACT_WRECK   a genuine wreck. Raised 13 -> 19: rear-ending a rider at
  //                   speed should still put one of you down, but a scrape
  //                   alongside must not.
  CONTACT_NOISE: 2.0,
  CONTACT_NOTIFY: 9.0,
  CONTACT_WRECK: 19.0,
  WRECK_TIME: 2.3,        // seconds face-down before remount

  // --- the punishment meter ------------------------------------------------
  // Damage units a crash adds to the machine. The results-screen bill is this
  // total times a fraction of the event purse (career.REPAIR), so the same
  // number of crashes hurts equally at every tier. A wreck is the expensive
  // event; a car strike is a scrape. See career.js for the loss condition.
  CRASH_DAMAGE: 1.00,
  CAR_DAMAGE: 0.45,
  INVULN_AFTER: 1.6,

  // --- rivals ---
  // ROAD RASH HAD 14 OPPONENTS. This was 5 because every rival was drawn every
  // frame and the draw budget is 900 -- the field size and the draw cost were
  // the same number. Distance culling (CFG.RIVAL_CULL_FAR) decouples them: the
  // whole field is simulated, and only riders near the player are drawn. With
  // the pack strung out over the course, the visible count stays small, which is
  // exactly how the original played -- you contested 2-4 riders at a time.
  //
  // The size matters beyond flavour: "4th of 15" must read differently from
  // "4th of 7". Riders are cheap and CULLED; raise this only with a draw
  // measurement, never on the assumption.
  // FIVE RIVALS, ONE OF THEM YOU. The user cut this from 14 deliberately: a
  // field of fourteen read as a swarm of identically-seated dolls rather than a
  // pack of characters, and "4th of 15" was a number nobody could hold in their
  // head. Five is also the number the ORIGINAL played against -- you contested
  // two to four riders at a time and knew each one by name. The career ladder
  // still supplies the escalation; the pack size does not have to carry it.
  //
  // This is also 15 rigs down to 6 in the scene graph, which is the difference
  // between a measurable frame and one full of riders that are off-screen.
  RIVAL_COUNT: 5,
  RIVAL_ATTACK_RANGE: 3.4,
  RIVAL_AGGRO: 0.55,      // chance per second to commit to an attack when in range
  RIVAL_HP: 60,
  // The pack must NOT out-drag the player off the line. At a base of 44 m/s
  // against the player's 8 m/s start, all five rivals were 40+ m gone within two
  // seconds and the player spent the race alone, with nothing to punch and an
  // empty road ahead of the camera. Rivals now launch only slightly quicker than
  // the player and settle into a pace that keeps a pack.
  // THERE IS NO LONGER A PACK-KEEPING SPEED. Rivals have ABSOLUTE target paces
// set per level by `career.SERIES[].reference` (see NpcBrain.assignPace), so
// these two are only the fallback for a bare-constructed brain in a harness.
  RIVAL_REFERENCE_PACE: 46.1,
  RIVAL_LAUNCH: 9,        // their speed at the line, close to the player's 8
  RIVAL_SKILL_SPREAD: 0.32,

  // --- camera ---
  // Hero scale was fixed (bike fills the bottom third, camera 1.4 m from the
  // rider). But sitting that low and close put the rider's back across most of
  // the frame and hid the road, which reads as the camera looking at the back of
  // the rider rather than down the road ahead. The bar frames solve this by
  // sitting higher and further back than a "on the back" camera, with the hero
  // occupying the LOWER third and open road above it.
  // Hero framing was solved for a 30 m/s bike. At 50 m/s the ride height and
  // setback leave the near tarmac BELOW the bottom of the frame, so the road
  // reads as missing and the lane dashes appear to float over dirt. Past ~35 m/s
  // the camera must come DOWN and the look target must come DOWN with it, so the
  // road surface stays in the lower frame at top speed.
  // --- the player's riding rig ----------------------------------------------
  // WHERE THE RIDER SITS ON THE BIKE, in the player group's local frame.
  //
  // The group origin is the bike's contact patch on the road. The bike's own
  // geometry spans y 0..1.296 with the saddle toward the front, so the pelvis
  // rides a little above mid-height and only slightly back of centre.
  //
  // These three numbers used to be the literal (0, 0.62, -0.22) written out in
  // FIVE places across player.js, and every one of them had to agree. They are
  // one exported constant now because the seat is a single fact about the rig.
  //
  // The old values were tuned while `bakeStatic` was silently displacing the
  // bike half a metre sideways (see assetlib.bakeStatic), so they were
  // compensating for a bug that no longer exists.
  // MEASURED FROM THE BIKE, NOT GUESSED. These are the centre of the saddle
  // slab in assets/bike.js -- `BoxGeometry(0.29, 0.06, 0.44)` at
  // `(0, 0.845, -0.28)` -- plus half its thickness, so the rider's seat-contact
  // lands on the TOP of the saddle rather than its centre.
  //
  // They used to be (0, 0.78, -0.05): 6.8 cm too low and 23 cm too far FORWARD.
  // A side elevation of the showroom made it obvious -- the rider was perched on
  // the TANK with the whole tail of the machine empty behind him, which is
  // exactly what "the pose of the rider is wrong" looks like from outside. No
  // scalar test caught it: every number was self-consistent, and the only thing
  // wrong was where the numbers pointed.
  // SEAT_Z IS WHERE THE HIPS SIT, NOT THE SADDLE'S CENTRE. The saddle slab runs
  // from about z -0.50 to -0.06, and a rider sits at its FRONT edge, knees on
  // the tank -- not balanced on the middle. MEASURED, this matters: at the
  // slab's centre (-0.28) the shoulder lands 0.50 m behind the bike origin and
  // the grips are 0.98 m away, against an arm of 0.77 m. The bars were simply
  // out of reach, which is why no set of joint angles could ever look right.
  //
  // IT IS THE SOCKET'S Z, AND THE SOCKET'S ORIGIN IS NOT THE PELVIS. The rider
  // is normalised to its own bounding box, so its origin is the centre of the
  // FEET, and the pelvis joint sits BEHIND that origin -- 0.34 m behind it in the
  // racing crouch. Placing the socket at the saddle slab therefore puts the
  // PELVIS 0.34 m behind the slab, which is the "sitting on the tail" pose.
  // MEASURED (harness/_seatzsolve.mjs): with the socket at -0.20 the pelvis lands
  // at -0.622 and needs +0.342 to reach the slab at -0.28. So the socket z is the
  // slab position PLUS that offset, and the number below is the solved one.
  SEAT_X: 0,
  SEAT_Y: 0.875,
  SEAT_Z: 0.056,
  // How far the rider drops and slides back under heavy braking / wheelie, as a
  // fraction of the seat offset. Read by the riding pose.
  SEAT_BRAKE_DROP: 0.40,
  SEAT_BRAKE_BACK: 0.55,

  CAM_BACK: 4.30,       // with lag compensation this IS the real separation
  CAM_UP: 1.95,
  CAM_UP_FAST: 1.45,      // drops as speed rises: keeps tarmac in frame
  CAM_LOOK: 8.0,
  CAM_LOOK_DROP: 0.60,    // how far the look point falls, in metres, at top speed
  // The look target must stay well ahead at ALL speeds. Tying it to speedFrac
  // meant at a standstill the camera aimed 5.6 m ahead, which at 1.86 m of eye
  // height is almost straight down at the rider.
  CAM_LOOK_MIN: 0.70,
  CAM_FOV: 66,
  CAM_FOV_FAST: 80,
  CAM_LAG: 0.035,       // smooths bumps; no longer sets the framing
  CAM_SHIFT: 0.42,
  CAM_SHAKE_HIT: 0.5,
  CAM_SHAKE_HIT_TAKEN: 0.85,

  // --- look ---
  // Fog is tuned to the new backdrop: the far ridges sit at 400-1400 m and must
  // fade INTO the sky rather than stop against it. Measured against our own
  // distances, not carried out of someone else's build.
  // Fog was tuned for a dim procedural gradient sky. Against a BRIGHT
// photographic panorama the same density washed the entire midground to flat
// haze and flattened the frame's saturation with it — the verge, the road and
// the distance all converged on one tan. Halved, and pulled further out, so the
// near field keeps its colour and the far ridges still dissolve.
  FOG_NEAR: 120,
  FOG_FAR: 1900,
  FOG_DENSITY: 0.00034,
  SUN_ELEV: 0.105,        // low and raking, so the road catches a long specular smear
  SUN_AZIM: 2.35,

  // --- rival distance culling ----------------------------------------------
  // The field is a SIMULATION number; this is the VISIBILITY number that keeps
  // the draw budget flat as the field grows. A rider inside `CULL_FAR` draws; a
  // drawn rider only stops drawing past `CULL_NEAR`. The band between them is
  // hysteresis so a rider at the boundary cannot strobe.
  //
  // 900 m was chosen against the race and is fine for the RACING argument: at
  // ~53 m/s it is ~17 s of track, past the point where a rival silhouette is
  // legible. It is NOT fine for the DRAW BUDGET, which is a separate constraint
  // that this number originally ignored. The gate measures the true peak over a
  // sampling window -- not a single frame -- and with the pack clustered, all
  // five rivals inside 900 m are unculled at once: 5 x ~136 draws = ~680, which
  // takes the peak to ~935 against a 900 tripwire. A 2 m rider is sub-pixel long
  // before 400 m, so 900 m was paying for hundreds of draws of nothing.
  //
  // 520 m keeps the racing argument intact (still ~10 s of track at race speed,
  // far past legibility) and takes the worst-case pack cost below the tripwire.
  // The peak is what the budget is for, and the peak is set by this number.
  RIVAL_CULL_FAR: 520,
  RIVAL_CULL_NEAR: 600,

  // SIMULATION LOD. A rival beyond LOD_FAR stops running the behaviour machine
  // and holds its assigned pace on the cheap path; inside LOD_NEAR it thinks
  // again. This is what makes a fourteen-rider field affordable AND keeps the
  // strung-out feel: the field spreads over miles, but you only ever pay for the
  // few riders near you. Hysteresis, for the same reason as the cull band: a
  // rider at the boundary must not toggle its state machine every frame.
  //
  // Set well inside the visual cull so a rider is always THINKING before it is
  // ever DRAWN -- you must never see a rider that is not really racing.
  RIVAL_LOD_FAR: 420,
  RIVAL_LOD_NEAR: 360,

  // --- scoring ---
  PTS_PER_METER: 0.02,
  PTS_PER_HIT: 12,
  PTS_PER_KNOCKDOWN: 180,
  PTS_POSITION_BONUS: 220,
};

export const MATERIAL_NAMES = ['plaster','stone','timber','tile','metal','fabric','foliage','ground'];

// The locked palette. Nothing in the game invents a colour off this list.
// Re-solved after measuring the rendered frame: high-saturation pixels were
// 0.4% of frame against the bar's 19%, because the surfaces were desaturated
// AND the sky was pushing everything grey. These are the same hues, pushed
// until they read. The hero bike stays the most saturated thing in frame.
export const PAL = {
  asphalt:      0x2b2b2f,
  asphaltWorn:  0x3a3a3e,
  saddle:       0x1b1b1e,
  frameSteel:   0x9ba3ab,
  framePainted: 0xe04a22,   // the hero: saturated, the brightest chroma in frame
  rivalA:       0x1f8fbf,   // teal, pushed
  rivalB:       0xe8a81a,   // mustard, pushed
  rivalC:       0x9a3fd4,   // plum, pushed
  rivalD:       0xd43b3b,   // red, pushed
  rivalE:       0x3fbf6a,   // green, pushed
  skin:         0xa87a5a,
  denim:        0x3b5a8a,
  leather:      0x2a2624,
  helmet:       0xe8e2d4,
  kerb:         0x8a857a,
  foliage:      0x6a7238,   // dry, golden-olive: the bar's verge is gold in sun
  hazard:       0xe8701a,
  glyph:        0xd0cbbb,
  sky:          0x9db4c8,
};

export const RIVAL_COLORS = [PAL.rivalA, PAL.rivalB, PAL.rivalC, PAL.rivalD, PAL.rivalE];
export const RIVAL_NAMES = ['HALVERSON','BREGA','K. NAKAMURA','VOSS','DELANEY'];