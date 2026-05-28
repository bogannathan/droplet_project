export const TIMINGS = {
  tickMs: 100,
  straightMinMs: 20_000,
  leftMinMs: 10_000,
  yellowMs: 3_000,
  allRedMs: 1_000,
  walkMs: 10_000,
} as const

export const ALL_RED_MS = TIMINGS.allRedMs
export const LEFT_MIN_MS = TIMINGS.leftMinMs
export const YELLOW_MS = TIMINGS.yellowMs

export const VIEW = {
  width: 1_200,
  height: 840,
  centerX: 600,
  centerY: 420,
  roadBand: 312,
  intersectionHalf: 92,
} as const

export const APPROACHES = ['N', 'S', 'E', 'W'] as const
export const AXES = ['NS', 'EW'] as const
export const LANE_ORDER = ['left', 'straightA', 'straightB', 'right'] as const

export const LANE_LABELS = {
  left: 'L',
  straightA: 'S1',
  straightB: 'S2',
  right: 'R',
} as const

export type Approach = (typeof APPROACHES)[number]
export type Axis = (typeof AXES)[number]
export type LaneKind = (typeof LANE_ORDER)[number]
export type Intent = 'left' | 'straight' | 'right'
export type Heading = 'N' | 'S' | 'E' | 'W'
export type RoadHand = 'right' | 'left'
export type Phase = 'straightGreen' | 'straightYellow' | 'allRedToLeft' | 'leftGreen' | 'leftYellow' | 'allRedToSwap'
export type SignalColor = 'red' | 'yellow' | 'green' | 'flashingOrange'
export type Crossing = 'NS' | 'EW'
export type LaneKey = `${Approach}-${LaneKind}`

// Side of the road drivers travel on. Switch to 'left' to flip every lane.
export const ROAD_HAND: RoadHand = 'right'

// Distance from the road's median to the centerline of the lane closest to the median.
export const LANE_OFFSET_FROM_MEDIAN = 16

// Distance from intersection center to the stop line (just outside the crosswalk).
// Crosswalks occupy intersectionHalf+10 .. intersectionHalf+28 from center; the stop
// line sits a car-half-length beyond the far edge so cars halt before the crosswalk.
export const STOP_LINE_OFFSET = 92 + 28 + 12

export interface Point {
  x: number
  y: number
}

export interface Car {
  id: number
  approach: Approach
  lane: LaneKind
  intent: Intent
  path: Point[]
  pathLength: number
  progress: number
  stopDistance: number
  speed: number
  length: number
  width: number
  color: string
}

export interface WalkState {
  requested: boolean
  active: boolean
  activeUntil: number | null
}

export interface SimState {
  now: number
  phase: Phase
  activeAxis: Axis
  phaseStartedAt: number
  priorityAxis: Axis
  paused: boolean
  speed: number
  busyness: number
  cars: Car[]
  walks: Record<Crossing, WalkState>
  nextSpawnAt: Record<LaneKey, number>
  nextId: number
}

export interface TrafficSummary {
  totalCars: number
  axisDemand: Record<Axis, number>
  leftDemand: Record<Axis, number>
  walksActive: number
  byLane: Partial<Record<LaneKey, number>>
}

export type AppAction =
  | { type: 'tick'; deltaMs: number }
  | { type: 'walk'; crossing: Crossing }
  | { type: 'togglePause' }
  | { type: 'speed'; speed: number }
  | { type: 'busyness'; busyness: number }
  | { type: 'reset' }

const LANE_COLORS: Record<Intent, string> = {
  left: '#f35d3f',
  straight: '#5fb1ff',
  right: '#b4c6d4',
}

const laneShape = {
  carLength: 18,
  carWidth: 10,
  turnInset: 30,
} as const

const laneSpacing = 32

const laneSpawnProfiles: Record<LaneKind, { minMs: number; maxMs: number; speed: number }> = {
  left: { minMs: 13_000, maxMs: 26_000, speed: 68 },
  straightA: { minMs: 6_000, maxMs: 14_000, speed: 88 },
  straightB: { minMs: 6_500, maxMs: 15_000, speed: 90 },
  right: { minMs: 10_500, maxMs: 22_500, speed: 96 },
}

