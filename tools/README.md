# tools/

## fuzz.mjs — the fuzz / regression harness

Plays the real game headlessly and checks it does not break: random riding and
fighting, pauses, mid-race restarts, instant replays, cops, crashes, and every
exit from the results screen, with invariants checked every step (no page
errors, finite physics, consistent grabs, nobody stuck, every race ends and
its replay opens). Targeted checks for fixed bugs run first.

```sh
cd tools
npm install                              # playwright-core + three (served locally, works offline)
npx playwright-core install chromium     # once; or set CHROME_PATH to an existing Chrome
node fuzz.mjs                            # 4 races from career race 0
node fuzz.mjs --races 5 --start 20       # late career: longer courses, harsher cops
node fuzz.mjs --seed 7 --no-checks       # a different random run, fuzz only
```

It serves the repo itself (no other server needed). Exit code 0 = all held,
1 = something failed (each failure is printed) — usable before a push.
