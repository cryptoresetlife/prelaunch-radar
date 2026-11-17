# prelaunch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cryptoresetlife/prelaunch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cryptoresetlife/prelaunch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads one sealed DefiLlama snapshot, finds the protocols that record no token and
are not a wrapped, staked or bridged product of one that trades, ranks them by the value a launch would
imply, and writes a static dashboard with a detail view and a farm plan for each.

## How the value is derived

Everything comes from the snapshot's own ten fields. No protocol is named in the code.

1. **Split the universe** (`splitUniverse`): a token on record means *trading*; a token-less wrapped, staked,
   bridged or exchange product is *set aside*; the rest are the candidates.
2. **Fit the size curve** (`tokenFamilies`, `fitOn`): `log10(mcap) = a + b * log10(TVL)` by Theil-Sen, one
   point per traded ticker.
3. **Test it blind** (`backtest`, `compareModels`): leave-one-out and walk-forward, against one flat multiple
   of TVL and against the curve with category offsets, which are used only if they do not lose both tests.
   `rankRanges` refits 200 bootstrap samples to show how firm each rank is.
4. **Score each candidate** (`scoreProtocol`): the curve at its TVL, times small tilts for seven-day growth,
   no-token tenure and chain breadth, and a haircut when a traded relative is likely. The band is the middle
   half of the blind misses.
5. **Plan the farm** (`farmPlan`): dated steps with a cost and a time each, a whole cost, the modelled drop
   for the suggested capital, the break-even launch value, and a verdict: Farm, Marginal or Skip.

`dashboard/model.js` is the single copy of that model. `main.ts` runs it to write `board.json`; the page
runs it again in the browser on `snapshot-data.js` and shows whether the two agree.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
tools/shoot.sh out   # re-renders screenshots/ with headless Chrome
```

Node 22.18 or later, standard library only. Open `out/dashboard/index.html` from disk: no network is used.

Implied value is a model's estimate, not a price and not advice.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