export const INITIAL_STATE: SimState = createInitialState()

export function reducer(state: SimState, action: AppAction): SimState {
  switch (action.type) {
    case 'tick':
      return state.paused ? state : tick(state, action.deltaMs)
    case 'walk':
      return {
        ...state,
        walks: {
          ...state.walks,
          [action.crossing]: {
            ...state.walks[action.crossing],
            requested: true,
          },
        },
      }
    case 'togglePause':
      return { ...state, paused: !state.paused }
    case 'speed':
      return { ...state, speed: action.speed }
    case 'busyness':
      return { ...state, busyness: clampBusyness(action.busyness) }
    case 'reset':
      return createInitialState()
    default:
      return state
  }
}

export function tick(state: SimState, deltaMs: number): SimState {
  const now = state.now + deltaMs * state.speed
  const walkedState = updateWalks(state, now)
  const summaryBefore = getTrafficSummary(state.cars)
  const advancedPhase = maybeAdvancePhase({ ...state, now, walks: walkedState }, summaryBefore)
  const movedCars = advanceCars(advancedPhase, deltaMs)
  const spawned = spawnCars({ ...advancedPhase, cars: movedCars }, now)

  return {
    ...advancedPhase,
    now,
    cars: spawned.cars,
    nextSpawnAt: spawned.nextSpawnAt,
    nextId: spawned.nextId,
    walks: walkedState,
  }
}

export function getPhaseLabel(state: SimState) {
  const prefix = state.activeAxis
  switch (state.phase) {
    case 'straightGreen':
      return `${prefix} straight green`
    case 'straightYellow':
      return `${prefix} straight yellow`
    case 'allRedToLeft':
      return `${prefix} all-red`
    case 'leftGreen':
      return `${prefix} left green`
    case 'leftYellow':
      return `${prefix} left yellow`
    case 'allRedToSwap':
      return `${prefix} all-red`
  }
}

export function getPhaseRemainingMs(state: SimState) {
  const elapsed = state.now - state.phaseStartedAt
  switch (state.phase) {
    case 'straightGreen': {
      const walkDeadline = Math.max(
        ...(['NS', 'EW'] as Crossing[]).map((crossing) => {
          const requiredAxis = crossing === 'NS' ? 'EW' : 'NS'
          const walk = state.walks[crossing]
          if (state.activeAxis !== requiredAxis || !walk.active || walk.activeUntil === null) {
            return 0
          }
          return walk.activeUntil - state.now
        }),
      )
      if (elapsed < TIMINGS.straightMinMs) {
        return Math.max(0, Math.max(TIMINGS.straightMinMs - elapsed, walkDeadline))
      }

      return walkDeadline > 0 ? walkDeadline : Number.POSITIVE_INFINITY
    }
    case 'straightYellow':
      return Math.max(0, TIMINGS.yellowMs - elapsed)
    case 'allRedToLeft':
    case 'allRedToSwap':
      return Math.max(0, TIMINGS.allRedMs - elapsed)
    case 'leftGreen':
      return Math.max(0, TIMINGS.leftMinMs - elapsed)
    case 'leftYellow':
      return Math.max(0, TIMINGS.yellowMs - elapsed)
  }
}

export function getTrafficSummary(cars: Car[]): TrafficSummary {
  const summary: TrafficSummary = {
    totalCars: cars.length,
    axisDemand: { NS: 0, EW: 0 },
    leftDemand: { NS: 0, EW: 0 },
    walksActive: 0,
    byLane: {},
  }

  for (const car of cars) {
    const axis = axisForApproach(car.approach)
    summary.axisDemand[axis] += 1
    if (car.intent === 'left') {
      summary.leftDemand[axis] += 1
    }
    const key = getLaneKey(car.approach, car.lane)
    summary.byLane[key] = (summary.byLane[key] ?? 0) + 1
  }

  return summary
}

