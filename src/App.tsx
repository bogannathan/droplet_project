import { useEffect, useMemo, useReducer } from 'react'
import './App.css'
import {
  APPROACHES,
  ALL_RED_MS,
  BUSYNESS_MAX,
  BUSYNESS_MIN,
  LANE_LABELS,
  LANE_ORDER,
  LEFT_MIN_MS,
  TIMINGS,
  VIEW,
  YELLOW_MS,
  INITIAL_STATE,
  carAngleAtProgress,
  carPositionAtProgress,
  getLaneKey,
  getLaneSignal,
  getPhaseLabel,
  getPhaseRemainingMs,
  getTrafficSummary,
  laneCrossCoord,
  reducer,
  type Crossing,
  type Heading,
  type SimState,
} from './sim'

function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      dispatch({ type: 'tick', deltaMs: TIMINGS.tickMs })
    }, TIMINGS.tickMs)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    document.title = `${getPhaseLabel(state)} | Traffic Intersection`
  }, [state])

  const summary = useMemo(() => getTrafficSummary(state.cars), [state.cars])
  const walksActive = useMemo(() => Object.values(state.walks).filter((walk) => walk.active).length, [state.walks])
  const remainingMs = getPhaseRemainingMs(state)
  const phaseLabel = getPhaseLabel(state)

  return (
    <div className="app-shell">

      <main className="layout">
        <section className="visual-card">
          <div className="visual-header">
            <div>
              <h2>Intersection view</h2>
              <p>
                Green shows straight-through traffic, yellow is the transition,
                and protected left turns come after the red-clearance gap.
              </p>
            </div>
            <div className="legend">
              <LegendDot color="green" label="Straight" />
              <LegendDot color="yellow" label="Yellow" />
              <LegendDot color="orange" label="Permissive left" />
              <LegendDot color="red" label="Stop" />
            </div>
          </div>

          <div className="stage-wrap">
            <svg
              className="stage"
              viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
              role="img"
              aria-label="Traffic intersection simulator"
            >
              <defs>
                <linearGradient id="road-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#25303b" />
                  <stop offset="100%" stopColor="#182029" />
                </linearGradient>
                <linearGradient id="glow" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
              </defs>

              <rect width={VIEW.width} height={VIEW.height} fill="url(#glow)" opacity="0.25" />

              <rect
                x={VIEW.centerX - VIEW.roadBand / 2}
                y={0}
                width={VIEW.roadBand}
                height={VIEW.height}
                fill="url(#road-fill)"
                rx="18"
              />
              <rect
                x={0}
                y={VIEW.centerY - VIEW.roadBand / 2}
                width={VIEW.width}
                height={VIEW.roadBand}
                fill="url(#road-fill)"
                rx="18"
              />

              <rect
                x={VIEW.centerX - VIEW.intersectionHalf}
                y={VIEW.centerY - VIEW.intersectionHalf}
                width={VIEW.intersectionHalf * 2}
                height={VIEW.intersectionHalf * 2}
                fill="#10151b"
                opacity="0.9"
                rx="18"
              />

              <g className="lane-markings" stroke="#d9e5ea" strokeOpacity="0.75">
                {(['S', 'N'] as Heading[]).map((heading) =>
                  LANE_ORDER.map((lane, laneIndex) => {
                    const laneX = laneCrossCoord(heading, laneIndex)
                    const inboundApproach: 'N' | 'S' = heading === 'S' ? 'N' : 'S'
                    const labelY = inboundApproach === 'N' ? 40 : VIEW.height - 20
                    return (
                      <g key={`v-${heading}-${lane}`}>
                        <line
                          x1={laneX}
                          x2={laneX}
                          y1={0}
                          y2={VIEW.centerY - VIEW.intersectionHalf}
                          strokeDasharray="18 16"
                          strokeWidth="2"
                        />
                        <line
                          x1={laneX}
                          x2={laneX}
                          y1={VIEW.centerY + VIEW.intersectionHalf}
                          y2={VIEW.height}
                          strokeDasharray="18 16"
                          strokeWidth="2"
                        />
                        <text x={laneX} y={labelY} className="lane-tag">
                          {LANE_LABELS[lane]}
                        </text>
                      </g>
                    )
                  }),
                )}
                {(['E', 'W'] as Heading[]).map((heading) =>
                  LANE_ORDER.map((lane, laneIndex) => {
                    const laneY = laneCrossCoord(heading, laneIndex)
                    const inboundApproach: 'E' | 'W' = heading === 'W' ? 'E' : 'W'
                    const labelX = inboundApproach === 'W' ? 34 : VIEW.width - 34
                    return (
                      <g key={`h-${heading}-${lane}`}>
                        <line
                          x1={0}
                          x2={VIEW.centerX - VIEW.intersectionHalf}
                          y1={laneY}
                          y2={laneY}
                          strokeDasharray="18 16"
                          strokeWidth="2"
                        />
                        <line
                          x1={VIEW.centerX + VIEW.intersectionHalf}
                          x2={VIEW.width}
                          y1={laneY}
                          y2={laneY}
                          strokeDasharray="18 16"
                          strokeWidth="2"
                        />
                        <text x={labelX} y={laneY - 10} className="lane-tag">
                          {LANE_LABELS[lane]}
                        </text>
                      </g>
                    )
                  }),
                )}
              </g>

              <g className="crosswalks" opacity="0.65">
                <rect x={VIEW.centerX - VIEW.intersectionHalf - 28} y={VIEW.centerY - 96} width={18} height={192} fill="#f5f0d8" />
                <rect x={VIEW.centerX + VIEW.intersectionHalf + 10} y={VIEW.centerY - 96} width={18} height={192} fill="#f5f0d8" />
                <rect x={VIEW.centerX - 96} y={VIEW.centerY - VIEW.intersectionHalf - 28} width={192} height={18} fill="#f5f0d8" />
                <rect x={VIEW.centerX - 96} y={VIEW.centerY + VIEW.intersectionHalf + 10} width={192} height={18} fill="#f5f0d8" />
              </g>

              <g className="pedestrians">
                {pedestrianMarkers(state).map((p) => (
                  <circle key={p.key} cx={p.x} cy={p.y} r={4} className="pedestrian" />
                ))}
              </g>

              <g className="cars">
                {state.cars
                  .slice()
                  .sort((left, right) => left.progress - right.progress)
                  .map((car) => {
                    const { x, y } = carPositionAtProgress(car)
                    const rotation = carAngleAtProgress(car)
                    return (
                      <g key={car.id} transform={`translate(${x} ${y}) rotate(${rotation})`}>
                        <rect
                          x={-car.length / 2}
                          y={-car.width / 2}
                          width={car.length}
                          height={car.width}
                          rx="4"
                          className={`car car-${car.intent}`}
                        />
                        <circle cx="0" cy="0" r="1.8" className="car-dot" />
                      </g>
                    )
                  })}
              </g>

              {APPROACHES.map((approach) => {
                const signal = getLaneSignal(state, approach)
                return (
                  <g key={approach} className="signal-cluster">
                    <SignalCluster approach={approach} signal={signal} />
                  </g>
                )
              })}

              <g className="center-labels">
                <text x={VIEW.centerX} y={VIEW.centerY - 12} textAnchor="middle" className="center-title">
                  intersection core
                </text>
                <text x={VIEW.centerX} y={VIEW.centerY + 14} textAnchor="middle" className="center-subtitle">
                  protected lefts + walk requests
                </text>
              </g>
            </svg>
          </div>
        </section>

        <aside className="sidebar">
          <PanelSection title="Controls">
            <div className="button-row">
              <button type="button" onClick={() => dispatch({ type: 'walk', crossing: 'NS' })}>
                Walk NS crossing
              </button>
              <button type="button" onClick={() => dispatch({ type: 'walk', crossing: 'EW' })}>
                Walk EW crossing
              </button>
            </div>
            <div className="button-row">
              <button type="button" onClick={() => dispatch({ type: 'togglePause' })}>
                {state.paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" onClick={() => dispatch({ type: 'reset' })}>
                Reset
              </button>
            </div>
            <div className="speed-row">
              {[0.5, 1, 1.5, 2].map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={state.speed === speed ? 'selected' : ''}
                  onClick={() => dispatch({ type: 'speed', speed })}
                >
                  {speed}x
                </button>
              ))}
            </div>
            <div className="busyness-row">
              <label htmlFor="busyness-slider">
                Traffic busyness: <strong>{state.busyness.toFixed(2)}x</strong>
              </label>
              <input
                id="busyness-slider"
                type="range"
                min={BUSYNESS_MIN}
                max={BUSYNESS_MAX}
                step={0.05}
                value={state.busyness}
                onChange={(event) =>
                  dispatch({ type: 'busyness', busyness: Number(event.target.value) })
                }
              />
              <div className="busyness-scale">
                <span>quiet</span>
                <span>normal</span>
                <span>busy</span>
              </div>
            </div>
          </PanelSection>

          <PanelSection title="Signal state">
            <dl className="signal-grid">
              <InfoRow label="Active axis" value={state.activeAxis} />
              <InfoRow label="Priority axis" value={state.priorityAxis} />
              <InfoRow label="Phase age" value={`${Math.floor((state.now - state.phaseStartedAt) / 1000)}s`} />
              <InfoRow label="Minimum straight" value={`${TIMINGS.straightMinMs / 1000}s`} />
              <InfoRow label="Minimum left" value={`${LEFT_MIN_MS / 1000}s`} />
              <InfoRow label="Yellow" value={`${YELLOW_MS / 1000}s`} />
              <InfoRow label="All-red" value={`${ALL_RED_MS / 1000}s`} />
            </dl>
          </PanelSection>

          <PanelSection title="Pedestrians">
            {(['NS', 'EW'] as Crossing[]).map((crossing) => {
              const walk = state.walks[crossing]
              return (
                <div key={crossing} className="walk-card">
                  <div>
                    <strong>Cross {crossing}</strong>
                    <p>
                      {walk.active
                        ? `Walking until ${Math.ceil(((walk.activeUntil ?? state.now) - state.now) / 1000)}s`
                        : walk.requested
                          ? 'Queued'
                          : 'Idle'}
                    </p>
                  </div>
                  <button type="button" onClick={() => dispatch({ type: 'walk', crossing })}>
                    Request
                  </button>
                </div>
              )
            })}
          </PanelSection>

          <PanelSection title="Traffic summary">
            <div className="summary-grid">
              <SummaryChip label="Cars" value={summary.totalCars} />
              <SummaryChip label="NS demand" value={summary.axisDemand.NS} />
              <SummaryChip label="EW demand" value={summary.axisDemand.EW} />
              <SummaryChip label="Left NS" value={summary.leftDemand.NS} />
              <SummaryChip label="Left EW" value={summary.leftDemand.EW} />
              <SummaryChip label="Walks active" value={walksActive} />
            </div>

            {(['N', 'S', 'E', 'W'] as const).map((approach) => (
              <div key={approach} className="approach-card">
                <div className="approach-title">{approach} approach</div>
                <div className="lane-counts">
                  {LANE_ORDER.map((lane) => {
                    const laneKey = getLaneKey(approach, lane)
                    return (
                      <span key={laneKey}>
                        {LANE_LABELS[lane]}: {summary.byLane[laneKey] ?? 0}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </PanelSection>
        </aside>
      </main>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="legend-item">
      <span className={`legend-dot ${color}`} />
      <span>{label}</span>
    </div>
  )
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SignalCluster({
  approach,
  signal,
}: {
  approach: 'N' | 'S' | 'E' | 'W'
  signal: ReturnType<typeof getLaneSignal>
}) {
  const layout = signalLayout(approach)
  const housing = layout.vertical
    ? { x: -16, y: -36, width: 32, height: 72 }
    : { x: -36, y: -16, width: 72, height: 32 }

  return (
    <g transform={`translate(${layout.x} ${layout.y})`}>
      <rect
        x={housing.x}
        y={housing.y}
        width={housing.width}
        height={housing.height}
        rx={14}
        className="signal-housing"
      />
      {layout.lights.map((light, index) => {
        const color = index === 0 ? signal.left : index === 1 ? signal.straight : signal.right
        return <circle key={light.key} cx={light.cx} cy={light.cy} r={6.5} className={`signal-light ${color}`} />
      })}
    </g>
  )
}

// Each signal sits inside the intersection on the far side from its
// approach, centered laterally over that approach's four lanes. Lights are
// ordered left → straight → right from the driver's point of view, so the
// right-turn light always sits on the driver's right.
function signalLayout(approach: 'N' | 'S' | 'E' | 'W') {
  // Distance from intersection center to a signal sitting just inside the
  // far interior edge. 18 leaves a little breathing room from the curb.
  const interior = VIEW.intersectionHalf - 18
  // Lateral center of the four inbound lanes for an approach: lanes sit at
  // LANE_OFFSET_FROM_MEDIAN + laneSpacing*idx (16, 48, 80, 112), midpoint 64.
  const laneMid = 64

  switch (approach) {
    case 'N':
      // Driver heads south; lanes are in the west half. Driver's left = east.
      return {
        x: VIEW.centerX - laneMid,
        y: VIEW.centerY + interior,
        vertical: false,
        lights: [
          { key: 'left', cx: 22, cy: 0 },
          { key: 'straight', cx: 0, cy: 0 },
          { key: 'right', cx: -22, cy: 0 },
        ],
      }
    case 'S':
      // Driver heads north; lanes are in the east half. Driver's left = west.
      return {
        x: VIEW.centerX + laneMid,
        y: VIEW.centerY - interior,
        vertical: false,
        lights: [
          { key: 'left', cx: -22, cy: 0 },
          { key: 'straight', cx: 0, cy: 0 },
          { key: 'right', cx: 22, cy: 0 },
        ],
      }
    case 'E':
      // Driver heads west; lanes are in the north half. Driver's left = south.
      return {
        x: VIEW.centerX - interior,
        y: VIEW.centerY - laneMid,
        vertical: true,
        lights: [
          { key: 'left', cx: 0, cy: 22 },
          { key: 'straight', cx: 0, cy: 0 },
          { key: 'right', cx: 0, cy: -22 },
        ],
      }
    case 'W':
    default:
      // Driver heads east; lanes are in the south half. Driver's left = north.
      return {
        x: VIEW.centerX + interior,
        y: VIEW.centerY + laneMid,
        vertical: true,
        lights: [
          { key: 'left', cx: 0, cy: -22 },
          { key: 'straight', cx: 0, cy: 0 },
          { key: 'right', cx: 0, cy: 22 },
        ],
      }
  }
}

interface PedestrianMarker {
  key: string
  x: number
  y: number
}

// Animate one pedestrian along each crosswalk used by an active walk request.
// NS walk (crossing the NS street) uses the north and south crosswalks,
// walking east-west; EW walk uses the east and west crosswalks, walking
// north-south. Pedestrians on the two opposing crosswalks travel in opposite
// directions so it reads naturally as foot traffic crossing the road.
function pedestrianMarkers(state: SimState): PedestrianMarker[] {
  const markers: PedestrianMarker[] = []
  const crosswalkSpan = 96

  for (const crossing of ['NS', 'EW'] as Crossing[]) {
    const walk = state.walks[crossing]
    if (!walk.active || walk.activeUntil === null) continue

    const remaining = Math.max(0, walk.activeUntil - state.now)
    const t = Math.min(1, Math.max(0, 1 - remaining / TIMINGS.walkMs))

    if (crossing === 'NS') {
      // North crosswalk: walk west -> east. South crosswalk: east -> west.
      const northY = VIEW.centerY - VIEW.intersectionHalf - 19
      const southY = VIEW.centerY + VIEW.intersectionHalf + 19
      markers.push({
        key: 'walk-NS-north',
        x: VIEW.centerX - crosswalkSpan + t * crosswalkSpan * 2,
        y: northY,
      })
      markers.push({
        key: 'walk-NS-south',
        x: VIEW.centerX + crosswalkSpan - t * crosswalkSpan * 2,
        y: southY,
      })
    } else {
      // East crosswalk: walk south -> north. West crosswalk: north -> south.
      const westX = VIEW.centerX - VIEW.intersectionHalf - 19
      const eastX = VIEW.centerX + VIEW.intersectionHalf + 19
      markers.push({
        key: 'walk-EW-east',
        x: eastX,
        y: VIEW.centerY + crosswalkSpan - t * crosswalkSpan * 2,
      })
      markers.push({
        key: 'walk-EW-west',
        x: westX,
        y: VIEW.centerY - crosswalkSpan + t * crosswalkSpan * 2,
      })
    }
  }

  return markers
}

export default App
