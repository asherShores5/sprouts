/**
 * sprouts.test.js — Sprouts game test suite
 *
 * Run with: node --test sprouts.test.js
 *
 * ── Module-export shim pattern ──────────────────────────────────────────────
 * The game is delivered as a single HTML file with all JavaScript inlined in a
 * <script> block. To make the pure logic modules (GameState, Geometry,
 * Validator, etc.) testable in Node.js without a browser, each module uses the
 * following dual-export pattern:
 *
 *   // At the end of each module definition:
 *   if (typeof globalThis.modules === 'object') {
 *     // Node.js test environment: export to the shared `modules` object
 *     globalThis.modules.GameState = GameState;
 *   } else {
 *     // Browser environment: export to globalThis for cross-module access
 *     globalThis.GameState = GameState;
 *   }
 *
 * In this test file we set up `globalThis.modules = {}` before loading any
 * module code, then destructure the exports we need. This avoids `module.exports`
 * (which is CommonJS-only) and works cleanly with `"type": "module"`.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

// ── Load modules from sprouts.js ─────────────────────────────────────────
const src = readFileSync(new URL('./sprouts.js', import.meta.url), 'utf8');
globalThis.modules = {};
eval(src);
const { GameState, Geometry, Validator, GameController } = globalThis.modules;
// ─────────────────────────────────────────────────────────────────────────────

// Placeholder describe block — module tests will be added in subsequent tasks.
describe('Sprouts game', () => {
  it('test harness is operational', () => {
    assert.ok(true, 'node:test and fast-check are available');
  });
});

// ── GameState tests ──────────────────────────────────────────────────────────
describe('GameState', () => {
  // Feature: sprouts-game, Property 1: Initial spot count and connection invariant
  // Validates: Requirements 1.2, 1.4, 1.5
  it('Property 1: createInitialState(n) produces exactly n spots, all connections 0, all distinct positions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        (n) => {
          const state = GameState.createInitialState(n);

          // Exactly n spots
          assert.strictEqual(state.spots.length, n);

          // All connections are 0
          assert.ok(
            state.spots.every(s => s.connections === 0),
            'All spots should have connections === 0'
          );

          // All positions are distinct (no two spots share the same x,y)
          for (let i = 0; i < state.spots.length; i++) {
            for (let j = i + 1; j < state.spots.length; j++) {
              const a = state.spots[i];
              const b = state.spots[j];
              assert.ok(
                a.x !== b.x || a.y !== b.y,
                `Spots ${i} and ${j} share the same position`
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: sprouts-game, Property 2: Invalid spot count is rejected
  // Validates: Requirements 1.3
  it('Property 2: validateSpotCount(n) returns { valid: false } for any integer n outside [2, 8]', () => {
    fc.assert(
      fc.property(
        fc.integer().filter(n => n < 2 || n > 8),
        (n) => {
          const result = GameState.validateSpotCount(n);
          assert.strictEqual(result.valid, false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: sprouts-game, Property 11: Reset produces a clean initial state
  // Validates: Requirements 9.3
  it('Property 11: calling createInitialState(n) twice produces states with identical spot counts, all connections 0, and phase SETUP', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        (n) => {
          const state1 = GameState.createInitialState(n);
          const state2 = GameState.createInitialState(n);

          // Both have the same number of spots
          assert.strictEqual(state1.spots.length, state2.spots.length);

          // All connections are 0 in both states
          assert.ok(
            state1.spots.every(s => s.connections === 0),
            'First state: all spots should have connections === 0'
          );
          assert.ok(
            state2.spots.every(s => s.connections === 0),
            'Second state: all spots should have connections === 0'
          );

          // Both are in SETUP phase
          assert.strictEqual(state1.phase, 'SETUP');
          assert.strictEqual(state2.phase, 'SETUP');

          // Both have activePlayer 1
          assert.strictEqual(state1.activePlayer, 1);
          assert.strictEqual(state2.activePlayer, 1);

          // Both have empty curves
          assert.strictEqual(state1.curves.length, 0);
          assert.strictEqual(state2.curves.length, 0);

          // Both have null winner
          assert.strictEqual(state1.winner, null);
          assert.strictEqual(state2.winner, null);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Geometry tests ───────────────────────────────────────────────────────────
describe('Geometry', () => {
  const { segmentsIntersect, pointToSegmentDistance, polylineMidpoint } = Geometry;

  // ── segmentsIntersect unit tests ──────────────────────────────────────────

  it('segmentsIntersect: X-crossing segments return true', () => {
    // Diagonal cross: (-1,-1)→(1,1) and (-1,1)→(1,-1)
    assert.ok(
      segmentsIntersect({ x: -1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }),
      'X-crossing segments should intersect'
    );
  });

  it('segmentsIntersect: parallel non-overlapping segments return false', () => {
    // Two horizontal segments that do not overlap
    assert.ok(
      !segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }),
      'Parallel non-overlapping segments should not intersect'
    );
  });

  it('segmentsIntersect: T-intersection returns true', () => {
    // Horizontal segment (0,0)→(2,0) and vertical (1,-1)→(1,0) meeting at (1,0)
    assert.ok(
      segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: -1 }, { x: 1, y: 0 }),
      'T-intersection should intersect'
    );
  });

  it('segmentsIntersect: collinear overlapping segments return true', () => {
    // (0,0)→(2,0) and (1,0)→(3,0) overlap in [1,2]
    assert.ok(
      segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }),
      'Collinear overlapping segments should intersect'
    );
  });

  it('segmentsIntersect: collinear non-overlapping segments return false', () => {
    // (0,0)→(1,0) and (2,0)→(3,0) — collinear but no overlap
    assert.ok(
      !segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }),
      'Collinear non-overlapping segments should not intersect'
    );
  });

  it('segmentsIntersect: shared endpoint returns true', () => {
    // (0,0)→(1,1) and (1,1)→(2,0) share endpoint (1,1)
    assert.ok(
      segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }),
      'Segments sharing an endpoint should intersect'
    );
  });

  // ── pointToSegmentDistance unit tests ─────────────────────────────────────

  it('pointToSegmentDistance: point on segment interior returns 0', () => {
    // Midpoint of (0,0)→(4,0) is (2,0)
    const d = pointToSegmentDistance({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 });
    assert.ok(Math.abs(d) < 1e-10, `Expected 0, got ${d}`);
  });

  it('pointToSegmentDistance: point at endpoint returns 0', () => {
    const d = pointToSegmentDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 });
    assert.ok(Math.abs(d) < 1e-10, `Expected 0, got ${d}`);
  });

  it('pointToSegmentDistance: point perpendicular to segment interior', () => {
    // Point (2,3) perpendicular to segment (0,0)→(4,0): closest point is (2,0), distance = 3
    const d = pointToSegmentDistance({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 });
    assert.ok(Math.abs(d - 3) < 1e-10, `Expected 3, got ${d}`);
  });

  it('pointToSegmentDistance: degenerate segment (a === b) returns distance to a', () => {
    // Segment is a single point (1,1); distance from (4,5) = sqrt(9+16) = 5
    const d = pointToSegmentDistance({ x: 4, y: 5 }, { x: 1, y: 1 }, { x: 1, y: 1 });
    assert.ok(Math.abs(d - 5) < 1e-10, `Expected 5, got ${d}`);
  });

  // ── polylineMidpoint unit tests ───────────────────────────────────────────

  it('polylineMidpoint: two-point segment returns arithmetic mean', () => {
    const mid = polylineMidpoint([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    assert.ok(Math.abs(mid.x - 2) < 1e-10, `Expected x=2, got ${mid.x}`);
    assert.ok(Math.abs(mid.y - 0) < 1e-10, `Expected y=0, got ${mid.y}`);
  });

  it('polylineMidpoint: three-segment polyline with known lengths', () => {
    // Segments: (0,0)→(3,0) length 3, (3,0)→(3,4) length 4, (3,4)→(3,4+3) length 3
    // Total = 10, half = 5. First segment contributes 3, second starts at 3.
    // Need 2 more into the second segment (length 4): t = 2/4 = 0.5
    // Midpoint = (3, 0 + 0.5*4) = (3, 2)
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 3, y: 7 },
    ];
    const mid = polylineMidpoint(pts);
    assert.ok(Math.abs(mid.x - 3) < 1e-10, `Expected x=3, got ${mid.x}`);
    assert.ok(Math.abs(mid.y - 2) < 1e-10, `Expected y=2, got ${mid.y}`);
  });

  // ── Property 4: Crossing curves are detected ──────────────────────────────
  // Feature: sprouts-game, Property 4: Crossing curves are rejected
  // Validates: Requirements 3.4, 6.1, 6.2
  it('Property 4: segmentsIntersect returns true for any two segments that provably cross', () => {
    fc.assert(
      fc.property(
        // Generate a center point using integer coordinates to avoid float precision issues
        fc.record({
          cx: fc.integer({ min: -100, max: 100 }),
          cy: fc.integer({ min: -100, max: 100 }),
        }),
        // Generate two distinct angles for segment A (passes through center)
        // Use integer multiples of a small step to stay in 32-bit float range
        fc.integer({ min: 0, max: 62 }),   // angleA index: 0..62 → 0..6.2 radians
        fc.integer({ min: 2, max: 31 }),   // angleDiff index: 2..31 → 0.2..3.1 radians
        // Half-lengths for each segment (must be > 0)
        fc.integer({ min: 5, max: 50 }),
        fc.integer({ min: 5, max: 50 }),
        ({ cx, cy }, angleAIdx, angleDiffIdx, halfA, halfB) => {
          const angleA = angleAIdx * 0.1;
          const angleB = angleA + angleDiffIdx * 0.1; // guaranteed different from angleA

          // Segment A: passes through center at angle angleA
          const a1 = { x: cx + halfA * Math.cos(angleA), y: cy + halfA * Math.sin(angleA) };
          const a2 = { x: cx - halfA * Math.cos(angleA), y: cy - halfA * Math.sin(angleA) };

          // Segment B: passes through center at angle angleB
          const b1 = { x: cx + halfB * Math.cos(angleB), y: cy + halfB * Math.sin(angleB) };
          const b2 = { x: cx - halfB * Math.cos(angleB), y: cy - halfB * Math.sin(angleB) };

          assert.ok(
            segmentsIntersect(a1, a2, b1, b2),
            `Expected intersection for segments through center (${cx},${cy})`
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 9: polylineMidpoint bisects arc length ───────────────────────
  // Feature: sprouts-game, Property 9: New spot is placed at the polyline midpoint
  // Validates: Requirements 5.1
  it('Property 9: polylineMidpoint returns a point where cumulative arc length from start equals half total length', () => {
    fc.assert(
      fc.property(
        // Generate a polyline of 2–10 points with integer coordinates to avoid
        // floating-point precision issues in the test verification itself
        fc.array(
          fc.record({
            x: fc.integer({ min: -200, max: 200 }),
            y: fc.integer({ min: -200, max: 200 }),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        (points) => {
          // Compute total arc length
          let totalLength = 0;
          for (let i = 0; i < points.length - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            totalLength += Math.sqrt(dx * dx + dy * dy);
          }

          // Skip degenerate polylines where all points are the same
          if (totalLength < 1e-6) return;

          const mid = polylineMidpoint(points);
          const half = totalLength / 2;

          // Compute cumulative arc length from start to mid by finding which
          // segment the midpoint lies on
          let cumulative = 0;
          let distToMid = null;
          for (let i = 0; i < points.length - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            const segLen = Math.sqrt(dx * dx + dy * dy);

            if (segLen < 1e-12) {
              // Zero-length segment: skip
              continue;
            }

            // Project mid onto this segment
            const dmx = mid.x - points[i].x;
            const dmy = mid.y - points[i].y;
            const t = (dmx * dx + dmy * dy) / (segLen * segLen);

            if (t >= -1e-9 && t <= 1 + 1e-9) {
              const clampedT = Math.max(0, Math.min(1, t));
              const projX = points[i].x + clampedT * dx;
              const projY = points[i].y + clampedT * dy;
              const distFromLine = Math.sqrt((mid.x - projX) ** 2 + (mid.y - projY) ** 2);
              if (distFromLine < 1e-6) {
                distToMid = cumulative + clampedT * segLen;
                break;
              }
            }
            cumulative += segLen;
          }

          assert.ok(
            distToMid !== null,
            `Midpoint (${mid.x}, ${mid.y}) does not lie on any segment of the polyline`
          );

          // Use relative tolerance: allow 1e-9 relative error
          const tolerance = Math.max(1e-9, half * 1e-9);
          assert.ok(
            Math.abs(distToMid - half) <= tolerance,
            `Expected cumulative distance ${half}, got ${distToMid} (tolerance ${tolerance})`
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Validator tests ──────────────────────────────────────────────────────────
describe('Validator', () => {
  const { validateCurve, hasAnyValidMove } = Validator;

  // ── Helper: build a minimal game state ──────────────────────────────────

  /**
   * Build a minimal game state with given spots and curves.
   * @param {Array<{id:number,x:number,y:number,connections:number}>} spots
   * @param {Array<{id:number,points:Array<{x:number,y:number}>,startSpotId:number,endSpotId:number}>} curves
   * @returns {object}
   */
  function makeState(spots, curves = []) {
    return { phase: 'PLAYING', activePlayer: 1, spots, curves, winner: null };
  }

  // ── Unit test: T-intersection ────────────────────────────────────────────

  it('T-intersection: new curve crosses an existing curve → invalid', () => {
    // Existing curve: horizontal line from (0,100) to (200,100)
    const existingCurve = {
      id: 0,
      points: [{ x: 0, y: 100 }, { x: 200, y: 100 }],
      startSpotId: 0,
      endSpotId: 1,
    };
    const spots = [
      { id: 0, x: 0,   y: 100, connections: 1 },
      { id: 1, x: 200, y: 100, connections: 1 },
      { id: 2, x: 100, y: 0,   connections: 0 },
      { id: 3, x: 100, y: 200, connections: 0 },
    ];
    const state = makeState(spots, [existingCurve]);

    // New curve: vertical line from spot 2 (100,0) to spot 3 (100,200)
    // It crosses the existing horizontal curve at (100,100)
    // Use points well outside HIT_RADIUS of endpoints to avoid trimming
    const newCurve = [
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 100, y: 150 },
      { x: 100, y: 200 },
    ];

    const result = validateCurve(newCurve, 2, 3, state);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'Curve crosses an existing line');
  });

  // ── Unit test: Curve passes through an intermediate spot ─────────────────

  it('Curve passes through an intermediate spot → invalid', () => {
    // Spot at (100,100) is in the middle of the path
    const spots = [
      { id: 0, x: 0,   y: 100, connections: 0 },
      { id: 1, x: 200, y: 100, connections: 0 },
      { id: 2, x: 100, y: 100, connections: 0 }, // intermediate spot
    ];
    const state = makeState(spots, []);

    // New curve from spot 0 to spot 1, passing through (100,100) where spot 2 sits
    const newCurve = [
      { x: 0,   y: 100 },
      { x: 50,  y: 100 },
      { x: 100, y: 100 }, // passes through spot 2
      { x: 150, y: 100 },
      { x: 200, y: 100 },
    ];

    const result = validateCurve(newCurve, 0, 1, state);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'Curve passes through a spot');
  });

  // ── Unit test: Self-crossing loop ────────────────────────────────────────

  it('Self-crossing loop → invalid', () => {
    const spots = [
      { id: 0, x: 300, y: 300, connections: 0 },
    ];
    const state = makeState(spots, []);

    // A figure-8 shaped loop that crosses itself
    // Start at spot 0 (300,300), go out and cross back
    const newCurve = [
      { x: 300, y: 300 },
      { x: 350, y: 250 },
      { x: 400, y: 300 },
      { x: 350, y: 350 },
      { x: 300, y: 300 }, // back to start
      { x: 250, y: 250 }, // continues past start — creates crossing
      { x: 350, y: 250 }, // crosses the first segment
      { x: 300, y: 300 },
    ];

    const result = validateCurve(newCurve, 0, 0, state);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'Curve crosses itself');
  });

  // ── Unit test: Valid loop on a spot with connections === 1 ───────────────

  it('Valid loop on a spot with connections === 1 → valid', () => {
    const spots = [
      { id: 0, x: 300, y: 300, connections: 1 },
    ];
    const state = makeState(spots, []);

    // A clean circular loop around spot 0 — no self-crossing
    const R = 60;
    const cx = 300, cy = 300;
    const N = 16;
    const loopPoints = [];
    for (let i = 0; i <= N; i++) {
      const angle = (2 * Math.PI * i) / N;
      loopPoints.push({
        x: cx + R * Math.cos(angle),
        y: cy + R * Math.sin(angle),
      });
    }

    const result = validateCurve(loopPoints, 0, 0, state);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.reason, null);
  });

  // ── Unit test: hasAnyValidMove returns false for terminal position ────────

  it('hasAnyValidMove returns false when all spots are dead (connections === 3)', () => {
    const spots = [
      { id: 0, x: 100, y: 100, connections: 3 },
      { id: 1, x: 200, y: 100, connections: 3 },
      { id: 2, x: 150, y: 200, connections: 3 },
    ];
    const state = makeState(spots, []);
    assert.strictEqual(hasAnyValidMove(state), false);
  });

  // ── Property 5: Spot-through curves are rejected ─────────────────────────
  // Feature: sprouts-game, Property 5: Spot-through curves are rejected
  // Validates: Requirements 3.5, 6.3, 6.4
  it('Property 5: validateCurve returns { valid: false } for any curve whose interior passes within SPOT_RADIUS of an existing spot', () => {
    const SPOT_RADIUS = 10;

    fc.assert(
      fc.property(
        // Offset for the intermediate spot from the curve's midpoint
        fc.record({
          offsetX: fc.integer({ min: -5, max: 5 }),
          offsetY: fc.integer({ min: -5, max: 5 }),
        }),
        ({ offsetX, offsetY }) => {
          // Fixed geometry: curve goes from spot 0 (0,200) to spot 1 (400,200)
          // Spot 2 sits at (200 + offsetX, 200 + offsetY) — within SPOT_RADIUS of the midpoint
          const spotX = 200 + offsetX;
          const spotY = 200 + offsetY;

          const spots = [
            { id: 0, x: 0,   y: 200, connections: 0 },
            { id: 1, x: 400, y: 200, connections: 0 },
            { id: 2, x: spotX, y: spotY, connections: 0 }, // intermediate spot
          ];
          const state = makeState(spots, []);

          // Curve passes directly through (200, 200) — within SPOT_RADIUS of spot 2
          const newCurve = [
            { x: 0,   y: 200 },
            { x: 100, y: 200 },
            { x: 200, y: 200 }, // passes through/near spot 2
            { x: 300, y: 200 },
            { x: 400, y: 200 },
          ];

          // Verify spot 2 is actually within SPOT_RADIUS of the curve segment
          const dx = 200 - spotX;
          const dy = 200 - spotY;
          const distToLine = Math.sqrt(dx * dx + dy * dy);
          if (distToLine >= SPOT_RADIUS) return; // skip if not actually within radius

          const result = validateCurve(newCurve, 0, 1, state);
          assert.strictEqual(result.valid, false,
            `Expected invalid for spot at (${spotX},${spotY}) near curve`);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 8: Dead spots are never accepted as curve endpoints ──────────
  // Feature: sprouts-game, Property 8: Dead spots are never accepted as curve endpoints
  // Validates: Requirements 4.4, 4.5
  it('Property 8: validateCurve returns { valid: false } when start or end spot has connections === 3', () => {
    fc.assert(
      fc.property(
        // Which endpoint is dead: 'start', 'end', or 'both'
        fc.constantFrom('start', 'end', 'both'),
        // Position offsets for the two spots
        fc.record({
          x1: fc.integer({ min: 50, max: 150 }),
          y1: fc.integer({ min: 50, max: 150 }),
          x2: fc.integer({ min: 250, max: 350 }),
          y2: fc.integer({ min: 50, max: 150 }),
        }),
        (deadEnd, { x1, y1, x2, y2 }) => {
          const startConnections = (deadEnd === 'start' || deadEnd === 'both') ? 3 : 0;
          const endConnections   = (deadEnd === 'end'   || deadEnd === 'both') ? 3 : 0;

          const spots = [
            { id: 0, x: x1, y: y1, connections: startConnections },
            { id: 1, x: x2, y: y2, connections: endConnections },
          ];
          const state = makeState(spots, []);

          // Simple straight-line curve between the two spots
          const newCurve = [
            { x: x1, y: y1 },
            { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
            { x: x2, y: y2 },
          ];

          const result = validateCurve(newCurve, 0, 1, state);
          assert.strictEqual(result.valid, false,
            `Expected invalid when ${deadEnd} spot has connections === 3`);
          assert.strictEqual(result.reason, 'That spot is full');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── GameController.applyMove tests ──────────────────────────────────────────
describe('GameController.applyMove', () => {
  const { applyMove } = GameController;

  // ── Helper: build a minimal 2-spot game state ────────────────────────────

  /**
   * Build a minimal PLAYING state with two live spots far apart and no curves.
   * @param {1|2} activePlayer
   * @returns {object}
   */
  function makeTwoSpotState(activePlayer = 1) {
    return {
      phase: 'PLAYING',
      activePlayer,
      spots: [
        { id: 0, x: 100, y: 300, connections: 0 },
        { id: 1, x: 500, y: 300, connections: 0 },
      ],
      curves: [],
      winner: null,
    };
  }

  /**
   * Build a straight-line curve between two spots.
   * @param {number} id
   * @param {{x:number,y:number}} from
   * @param {{x:number,y:number}} to
   * @param {number} startSpotId
   * @param {number} endSpotId
   * @returns {object}
   */
  function makeCurve(id, from, to, startSpotId, endSpotId) {
    return {
      id,
      points: [from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to],
      startSpotId,
      endSpotId,
    };
  }

  // ── Property 3: Active player toggles after every valid move ──────────────
  // Feature: sprouts-game, Property 3: Active player toggles after every valid move
  // Validates: Requirements 2.2
  it('Property 3: activePlayer is the opposite after applyMove (unless game over)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 }),
        (initialPlayer) => {
          const state = makeTwoSpotState(initialPlayer);
          const playerBefore = state.activePlayer;

          const spotA = state.spots[0];
          const spotB = state.spots[1];
          const curve = makeCurve(0, { x: spotA.x, y: spotA.y }, { x: spotB.x, y: spotB.y }, spotA.id, spotB.id);

          applyMove(curve, spotA.id, spotB.id, state);

          if (state.phase !== 'GAME_OVER') {
            // Player must have toggled
            const expected = playerBefore === 1 ? 2 : 1;
            assert.strictEqual(state.activePlayer, expected,
              `Expected activePlayer to toggle from ${playerBefore} to ${expected}`);
          }
          // If game over, winner should be the player who just moved
          if (state.phase === 'GAME_OVER') {
            assert.strictEqual(state.winner, playerBefore,
              'Winner should be the player who made the last move');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 6: Connection counts are updated correctly ───────────────────
  // Feature: sprouts-game, Property 6: Connection counts are updated correctly after any move
  // Validates: Requirements 4.1, 4.2
  it('Property 6: connections increment correctly for distinct-endpoint moves and loops', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 }),
        fc.boolean(), // true = loop move, false = distinct endpoints
        (initialPlayer, isLoop) => {
          if (isLoop) {
            // Loop move: spot must have connections <= 1 to allow a loop
            const state = {
              phase: 'PLAYING',
              activePlayer: initialPlayer,
              spots: [
                { id: 0, x: 300, y: 300, connections: 0 },
                { id: 1, x: 600, y: 300, connections: 0 }, // second live spot so game doesn't end immediately
              ],
              curves: [],
              winner: null,
            };
            const spot = state.spots[0];
            const connBefore = spot.connections;

            // Build a circular loop around spot 0
            const R = 60;
            const N = 16;
            const loopPoints = [];
            for (let i = 0; i <= N; i++) {
              const angle = (2 * Math.PI * i) / N;
              loopPoints.push({
                x: spot.x + R * Math.cos(angle),
                y: spot.y + R * Math.sin(angle),
              });
            }
            const curve = { id: 0, points: loopPoints, startSpotId: spot.id, endSpotId: spot.id };

            applyMove(curve, spot.id, spot.id, state);

            const spotAfter = state.spots.find(s => s.id === spot.id);
            assert.strictEqual(spotAfter.connections, connBefore + 2,
              `Loop: expected connections to increase by 2 (from ${connBefore} to ${connBefore + 2})`);
          } else {
            // Distinct-endpoint move
            const state = makeTwoSpotState(initialPlayer);
            const spotA = state.spots[0];
            const spotB = state.spots[1];
            const connABefore = spotA.connections;
            const connBBefore = spotB.connections;

            const curve = makeCurve(0, { x: spotA.x, y: spotA.y }, { x: spotB.x, y: spotB.y }, spotA.id, spotB.id);
            applyMove(curve, spotA.id, spotB.id, state);

            const spotAAfter = state.spots.find(s => s.id === spotA.id);
            const spotBAfter = state.spots.find(s => s.id === spotB.id);
            assert.strictEqual(spotAAfter.connections, connABefore + 1,
              `Distinct: A.connections should increase by 1`);
            assert.strictEqual(spotBAfter.connections, connBBefore + 1,
              `Distinct: B.connections should increase by 1`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 7: New spot always starts with exactly 2 connections ─────────
  // Feature: sprouts-game, Property 7: New spot always starts with exactly 2 connections
  // Validates: Requirements 4.3, 5.3
  it('Property 7: newly placed spot has connections === 2 after any valid move', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 }),
        fc.boolean(), // true = loop, false = distinct
        (initialPlayer, isLoop) => {
          let state;
          let curve;
          let startId, endId;

          if (isLoop) {
            state = {
              phase: 'PLAYING',
              activePlayer: initialPlayer,
              spots: [
                { id: 0, x: 300, y: 300, connections: 0 },
                { id: 1, x: 600, y: 300, connections: 0 },
              ],
              curves: [],
              winner: null,
            };
            const spot = state.spots[0];
            const R = 60;
            const N = 16;
            const loopPoints = [];
            for (let i = 0; i <= N; i++) {
              const angle = (2 * Math.PI * i) / N;
              loopPoints.push({
                x: spot.x + R * Math.cos(angle),
                y: spot.y + R * Math.sin(angle),
              });
            }
            curve = { id: 0, points: loopPoints, startSpotId: spot.id, endSpotId: spot.id };
            startId = spot.id;
            endId = spot.id;
          } else {
            state = makeTwoSpotState(initialPlayer);
            const spotA = state.spots[0];
            const spotB = state.spots[1];
            curve = makeCurve(0, { x: spotA.x, y: spotA.y }, { x: spotB.x, y: spotB.y }, spotA.id, spotB.id);
            startId = spotA.id;
            endId = spotB.id;
          }

          const spotCountBefore = state.spots.length;
          applyMove(curve, startId, endId, state);

          // A new spot should have been added
          assert.strictEqual(state.spots.length, spotCountBefore + 1,
            'Expected exactly one new spot to be added');

          // The new spot is the last one appended
          const newSpot = state.spots[state.spots.length - 1];
          assert.strictEqual(newSpot.connections, 2,
            `New spot should have connections === 2, got ${newSpot.connections}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 10 (unit test): Game-over winner is the last mover ───────────
  // Feature: sprouts-game, Property 10: Game-over winner is the last mover
  // Validates: Requirements 7.1, 7.3, 7.4
  it('Property 10 (unit): winner equals activePlayer when the final move causes game over', () => {
    // Build a terminal position: two spots, each with connections === 2.
    // After one more move connecting them, both reach connections === 3 (dead),
    // and the new spot placed at the midpoint starts with connections === 2.
    // With only one live spot (the new midpoint spot) and no room for a loop
    // (connections === 2, so a loop would push it to 4 > 3), the game is over.
    //
    // We place the two spots very close together with existing curves blocking
    // all paths, so hasAnyValidMove returns false after the move.
    //
    // Simpler approach: use spots with connections === 2 and surround the
    // resulting new spot with curves so no valid move remains.
    //
    // Easiest deterministic terminal: 2 spots each at connections=2, connected
    // by a straight line. After the move both are dead (connections=3), and the
    // new spot has connections=2. The new spot can potentially draw a loop
    // (connections=2 → loop would add 2 → connections=4, which exceeds 3, so
    // actually a loop is NOT valid since it would require connections <= 1).
    // Wait: hasAnyValidMove checks connections <= 1 for loops. The new spot has
    // connections=2, so no loop. And there are no other live spots to connect to
    // (the original two are now dead). So hasAnyValidMove returns false → GAME_OVER.

    const activePlayerBefore = 1;
    const state = {
      phase: 'PLAYING',
      activePlayer: activePlayerBefore,
      spots: [
        { id: 0, x: 100, y: 300, connections: 2 },
        { id: 1, x: 500, y: 300, connections: 2 },
      ],
      curves: [],
      winner: null,
    };

    const spotA = state.spots[0];
    const spotB = state.spots[1];
    const curve = makeCurve(0, { x: spotA.x, y: spotA.y }, { x: spotB.x, y: spotB.y }, spotA.id, spotB.id);

    applyMove(curve, spotA.id, spotB.id, state);

    assert.strictEqual(state.phase, 'GAME_OVER',
      'Expected phase to be GAME_OVER after the final move');
    assert.strictEqual(state.winner, activePlayerBefore,
      `Expected winner to be player ${activePlayerBefore} (the one who made the last move)`);
  });
});