export function getLaneSignal(state: SimState, approach: Approach): { left: SignalColor; straight: SignalColor; right: SignalColor } {
  const axis = axisForApproach(approach)
  const walkBlocking = state.walks[axisToCrossing(axis)].active || state.walks[axisToCrossing(axis)].requested

  if (state.activeAxis !== axis) {
    // While the active axis is running its protected left phase, the
    // perpendicular axis can safely release right-on-red-style right turns:
    // those vehicles merge into the same exit lane the protected left
    // turners are entering and never cross opposing traffic.
    if (state.phase === 'leftGreen') {
      if (walkBlocking) {
        return { left: 'red', straight: 'red', right: 'red' }
      }
      return { left: 'red', straight: 'red', right: 'green' }
    }
    if (state.phase === 'leftYellow') {
      if (walkBlocking) {
        return { left: 'red', straight: 'red', right: 'red' }
      }
      // Perpendicular right turn shares the same clearance window as the
      // active axis's protected left, so it goes yellow at the same time.
      return { left: 'red', straight: 'red', right: 'yellow' }
    }
    return { left: 'red', straight: 'red', right: 'red' }
  }

  switch (state.phase) {
    case 'straightGreen':
      // While pedestrians are in our conflicting crosswalk, turning movements
      // must hold; straight-through traffic is not in conflict and keeps going.
      if (walkBlocking) {
        return { left: 'red', straight: 'green', right: 'red' }
      }
      // Permissive left: drivers may turn left when a gap in opposing
      // straight traffic allows; protected left arrow comes later in the cycle.
      return { left: 'flashingOrange', straight: 'green', right: 'green' }
    case 'straightYellow':
      return { left: 'red', straight: 'yellow', right: 'yellow' }
    case 'allRedToLeft':
    case 'allRedToSwap':
      return { left: 'red', straight: 'red', right: 'red' }
    case 'leftGreen':
      return { left: 'green', straight: 'red', right: 'red' }
    case 'leftYellow':
      return { left: 'yellow', straight: 'red', right: 'red' }
  }
}

export function getLaneKey(approach: Approach, lane: LaneKind): LaneKey {
  return `${approach}-${lane}`
}

export function carPositionAtProgress(car: Car) {
  return pointAlongPath(car.path, car.progress)
}

export function carAngleAtProgress(car: Car) {
  return pointAlongPath(car.path, car.progress).angle
}

export function buildPathForCar(approach: Approach, lane: LaneKind, intent: Intent) {
  return buildCarPath(approach, lane, intent)
}

function tickPhase(state: SimState, summary: TrafficSummary): SimState {
  const elapsed = state.now - state.phaseStartedAt
  const currentWalk = activeWalkForAxis(state)

  switch (state.phase) {
    case 'straightGreen': {
      const walkBlocking = currentWalk?.active && currentWalk.activeUntil !== null && currentWalk.activeUntil > state.now
      if (walkBlocking) {
        return state
      }

      if (elapsed < TIMINGS.straightMinMs) {
        return state
      }

      const otherAxis = oppositeAxis(state.activeAxis)
      const currentDemand = summary.axisDemand[state.activeAxis]
      const otherDemand = summary.axisDemand[otherAxis]
      const priorityAxis = state.priorityAxis

      if (state.activeAxis === priorityAxis) {
        if (otherDemand > 0 && currentDemand === 0) {
          return beginPhase(state, 'straightYellow')
        }

        if (otherDemand > 0 && currentDemand > 0 && elapsed >= TIMINGS.straightMinMs + 5_000) {
          return beginPhase(state, 'straightYellow')
        }

        return state
      }

      if (otherDemand > 0 || currentDemand === 0) {
        return beginPhase(state, 'straightYellow')
      }

      return state
    }
    case 'straightYellow':
      return elapsed >= TIMINGS.yellowMs ? beginPhase(state, 'allRedToLeft') : state
    case 'allRedToLeft': {
      if (elapsed < TIMINGS.allRedMs) {
        return state
      }

      return beginPhase(state, 'leftGreen')
    }
    case 'leftGreen':
      return elapsed >= TIMINGS.leftMinMs ? beginPhase(state, 'leftYellow') : state
    case 'leftYellow':
      return elapsed >= TIMINGS.yellowMs ? beginPhase(state, 'allRedToSwap') : state
    case 'allRedToSwap': {
      if (elapsed < TIMINGS.allRedMs) {
        return state
      }

      return beginPhase({ ...state, activeAxis: oppositeAxis(state.activeAxis) }, 'straightGreen')
    }
  }
}

