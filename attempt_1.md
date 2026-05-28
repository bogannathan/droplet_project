Plan: React Traffic Intersection Simulator
Build a single-page Vite + React app using a deterministic finite-state machine (FSM) to control NS/EW straight and protected-left phases, with dynamic car simulation and pedestrian walk requests. Use a hybrid UI: a responsive SVG intersection map for spatial state (cars, lanes, signals) plus a side control/status panel for timing, queued demand, and walk requests. The FSM enforces: straight yellow -> straight red -> 1s all-red clearance -> protected-left green, with configurable minimum green windows (priority-aware switching) and walk servicing mapped to the parallel vehicle direction.

Steps

Phase 1 - Project skeleton and configuration

Initialize Vite with latest React (no router, no extra libraries) and keep app single-page.

Define central timing constants and simulation constants in one module: straight minimum green (20s), left minimum green (10s), yellow (3s), all-red (1s), walk window (10s), tick rate, spawn rates.

Set initial priority direction (NS by default unless changed in constants).

Phase 2 - Domain model and FSM core (blocks all rendering work)

Define canonical state slices: signal state, transition state, direction demand, pedestrian requests, cars, and simulation clock.

Implement FSM states for each direction: STRAIGHT_GREEN, STRAIGHT_YELLOW, ALL_RED_AFTER_STRAIGHT, LEFT_GREEN, LEFT_YELLOW, ALL_RED_AFTER_LEFT.

Encode hard safety rule: when left-turn signal is green/yellow/or in <1s post-red clearance, straight for that direction remains red.

Encode required transition order: straight green -> straight yellow -> straight red -> 1s all-red -> left green.

Add a deterministic transition evaluator called on every tick that computes next phase from elapsed time + demand + pedestrian request state.

Phase 3 - Priority and demand scheduling

Implement direction priority policy:

Priority direction remains active after non-priority minimum is met, unless non-priority has stopped demand and priority minimum has also elapsed.

Non-priority can take control once it has waiting demand and current active direction has satisfied minimum hold.

Alternate fairly on ties to avoid starvation.

Track stopped demand separately per direction and movement type (straight, left).

Define movement eligibility matrix per phase to determine which queues can discharge.

Phase 4 - Pedestrian walk-button logic

Add walk request button for each crossing axis: cross NS and cross EW.

Map walk request to parallel vehicle straight phase as specified:

Crossing NS is served during EW straight green.

Crossing EW is served during NS straight green.

Hold walk active for 10s once granted; preserve pending requests until serviced.

Ensure requests are serviced only when safe (during appropriate straight phase, not during all-red/left-only windows).

Phase 5 - Car simulation engine

Use free-moving cars model (selected): cars spawn per direction/lane with randomized intervals and assigned intent (straight/left/right where modeled).

Represent each car with id, approach, lane, intent, position, velocity, and state (approaching, queued, crossing, exited).

On each tick: spawn cars, advance positions, enforce stop-line behavior on red/yellow, release cars on allowed green phases, and remove exited cars.

Keep spacing constraints simple (minimum following distance per lane) to avoid overlap.

Phase 6 - Hybrid UI (Option 4)

Build responsive SVG intersection map:

Four approaches each with 4 lanes (left, straight A, straight B, right).

Draw per-lane signal heads and dedicated left-turn signal indicators (red/yellow/green/flashing orange support).

Render moving cars from simulation state in each approach and through intersection center.

Build side panel showing: active phase, countdown, priority direction, queue counts by approach/lane, walk request status, and controls.

Add walk buttons in panel and optional quick controls (pause/resume, speed 1x/2x for debugging).

Phase 7 - Integration and polish

Wire one simulation tick loop (requestAnimationFrame + fixed-step accumulator or fixed interval) so FSM and cars update consistently.

Add responsive layout breakpoints: side-by-side on desktop, stacked panel under map on mobile.

Add subtle but clear visual polish: lane markings, directional labels, color-legible signal states, and smooth motion transitions.

Relevant files

New Vite React app files to be created during implementation; no existing source files currently present in workspace.
Verification

Automated logic checks (unit tests or reducer tests): verify transition order and safety invariants, including straight->yellow->red->1s->left sequence.
Priority behavior test: with continuous demand on both sides, confirm non-priority gets minimum service and priority regains control according to rules.
Pedestrian tests: press cross NS and confirm service appears only during EW straight green with 10s walk window; same for cross EW/NS.
Visual/manual test: confirm each of four approaches shows 4 lanes, correct lane signal state, and visible car movement/stopping by light state.
Timing verification: log phase timestamps and ensure configured minima are respected.
Decisions

Stack: Vite + latest React, single-page app, no router/extras.
UI approach: Option 4 hybrid (SVG map + status/control panel).
Selected timings: yellow 3s, all-red 1s, walk 10s, min green straight 20s, min green left 10s.
Car model: free-moving cars with simple spacing constraints.
Included scope: one intersection with directional priority, protected-left coordination, walk requests, responsive UI.
Excluded scope: networking/backend persistence, multi-intersection coordination, advanced vehicle pathfinding.
Further Considerations

Flashing orange left-arrow behavior can be included as a later enhancement for permissive-left mode outside protected-left windows.
If simulation feels too busy, expose arrival rates in UI controls for demo tuning.
If deterministic replay is needed, add seeded randomness for arrivals.