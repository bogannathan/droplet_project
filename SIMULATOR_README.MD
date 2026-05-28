# Traffic Intersection Simulator

A single-page React + TypeScript app that simulates a four-way signalized
intersection. The simulator models traffic-light phases, per-lane signals,
pedestrian crossings, car queueing, and turn conflict checks against
real-world traffic-engineering rules.

## Running

```bash
npm install
npm run dev   # http://localhost:5173/
npm run build
```

## High-level architecture

```
src/
├── sim.ts     # All simulation logic: types, reducer, FSM, geometry, signals
├── App.tsx    # React UI, SVG rendering, controls, dispatches tick actions
└── App.css    # Styling
```

The app is driven by a single `useReducer(reducer, INITIAL_STATE)` in
[src/App.tsx](src/App.tsx#L30). A `setInterval` fires every
`TIMINGS.tickMs` (100 ms) and dispatches `{ type: 'tick', deltaMs }`. Every
piece of simulation state lives in `SimState` in
[src/sim.ts](src/sim.ts#L82); the React tree is a pure projection of that
state.

### Tick pipeline

Each tick, [`tick()`](src/sim.ts#L155) runs in this order:

1. `now += deltaMs * state.speed` — advance the simulated clock (scaled by
   the speed slider).
2. `updateWalks` — activate any requested pedestrian walks whose required
   phase/axis condition is met; expire walks that have run their `walkMs`.
3. `getTrafficSummary` — snapshot per-axis and per-lane car counts.
4. `maybeAdvancePhase` — run the signal FSM up to 6 times in a row so a
   phase that should immediately yield (e.g. no demand) collapses in one
   tick.
5. `advanceCars` — move every car forward, clamped by signals, leader
   spacing, and turn-gap checks.
6. `spawnCars` — emit new cars from any lane whose `nextSpawnAt` deadline
   has passed.

## State model

`SimState` ([src/sim.ts](src/sim.ts#L82)):

| Field | Meaning |
|---|---|
| `now` | Simulated milliseconds since start (scales with `speed`). |
| `phase` | Current signal phase (FSM state, see below). |
| `activeAxis` | `'NS'` or `'EW'` — which axis currently owns the green. |
| `priorityAxis` | The arterial axis (hardcoded `'NS'`); gets longer green and 40% more spawns. |
| `phaseStartedAt` | `now` when the current `phase` began; used for elapsed-time checks. |
| `paused` | Pauses the entire tick. |
| `speed` | Time multiplier for `now` and car motion. |
| `busyness` | Spawn-rate multiplier (slider, clamped to `[0.2, 3]`). |
| `cars` | All in-flight cars. |
| `walks` | Per-crossing pedestrian walk state (`NS`, `EW`). |
| `nextSpawnAt` | Per-lane deadline (in `now`-ms) at which the next spawn should occur. |
| `nextId` | Monotonic id allocator for cars. |

## Signal phase FSM

The intersection cycles through six phases per active-axis turn,
implemented in [`tickPhase()`](src/sim.ts#L320):

```
straightGreen  →  straightYellow  →  allRedToLeft  →
leftGreen      →  leftYellow      →  allRedToSwap  →
(flip activeAxis) → straightGreen ...
```

Durations come from `TIMINGS` ([src/sim.ts](src/sim.ts#L1)):

| Constant | ms | Use |
|---|---|---|
| `straightMinMs` | 20 000 | Minimum green for the active axis's straight phase. |
| `leftMinMs` | 10 000 | Length of the protected left arrow. |
| `yellowMs` | 3 000 | Each yellow clearance. |
| `allRedMs` | 1 000 | All-red gap between conflicting phases. |
| `walkMs` | 10 000 | Pedestrian walk duration once activated. |

### Priority-axis behavior

The `priorityAxis` ("arterial") and the other axis ("cross street") have
asymmetric yielding rules in `straightGreen`:

- **Priority axis active:** holds indefinitely if the cross street is
  empty. If both axes have demand, holds for `straightMinMs + 5 s` (25 s)
  before yielding.
- **Non-priority axis active:** yields immediately at `straightMinMs`
  (20 s) if the other axis has demand or its own demand has cleared.

This models how a real arterial keeps a long green and only breaks for
verified cross-street demand.

### Walk handling

Clicking "Request walk" on a crossing sets `walks[crossing].requested`.
[`updateWalks`](src/sim.ts#L506) activates the walk only when the
**perpendicular** axis is currently in `straightGreen`. While active:

- Straight-through traffic on the active axis keeps moving.
- Turning movements (left, right) on the active axis are blocked because
  they cross the active crosswalk.
- The active axis cannot yield to yellow until the walk expires.

## Per-lane signals (`getLaneSignal`)

Each approach has three logical signal heads: **left**, **straight**,
**right**. [`getLaneSignal`](src/sim.ts#L255) returns the trio based on
phase, axis, and walk state.

Key non-obvious rules:

- **Permissive left during `straightGreen`:** left head shows
  `flashingOrange`. A driver may turn left only if
  [`hasSafeLeftGap`](src/sim.ts#L661) confirms no oncoming straight car
  will reach the conflict point before the turner clears it.
- **Perpendicular right release during `leftGreen`:** when the active axis
  has its protected left arrow, the *perpendicular* axis's right turn
  shows green. Those right turners merge into the same exit lane the left
  turners are entering — no conflict — so it's safe and improves
  throughput.
- **Yellow sync:** during `leftYellow`, that perpendicular right also goes
  yellow, so it clears the intersection on the same cadence.
- **Walk overrides:** any time the conflicting walk is active or requested,
  turning movements (left and right) on the active axis hold red even
  though the straight head stays green.

## Car lifecycle

### Spawning ([`spawnCars`](src/sim.ts#L456))

Each `(approach, lane)` key has an independent `nextSpawnAt` deadline.
When `now` reaches it:

1. Skip the spawn if any car in that lane is still within the first 60
   units of its path (avoids pile-up at the source).
2. Build a new `Car` with a precomputed `path`, `stopDistance`,
   `pathLength`, and lane-specific cruise `speed`.
3. Schedule the next spawn:
   ```ts
   const axisMultiplier = approachAxis === state.priorityAxis ? 1.4 : 1
   const intervalScale  = 1 / Math.max(0.05, state.busyness * axisMultiplier)
   nextSpawnAt[key] = now + randomBetween(min * intervalScale, max * intervalScale)
   ```
   - Higher `busyness` → shorter intervals → more cars.
   - Priority-axis lanes get 1.4× the effective busyness (a real arterial
     carries more cars than its cross street).

Per-lane base intervals come from `laneSpawnProfiles`: lefts and rights
are rarer, straights are frequent.

### Path geometry ([`buildCarPath`](src/sim.ts#L772))

Each car follows a polyline:

- **Straight:** `start → stop → exit`.
- **Right:** `start → stop → cornerPivot → exit` (single 90° pivot).
- **Left:** `start → stop → p1 → p2 → exit` where the `p1→p2` segment is a
  diagonal `LEFT_TURN_CHAMFER` (48 units) cut across the intersection — a
  smooth bevel instead of a square turn.

`progress` is the distance along this polyline. `stopDistance` is the
distance from the start to the stop-line vertex. Cars are clamped to
`progress ≤ stopDistance` when their signal says red.

### Movement ([`advanceCars`](src/sim.ts#L391))

For each lane's queue (sorted by `progress` descending):

```
desired  = car.progress + car.speed * dt * state.speed
phaseCap = canPass ? ∞ : car.stopDistance
leaderCap = leader.progress - minFollowGap
nextProg = clamp(desired, current, min(phaseCap, leaderCap))
```

`canPass` is decided by [`decideCanPass`](src/sim.ts#L549):

- Committed: any car already past the stop line (`progress > stopDistance + 0.5`) always proceeds.
- On the wrong axis: only right-turners during `leftGreen`/`leftYellow` (and only when no walk).
- On the active axis:
  - `straightGreen`: straight → always; right → not while walk blocks; left → needs `hasSafeLeftGap`.
  - `straightYellow`: straight/right may proceed only if `canClearBeforeRed`; left holds.
  - `leftGreen`: only `intent === 'left'`.
  - `leftYellow`: only lefts that can `canClearBeforeRed`.
  - any `allRed*`: no one moves.

Cars are culled when `progress > pathLength + 8` (drove off-screen).

### Permissive-left gap math ([`hasSafeLeftGap`](src/sim.ts#L661))

The hand-derived geometric gap check, evaluated for **every** opposing
straight car (not just the leader, so followers can't blindside a turner):

1. Compute the opposing car's distance from its own stop line to its
   conflict point with the turner's exit:
   `opposingDistanceToConflict = (other.stopDistance + 116) - other.progress`
   where `116 = STOP_LINE_OFFSET - LANE_OFFSET_FROM_MEDIAN`.
2. If that's `< -carLength`, the opposing car already cleared — ignore.
3. If it's `< carLength`, the opposing car is *in* the conflict box —
   block immediately.
4. Otherwise compute arrival time: `opposingDistanceToConflict / other.speed`.
5. Compute the turner's clearance time:
   - Path distance from turner's stop to opposing lane `L`:
     `152 + 32·L` (derived from `stop→p1`, the `√2·48` diagonal chamfer,
     and `p2 → lane center`).
   - Add one car length for "fully clear", divide by turner speed, add
     `LEFT_TURN_REACTION_SEC = 0.6` for driver reaction.
6. If any opposing car arrives before the turner clears, block the turn.

Only **straight** opposing cars are considered — opposing left turners are
also going somewhere else during a permissive phase, and opposing right
turners use their own dedicated path.

## UI / controls

[src/App.tsx](src/App.tsx) renders:

- **SVG intersection** with roads, lane markings, crosswalks, signal
  clusters per approach, cars (rotated by `carAngleAtProgress`), and
  pedestrians.
- **Phase banner / countdown** driven by `getPhaseLabel` and
  `getPhaseRemainingMs`.
- **Walk buttons** dispatch `{ type: 'walk', crossing }`.
- **Pause / reset** dispatch `togglePause` / `reset`.
- **Speed slider** dispatches `{ type: 'speed', speed }`.
- **Busyness slider** dispatches `{ type: 'busyness', busyness }`, clamped
  to `[BUSYNESS_MIN=0.2, BUSYNESS_MAX=3]`. Middle of the slider is the
  default (`1`).

## Tuning knobs

Most behavior is driven by exported constants in
[src/sim.ts](src/sim.ts#L1):

| Constant | Purpose |
|---|---|
| `TIMINGS` | All phase durations. |
| `VIEW` | Canvas size, intersection center/half, road band. |
| `LANE_ORDER` | `['left','straightA','straightB','right']` — left to right per direction. |
| `LANE_OFFSET_FROM_MEDIAN` / `laneSpacing` | Lane centerline geometry. |
| `STOP_LINE_OFFSET` | Distance from center to stop line (past crosswalk). |
| `LEFT_TURN_CHAMFER` | Diagonal cut length on a left turn. |
| `LEFT_TURN_REACTION_SEC` | Reaction-time padding in the permissive-left gap check. |
| `laneSpawnProfiles` | Per-lane min/max spawn interval (ms) and cruise speed. |
| `BUSYNESS_MIN` / `BUSYNESS_MAX` | Slider clamp. |

## Known quirks (not currently fixed)

- `getPhaseRemainingMs` returns `Infinity` on the non-priority axis after
  `straightMinMs` even though `tickPhase` will end it as soon as demand or
  emptiness conditions trigger. Display only — does not affect logic.
- `leftGreen` always runs the full `leftMinMs` even with zero left demand.
- `priorityAxis` is hardcoded to `'NS'`; there's no UI to toggle it or
  auto-elect based on observed flow.