function maybeAdvancePhase(state: SimState, summary: TrafficSummary): SimState {
  let nextState = state
  let guard = 0

  while (guard < 6) {
    const advanced = tickPhase(nextState, summary)
    if (advanced === nextState) {
      break
    }

    nextState = advanced
    guard += 1
  }

  return nextState
}

function advanceCars(state: SimState, deltaMs: number): Car[] {
  const movementSeconds = deltaMs / 1_000
  // A walk request for the conflicting crossing blocks turning movements even
  // before it formally activates. Otherwise a right-turner can advance past
  // the stop line in the one-tick gap between Request being clicked and
  // updateWalks flipping the walk to active, then sail through as "committed".
  const conflictingWalk = state.walks[axisToCrossing(state.activeAxis)]
  const walkBlocking = conflictingWalk.active || conflictingWalk.requested
  const minFollowGap = laneShape.carLength + 8

  const yellowRemainingMs =
    state.phase === 'straightYellow' || state.phase === 'leftYellow'
      ? Math.max(0, TIMINGS.yellowMs - (state.now - state.phaseStartedAt))
      : 0

  // Group by approach+lane so we can process each queue from the front car back.
  const groups = new Map<string, Car[]>()
  for (const car of state.cars) {
    const key = `${car.approach}-${car.lane}`
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(car)
    } else {
      groups.set(key, [car])
    }
  }

  const updatedById = new Map<number, Car>()

  for (const queue of groups.values()) {
    queue.sort((a, b) => b.progress - a.progress)
    let leaderProgress = Number.POSITIVE_INFINITY

    for (const car of queue) {
      const canPass = decideCanPass(car, state, walkBlocking, yellowRemainingMs)
      // Cars cleared to pass have no end-of-path cap; they drive off-screen and get culled.
      const phaseLimit = canPass ? Number.POSITIVE_INFINITY : car.stopDistance
      const leaderLimit = leaderProgress - minFollowGap
      const cap = Math.min(phaseLimit, leaderLimit)
      const desired = car.progress + car.speed * movementSeconds * state.speed
      const nextProgress = Math.max(car.progress, Math.min(desired, cap))

      updatedById.set(car.id, { ...car, progress: nextProgress })
      leaderProgress = nextProgress
    }
  }

  const nextCars: Car[] = []
  for (const car of state.cars) {
    const updated = updatedById.get(car.id) ?? car
    if (updated.progress < updated.pathLength + 8) {
      nextCars.push(updated)
    }
  }

  return nextCars
}

function spawnCars(state: SimState, now: number) {
  const nextCars = [...state.cars]
  const nextSpawnAt = { ...state.nextSpawnAt }
  let nextId = state.nextId

  for (const approach of APPROACHES) {
    for (const lane of LANE_ORDER) {
      const key = getLaneKey(approach, lane)
      while (now >= nextSpawnAt[key]) {
        const laneBlocked = nextCars.some((car) => car.approach === approach && car.lane === lane && car.progress < 60)
        if (laneBlocked) {
          nextSpawnAt[key] += 900
          break
        }

        const laneProfile = laneSpawnProfiles[lane]
        const intent: Intent = lane === 'left' ? 'left' : lane === 'right' ? 'right' : 'straight'
        const path = buildCarPath(approach, lane, intent)
        const car: Car = {
          id: nextId + 1,
          approach,
          lane,
          intent,
          path: path.points,
          pathLength: path.length,
          progress: 0,
          stopDistance: path.stopDistance,
          speed: laneProfile.speed,
          length: laneShape.carLength,
          width: laneShape.carWidth,
          color: LANE_COLORS[intent],
        }

        nextCars.push(car)
        nextId += 1
        // Higher busyness shortens spawn intervals; lower stretches them out.
        // The priority axis gets 40% more traffic than the slider value, the
        // way a real arterial road carries more cars than its cross street.
        const approachAxis = axisForApproach(approach)
        const axisMultiplier = approachAxis === state.priorityAxis ? 1.4 : 1
        const intervalScale = 1 / Math.max(0.05, state.busyness * axisMultiplier)
        const minMs = laneProfile.minMs * intervalScale
        const maxMs = laneProfile.maxMs * intervalScale
        nextSpawnAt[key] = now + randomBetween(minMs, maxMs)
      }
    }
  }

  return {
    cars: nextCars,
    nextSpawnAt,
    nextId,
  }
}

function updateWalks(state: SimState, now: number): Record<Crossing, WalkState> {
  const nextWalks: Record<Crossing, WalkState> = {
    NS: { ...state.walks.NS },
    EW: { ...state.walks.EW },
  }

  for (const crossing of ['NS', 'EW'] as Crossing[]) {
    const requiredAxis = crossing === 'NS' ? 'EW' : 'NS'
    const walk = nextWalks[crossing]

    if (walk.active && walk.activeUntil !== null && now >= walk.activeUntil) {
      nextWalks[crossing] = { requested: false, active: false, activeUntil: null }
      continue
    }

    if (walk.requested && !walk.active && state.phase === 'straightGreen' && state.activeAxis === requiredAxis) {
      nextWalks[crossing] = {
        requested: true,
        active: true,
        activeUntil: now + TIMINGS.walkMs,
      }
    }
  }

  return nextWalks
}

function activeWalkForAxis(state: SimState) {
  const crossing = axisToCrossing(state.activeAxis)
  return state.walks[crossing]
}

function beginPhase(state: SimState, phase: Phase): SimState {
  return {
    ...state,
    phase,
    phaseStartedAt: state.now,
  }
}

function decideCanPass(
  car: Car,
  state: SimState,
  walkBlocking: boolean,
  yellowRemainingMs: number,
): boolean {
  const axis = axisForApproach(car.approach)

  // Once the car has actually crossed the stop line into the intersection,
  // it must clear the intersection. Use a strict comparison so a car that was
  // clamped exactly TO the stop line on a previous tick is not considered
  // committed and stays put until its signal allows it through.
  if (car.progress > car.stopDistance + 0.5) {
    return true
  }

  if (state.activeAxis !== axis) {
    // Right turners on the perpendicular axis are released during the
    // active axis's protected left phase — see getLaneSignal for rationale.
    if (
      car.intent === 'right' &&
      (state.phase === 'leftGreen' || state.phase === 'leftYellow') &&
      !walkBlocking
    ) {
      return true
    }
    return false
  }

  switch (state.phase) {
    case 'straightGreen': {
      if (car.intent === 'left') {
        if (walkBlocking) return false
        return hasSafeLeftGap(car, state.cars)
      }
      if (car.intent === 'right') {
        // Right turners cross the same pedestrian crosswalk that the active
        // walk occupies, so they must hold until the walk clears.
        return !walkBlocking
      }
      return true
    }
    case 'straightYellow': {
      if (car.intent === 'left') return false
      return canClearBeforeRed(car, yellowRemainingMs)
    }
    case 'leftGreen':
      return car.intent === 'left'
    case 'leftYellow': {
      if (car.intent !== 'left') return false
      return canClearBeforeRed(car, yellowRemainingMs)
    }
    case 'allRedToLeft':
    case 'allRedToSwap':
      return false
  }
}

function canClearBeforeRed(car: Car, yellowRemainingMs: number): boolean {
  const distanceToStopLine = Math.max(0, car.stopDistance - car.progress)
  if (distanceToStopLine === 0) return true
  if (yellowRemainingMs <= 0) return false
  const timeToClearMs = (distanceToStopLine / car.speed) * 1_000
  return timeToClearMs <= yellowRemainingMs
}

function axisForApproach(approach: Approach): Axis {
  return approach === 'N' || approach === 'S' ? 'NS' : 'EW'
}

function oppositeApproach(approach: Approach): Approach {
  return ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[approach]
}

// Reaction/safety buffer added on top of geometric clearance.
const LEFT_TURN_REACTION_SEC = 0.6

// Distance an opposing straight car must travel from its own stop line to
// reach the point where the turner's exit lane crosses it. Derived from
// geometry: opposing stop is STOP_LINE_OFFSET from intersection center on the
// opposing inbound axis; the turner exits along its inside lane, which sits
// LANE_OFFSET_FROM_MEDIAN past center on that same axis.
const OPPOSING_STOP_TO_CONFLICT = STOP_LINE_OFFSET - LANE_OFFSET_FROM_MEDIAN

// Turner's path distance from its own stop line to the centerline of opposing
// straight lane index L. Path: stop -> p1 along inbound, p1 -> p2 diagonal
// chamfer, p2 -> opposing lane center along exit axis.
function turnerDistanceToOpposingLane(laneIdx: number): number {
  const stopToCorner = STOP_LINE_OFFSET + LANE_OFFSET_FROM_MEDIAN
  const stopToP1 = stopToCorner - LEFT_TURN_CHAMFER
  const p1ToP2 = Math.SQRT2 * LEFT_TURN_CHAMFER
  // Distance from corner (along exit axis) out to opposing lane center:
  // turner's inbound offset (LANE_OFFSET_FROM_MEDIAN) on one side of the
  // median, plus the opposing lane's offset on the other side.
  const cornerToLaneCenter = LANE_OFFSET_FROM_MEDIAN + LANE_OFFSET_FROM_MEDIAN + laneIdx * laneSpacing
  const p2ToLaneCenter = cornerToLaneCenter - LEFT_TURN_CHAMFER
  return stopToP1 + p1ToP2 + p2ToLaneCenter
}

// True when no opposing-approach straight car would arrive at any conflict
// point before the turning car has fully cleared that same point. Only
// oncoming **straight** traffic matters — right turners use their own lane
// and other left turners share the protected/permissive cycle, so neither
// interferes with a permissive left.
function hasSafeLeftGap(car: Car, cars: Car[]): boolean {
  const opposing = oppositeApproach(car.approach)

  // Each opposing straight car is evaluated independently: checking only the
  // front-most car is unsafe because a follower can arrive at the conflict
  // point during the turn even if the leader passes the time check.
  for (const other of cars) {
    if (other.approach !== opposing) continue
    if (other.intent !== 'straight') continue

    const laneIdx = LANE_ORDER.indexOf(other.lane)
    const opposingDistanceToConflict = (other.stopDistance + OPPOSING_STOP_TO_CONFLICT) - other.progress

    // Opposing car has already driven past its conflict point with us → safe.
    if (opposingDistanceToConflict < -laneShape.carLength) continue
    // Opposing car is currently inside its conflict zone → guaranteed strike.
    if (opposingDistanceToConflict < laneShape.carLength) return false

    const opposingArrivalSec = opposingDistanceToConflict / other.speed

    // Turner must traverse from its stop line to past this opposing lane's
    // centerline by at least a car length to be considered clear.
    const turnerClearDistance = turnerDistanceToOpposingLane(laneIdx) + laneShape.carLength
    const turnerClearSec = turnerClearDistance / car.speed + LEFT_TURN_REACTION_SEC

    if (opposingArrivalSec < turnerClearSec) {
      return false
    }
  }

  return true
}

function axisToCrossing(axis: Axis): Crossing {
  return axis === 'NS' ? 'EW' : 'NS'
}

function oppositeAxis(axis: Axis): Axis {
  return axis === 'NS' ? 'EW' : 'NS'
}

function randomBetween(minMs: number, maxMs: number) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs))
}

export const BUSYNESS_MIN = 0.2
export const BUSYNESS_MAX = 3

function clampBusyness(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(BUSYNESS_MAX, Math.max(BUSYNESS_MIN, value))
}

function createInitialState(): SimState {
  const now = 0
  const nextSpawnAt = Object.fromEntries(
    APPROACHES.flatMap((approach) =>
      LANE_ORDER.map((lane) => [getLaneKey(approach, lane), randomBetween(200, 1_400)] as const),
    ),
  ) as Record<LaneKey, number>

  return {
    now,
    phase: 'straightGreen',
    activeAxis: 'NS',
    phaseStartedAt: now,
    priorityAxis: 'NS',
    paused: false,
    speed: 1,
    busyness: 1,
    cars: [],
    walks: {
      NS: { requested: false, active: false, activeUntil: null },
      EW: { requested: false, active: false, activeUntil: null },
    },
    nextSpawnAt,
    nextId: 0,
  }
}

function buildCarPath(approach: Approach, lane: LaneKind, intent: Intent) {
  const inboundLaneIdx = LANE_ORDER.indexOf(lane)
  const inboundHeading = headingFromApproach(approach)
  const exitHeading = postTurnHeading(approach, intent)
  const exitIdx = exitLaneIdxFor(intent, inboundLaneIdx)

  const startPoint = approachStartPoint(approach, inboundLaneIdx)
  const stopPoint = approachStopPoint(approach, inboundLaneIdx)
  const exitPoint = exitDirectionPoint(exitHeading, exitIdx)

  const points: Point[] = [startPoint, stopPoint]

  if (intent === 'left') {
    const [p1, p2] = leftTurnPivots(inboundHeading, inboundLaneIdx, exitHeading, exitIdx)
    points.push(p1, p2)
  } else if (intent === 'right') {
    points.push(turnPivot(inboundHeading, inboundLaneIdx, exitHeading, exitIdx))
  }

  points.push(exitPoint)

  return {
    points,
    length: polylineLength(points),
    stopDistance: polylineLength([startPoint, stopPoint]),
  }
}

export function headingFromApproach(approach: Approach): Heading {
  return ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[approach]
}

export function turnLeft(heading: Heading): Heading {
  return ({ N: 'W', W: 'S', S: 'E', E: 'N' } as const)[heading]
}

export function turnRight(heading: Heading): Heading {
  return ({ N: 'E', E: 'S', S: 'W', W: 'N' } as const)[heading]
}

export function postTurnHeading(approach: Approach, intent: Intent): Heading {
  const heading = headingFromApproach(approach)
  if (intent === 'straight') return heading
  return intent === 'left' ? turnLeft(heading) : turnRight(heading)
}

export function isVerticalHeading(heading: Heading): boolean {
  return heading === 'N' || heading === 'S'
}

function baseSideForHeading(heading: Heading): -1 | 1 {
  // In right-hand traffic, the side a car occupies relative to road center.
  // Facing N -> right is +x (east). Facing E -> right is +y (south).
  return (heading === 'N' || heading === 'E' ? 1 : -1) as -1 | 1
}

export function sideForHeading(heading: Heading): -1 | 1 {
  const base = baseSideForHeading(heading)
  return (ROAD_HAND === 'right' ? base : -base) as -1 | 1
}

export function laneCrossCoord(heading: Heading, laneIdx: number): number {
  const side = sideForHeading(heading)
  const offset = side * (LANE_OFFSET_FROM_MEDIAN + laneIdx * laneSpacing)
  return isVerticalHeading(heading) ? VIEW.centerX + offset : VIEW.centerY + offset
}

export function exitLaneIdxFor(intent: Intent, inboundLaneIdx: number): number {
  if (intent === 'left') return 0
  if (intent === 'right') return LANE_ORDER.length - 1
  return inboundLaneIdx
}

function approachStartPoint(approach: Approach, laneIdx: number): Point {
  const heading = headingFromApproach(approach)
  const cross = laneCrossCoord(heading, laneIdx)
  if (approach === 'N') return { x: cross, y: -140 }
  if (approach === 'S') return { x: cross, y: VIEW.height + 140 }
  if (approach === 'W') return { x: -140, y: cross }
  return { x: VIEW.width + 140, y: cross }
}

function approachStopPoint(approach: Approach, laneIdx: number): Point {
  const heading = headingFromApproach(approach)
  const cross = laneCrossCoord(heading, laneIdx)
  if (approach === 'N') return { x: cross, y: VIEW.centerY - STOP_LINE_OFFSET }
  if (approach === 'S') return { x: cross, y: VIEW.centerY + STOP_LINE_OFFSET }
  if (approach === 'W') return { x: VIEW.centerX - STOP_LINE_OFFSET, y: cross }
  return { x: VIEW.centerX + STOP_LINE_OFFSET, y: cross }
}

function exitDirectionPoint(direction: Heading, laneIdx: number): Point {
  const cross = laneCrossCoord(direction, laneIdx)
  if (direction === 'S') return { x: cross, y: VIEW.height + 140 }
  if (direction === 'N') return { x: cross, y: -140 }
  if (direction === 'E') return { x: VIEW.width + 140, y: cross }
  return { x: -140, y: cross }
}

function turnPivot(inboundHeading: Heading, inboundLaneIdx: number, exitHeading: Heading, exitLaneIdx: number): Point {
  const inboundCross = laneCrossCoord(inboundHeading, inboundLaneIdx)
  const exitCross = laneCrossCoord(exitHeading, exitLaneIdx)

  // Inbound axis is perpendicular to exit axis; pivot at the meeting of the two lane centerlines.
  if (isVerticalHeading(inboundHeading)) {
    return { x: inboundCross, y: exitCross }
  }

  return { x: exitCross, y: inboundCross }
}

// Distance (in pixels) that each 45-degree chamfer extends from the naive
// right-angle corner. Large enough to push opposing-direction left turns past
// each other so their paths no longer cross inside the intersection.
const LEFT_TURN_CHAMFER = 48

function headingUnitVector(heading: Heading): Point {
  switch (heading) {
    case 'N':
      return { x: 0, y: -1 }
    case 'S':
      return { x: 0, y: 1 }
    case 'E':
      return { x: 1, y: 0 }
    case 'W':
      return { x: -1, y: 0 }
  }
}

// Split the single 90-degree left-turn corner into two 45-degree corners so
// that opposing left turns pass each other (left-side to left-side) rather
// than crossing through the same point near the intersection center.
function leftTurnPivots(
  inboundHeading: Heading,
  inboundLaneIdx: number,
  exitHeading: Heading,
  exitLaneIdx: number,
): [Point, Point] {
  const corner = turnPivot(inboundHeading, inboundLaneIdx, exitHeading, exitLaneIdx)
  const inboundDir = headingUnitVector(inboundHeading)
  const exitDir = headingUnitVector(exitHeading)
  const c = LEFT_TURN_CHAMFER

  // First pivot: back off from the corner along the inbound direction so the
  // car leaves its inbound lane before reaching the naive corner.
  const p1: Point = { x: corner.x - inboundDir.x * c, y: corner.y - inboundDir.y * c }
  // Second pivot: advance along the exit direction so the car merges into the
  // exit lane past the naive corner.
  const p2: Point = { x: corner.x + exitDir.x * c, y: corner.y + exitDir.y * c }

  return [p1, p2]
}

function polylineLength(points: Point[]) {
  let total = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    total += distance(points[index], points[index + 1])
  }
  return total
}

function pointAlongPath(points: Point[], progress: number) {
  let remaining = Math.max(0, progress)

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const segmentLength = distance(start, end)

    if (remaining <= segmentLength) {
      const ratio = segmentLength === 0 ? 0 : remaining / segmentLength
      const x = start.x + (end.x - start.x) * ratio
      const y = start.y + (end.y - start.y) * ratio
      return { x, y, angle: angleBetween(start, end) }
    }

    remaining -= segmentLength
  }

  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  return { x: last.x, y: last.y, angle: angleBetween(prev, last) }
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function angleBetween(a: Point, b: Point) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}
