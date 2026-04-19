// ── GameState module ─────────────────────────────────────────────────────
// Pure data model: spots, curves, turn, phase.
// Mutated only by GameController.
// ────────────────────────────────────────────────────────────────────────

(function () {
  let _nextSpotId = 0;

  function validateSpotCount(n) {
    if (!Number.isInteger(n) || n < 2 || n > 8) {
      return { valid: false, error: 'Number of spots must be an integer between 2 and 8.' };
    }
    return { valid: true, error: null };
  }

  function createInitialState(n, canvasWidth = 600, canvasHeight = 600) {
    _nextSpotId = 0;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const radius = Math.min(canvasWidth, canvasHeight) * 0.35;
    const spots = [];
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      spots.push({
        id: _nextSpotId++,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        connections: 0,
      });
    }
    return { phase: 'SETUP', activePlayer: 1, spots, curves: [], winner: null, initialSpotCount: n };
  }

  function addCurve(state, curve)              { state.curves.push(curve); return state; }
  function addSpot(state, spot)                { state.spots.push(spot);   return state; }
  function setPhase(state, phase)              { state.phase = phase;      return state; }
  function setWinner(state, player)            { state.winner = player;    return state; }
  function togglePlayer(state)                 { state.activePlayer = state.activePlayer === 1 ? 2 : 1; return state; }

  function incrementConnections(state, spotId, delta) {
    const spot = state.spots.find(s => s.id === spotId);
    if (spot) spot.connections += delta;
    return state;
  }

  const GameState = { createInitialState, addCurve, addSpot, incrementConnections, setPhase, setWinner, togglePlayer, validateSpotCount };

  if (typeof globalThis.modules === 'object') {
    globalThis.modules.GameState = GameState;
  } else {
    globalThis.GameState = GameState;
  }
})();

// ── Geometry module ──────────────────────────────────────────────────────
// Pure stateless math utilities.
// ────────────────────────────────────────────────────────────────────────

(function () {
  function cross(u, v) { return u.x * v.y - u.y * v.x; }

  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }

  function onSegment(p, a, b) {
    return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
           Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
  }

  function segmentsIntersect(a1, a2, b1, b2) {
    const b2b1 = { x: b2.x - b1.x, y: b2.y - b1.y };
    const a2a1 = { x: a2.x - a1.x, y: a2.y - a1.y };
    const d1 = cross(b2b1, { x: a1.x - b1.x, y: a1.y - b1.y });
    const d2 = cross(b2b1, { x: a2.x - b1.x, y: a2.y - b1.y });
    const d3 = cross(a2a1, { x: b1.x - a1.x, y: b1.y - a1.y });
    const d4 = cross(a2a1, { x: b2.x - a1.x, y: b2.y - a1.y });
    if (sign(d1) !== sign(d2) && sign(d3) !== sign(d4)) return true;
    if (d1 === 0 && onSegment(a1, b1, b2)) return true;
    if (d2 === 0 && onSegment(a2, b1, b2)) return true;
    if (d3 === 0 && onSegment(b1, a1, a2)) return true;
    if (d4 === 0 && onSegment(b2, a1, a2)) return true;
    return false;
  }

  function pointToSegmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex = p.x - a.x, ey = p.y - a.y;
      return Math.sqrt(ex * ex + ey * ey);
    }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const fx = p.x - (a.x + t * dx), fy = p.y - (a.y + t * dy);
    return Math.sqrt(fx * fx + fy * fy);
  }

  function polylineMidpoint(points) {
    const lengths = [];
    let totalLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x, dy = points[i + 1].y - points[i].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      lengths.push(len);
      totalLength += len;
    }
    const half = totalLength / 2;
    let cumulative = 0;
    for (let i = 0; i < lengths.length; i++) {
      const segLen = lengths[i];
      if (cumulative + segLen >= half) {
        const t = segLen === 0 ? 0 : (half - cumulative) / segLen;
        return {
          x: points[i].x + t * (points[i + 1].x - points[i].x),
          y: points[i].y + t * (points[i + 1].y - points[i].y),
        };
      }
      cumulative += segLen;
    }
    return { x: points[points.length - 1].x, y: points[points.length - 1].y };
  }

  const Geometry = { cross, segmentsIntersect, pointToSegmentDistance, polylineMidpoint };

  if (typeof globalThis.modules === 'object') {
    globalThis.modules.Geometry = Geometry;
  } else {
    globalThis.Geometry = Geometry;
  }
})();

// ── Validator module ─────────────────────────────────────────────────────
// Move validation, crossing detection, game-over detection.
// ────────────────────────────────────────────────────────────────────────

(function () {
  const HIT_RADIUS = 20;
  const SPOT_RADIUS = 10;

  function trimCurve(newCurve, startSpot, endSpot) {
    function dist(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    let startIdx = 0;
    while (startIdx < newCurve.length - 1 && dist(newCurve[startIdx], startSpot) < HIT_RADIUS) startIdx++;
    let endIdx = newCurve.length - 1;
    while (endIdx > startIdx && dist(newCurve[endIdx], endSpot) < HIT_RADIUS) endIdx--;
    return newCurve.slice(startIdx, endIdx + 1);
  }

  function validateCurve(newCurve, startSpotId, endSpotId, gameState) {
    const { segmentsIntersect, pointToSegmentDistance } = globalThis.modules
      ? globalThis.modules.Geometry : globalThis.Geometry;

    const startSpot = gameState.spots.find(s => s.id === startSpotId);
    const endSpot   = gameState.spots.find(s => s.id === endSpotId);

    if (!startSpot || !endSpot) return { valid: false, reason: 'Spot not found' };
    if (startSpot.connections >= 3 || endSpot.connections >= 3) return { valid: false, reason: 'That spot is full' };
    if (startSpotId === endSpotId && startSpot.connections >= 2) return { valid: false, reason: 'That spot is full' };

    const trimmed = trimCurve(newCurve, startSpot, endSpot);

    for (let i = 0; i < trimmed.length - 1; i++) {
      const p1 = trimmed[i], p2 = trimmed[i + 1];
      for (const curve of gameState.curves) {
        const pts = curve.points;
        for (let j = 0; j < pts.length - 1; j++) {
          if (segmentsIntersect(p1, p2, pts[j], pts[j + 1])) return { valid: false, reason: 'Curve crosses an existing line' };
        }
      }
    }

    for (const spot of gameState.spots) {
      if (spot.id === startSpotId || spot.id === endSpotId) continue;
      for (let i = 0; i < trimmed.length - 1; i++) {
        if (pointToSegmentDistance(spot, trimmed[i], trimmed[i + 1]) < SPOT_RADIUS) return { valid: false, reason: 'Curve passes through a spot' };
      }
    }

    if (startSpotId === endSpotId) {
      const pts = newCurve;
      const lastSeg = pts.length - 2;
      for (let i = 0; i < pts.length - 1; i++) {
        for (let j = i + 2; j < pts.length - 1; j++) {
          if (i === 0 && j === lastSeg) continue;
          if (segmentsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) return { valid: false, reason: 'Curve crosses itself' };
        }
      }
    }

    return { valid: true, reason: null };
  }

  function probePathClear(points, excludeStartId, excludeEndId, gameState) {
    const { segmentsIntersect, pointToSegmentDistance } = globalThis.modules
      ? globalThis.modules.Geometry : globalThis.Geometry;

    const startSpot = gameState.spots.find(s => s.id === excludeStartId);
    const endSpot   = gameState.spots.find(s => s.id === excludeEndId);

    function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

    let startIdx = 0, endIdx = points.length - 1;
    if (startSpot) while (startIdx < points.length - 1 && dist(points[startIdx], startSpot) < HIT_RADIUS) startIdx++;
    if (endSpot)   while (endIdx > startIdx && dist(points[endIdx], endSpot) < HIT_RADIUS) endIdx--;
    const trimmed = points.slice(startIdx, endIdx + 1);
    if (trimmed.length < 2) return true;

    for (let i = 0; i < trimmed.length - 1; i++) {
      const p1 = trimmed[i], p2 = trimmed[i + 1];
      for (const curve of gameState.curves) {
        const pts = curve.points;
        for (let j = 0; j < pts.length - 1; j++) {
          if (segmentsIntersect(p1, p2, pts[j], pts[j + 1])) return false;
        }
      }
    }

    for (const spot of gameState.spots) {
      if (spot.id === excludeStartId || spot.id === excludeEndId) continue;
      for (let i = 0; i < trimmed.length - 1; i++) {
        if (pointToSegmentDistance(spot, trimmed[i], trimmed[i + 1]) < SPOT_RADIUS) return false;
      }
    }

    return true;
  }

  function generateProbes(A, B) {
    const probes = [];
    const N = 16;
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const offset = HIT_RADIUS + 2;
    const As = { x: A.x + ux * offset, y: A.y + uy * offset };
    const Bs = { x: B.x - ux * offset, y: B.y - uy * offset };

    if (len <= offset * 2) { probes.push([As, Bs]); return probes; }

    const mx = (As.x + Bs.x) / 2, my = (As.y + Bs.y) / 2;
    const segLen = Math.sqrt((Bs.x - As.x) ** 2 + (Bs.y - As.y) ** 2) || 1;

    probes.push([{ x: As.x, y: As.y }, { x: Bs.x, y: Bs.y }]);

    for (const bulge of [0.3, -0.3, 0.6, -0.6, 1.0, -1.0]) {
      const arc = [];
      const cpx = mx + px * segLen * bulge, cpy = my + py * segLen * bulge;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        arc.push({
          x: (1 - t) * (1 - t) * As.x + 2 * (1 - t) * t * cpx + t * t * Bs.x,
          y: (1 - t) * (1 - t) * As.y + 2 * (1 - t) * t * cpy + t * t * Bs.y,
        });
      }
      probes.push(arc);
    }

    return probes;
  }

  function hasAnyValidMove(gameState) {
    const liveSpots = gameState.spots.filter(s => s.connections < 3);
    if (liveSpots.length === 0) return false;

    for (const spot of liveSpots) {
      if (spot.connections <= 1) {
        for (const radius of [HIT_RADIUS + 5, 50, 80, 120]) {
          const arc = [];
          const N = 16;
          for (let i = 0; i <= N; i++) {
            const angle = (2 * Math.PI * i) / N;
            arc.push({ x: spot.x + radius * Math.cos(angle), y: spot.y + radius * Math.sin(angle) });
          }
          if (probePathClear(arc, spot.id, spot.id, gameState)) return true;
        }
      }
    }

    for (let i = 0; i < liveSpots.length; i++) {
      for (let j = i + 1; j < liveSpots.length; j++) {
        const probes = generateProbes(liveSpots[i], liveSpots[j]);
        for (const probe of probes) {
          if (probePathClear(probe, liveSpots[i].id, liveSpots[j].id, gameState)) return true;
        }
      }
    }

    return false;
  }

  const Validator = { validateCurve, hasAnyValidMove };

  if (typeof globalThis.modules === 'object') {
    globalThis.modules.Validator = Validator;
  } else {
    globalThis.Validator = Validator;
  }
})();

// ── Renderer module ──────────────────────────────────────────────────────
// Canvas drawing: curves, in-progress curve, spots with labels.
// ────────────────────────────────────────────────────────────────────────

(function () {
  const SPOT_RADIUS = 10;
  const LINE_WIDTH = 2.5;

  function resizeCanvas(canvas, container) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = container.clientWidth  * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.getContext('2d').scale(dpr, dpr);
    return dpr;
  }

  function render(gameState, drawingState, canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr, h = canvas.height / dpr;

    ctx.clearRect(0, 0, w, h);
    if (!gameState || !gameState.spots) return;

    // Completed curves
    ctx.save();
    ctx.strokeStyle = '#7eb8d4';
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const curve of gameState.curves) {
      if (!curve.points || curve.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(curve.points[0].x, curve.points[0].y);
      for (let i = 1; i < curve.points.length; i++) ctx.lineTo(curve.points[i].x, curve.points[i].y);
      ctx.stroke();
    }
    ctx.restore();

    // In-progress curve
    if (drawingState && drawingState.active && drawingState.points.length >= 2) {
      ctx.save();
      ctx.strokeStyle = '#a8d4e8';
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(drawingState.points[0].x, drawingState.points[0].y);
      for (let i = 1; i < drawingState.points.length; i++) ctx.lineTo(drawingState.points[i].x, drawingState.points[i].y);
      ctx.stroke();
      ctx.restore();
    }

    // Spots
    for (const spot of gameState.spots) {
      const isDead = spot.connections >= 3;
      const isStartSpot = drawingState && drawingState.active && drawingState.startSpotId === spot.id;
      const freeConns = 3 - spot.connections;

      ctx.save();

      if (isStartSpot) {
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, SPOT_RADIUS + 6, 0, 2 * Math.PI);
        ctx.strokeStyle = '#e8edf2';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(spot.x, spot.y, SPOT_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = isDead ? '#1e3a5f' : '#a8d4e8';
      ctx.fill();
      ctx.strokeStyle = isDead ? '#2a4f7a' : '#4a7fa5';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = `bold ${SPOT_RADIUS - 1}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDead ? '#4a7fa5' : '#0d1b2a';
      ctx.fillText(String(freeConns), spot.x, spot.y + 0.5);

      ctx.restore();
    }
  }

  const Renderer = { render, resizeCanvas };

  if (typeof globalThis.modules === 'object') {
    globalThis.modules.Renderer = Renderer;
  } else {
    globalThis.Renderer = Renderer;
  }
})();

// ── InputHandler module ──────────────────────────────────────────────────
// Unified mouse + touch event adapter.
// ────────────────────────────────────────────────────────────────────────

(function () {
  function getCanvasCoords(clientX, clientY, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function attach(canvas, controller) {
    canvas.addEventListener('mousedown',  (e) => { const {x,y} = getCanvasCoords(e.clientX, e.clientY, canvas); controller.handlePointerDown(x, y); });
    canvas.addEventListener('mousemove',  (e) => { const {x,y} = getCanvasCoords(e.clientX, e.clientY, canvas); controller.handlePointerMove(x, y); });
    canvas.addEventListener('mouseup',    (e) => { const {x,y} = getCanvasCoords(e.clientX, e.clientY, canvas); controller.handlePointerUp(x, y); });
    canvas.addEventListener('mouseleave', ()  => { controller.handlePointerCancel(); });

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const {x,y} = getCanvasCoords(e.touches[0].clientX, e.touches[0].clientY, canvas);
      controller.handlePointerDown(x, y);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const {x,y} = getCanvasCoords(e.touches[0].clientX, e.touches[0].clientY, canvas);
      controller.handlePointerMove(x, y);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const {x,y} = getCanvasCoords(e.changedTouches[0].clientX, e.changedTouches[0].clientY, canvas);
      controller.handlePointerUp(x, y);
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => { controller.handlePointerCancel(); });
  }

  const InputHandler = { attach, getCanvasCoords };

  if (typeof globalThis.modules === 'object') {
    globalThis.modules.InputHandler = InputHandler;
  } else {
    globalThis.InputHandler = InputHandler;
  }
})();

// ── GameController module ────────────────────────────────────────────────
// Full state machine: SETUP → PLAYING → DRAWING → PLAYING → GAME_OVER.
// ────────────────────────────────────────────────────────────────────────

(function () {
  const HIT_RADIUS = 20;
  let _state = null;
  let _drawingState = { active: false, startSpotId: null, points: [] };
  let _canvas = null;
  let _nextCurveId = 0;
  let _moveCount = 0;
  let _undoStack = [];

  function _getModules() {
    const src = globalThis.modules || globalThis;
    return { Geometry: src.Geometry, Validator: src.Validator, GameState: src.GameState, Renderer: src.Renderer, UI: src.UI };
  }

  function _hitTestSpot(x, y, spots) {
    for (const spot of spots) {
      const dx = x - spot.x, dy = y - spot.y;
      if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) return spot;
    }
    return null;
  }

  function startGame(n) {
    const { GameState, Renderer, UI } = _getModules();
    const validation = GameState.validateSpotCount(n);
    if (!validation.valid) { UI.showStartError(validation.error); return; }
    const w = _canvas ? _canvas.getBoundingClientRect().width  : 600;
    const h = _canvas ? _canvas.getBoundingClientRect().height : 600;
    _state = GameState.createInitialState(n, w, h);
    _state.phase = 'PLAYING';
    _drawingState = { active: false, startSpotId: null, points: [] };
    _nextCurveId = 0;
    _moveCount = 0;
    _undoStack = [];
    UI.showGame();
    UI.updateStatus(_state.activePlayer, _state.phase, _moveCount);
    Renderer.render(_state, _drawingState, _canvas);
  }

  function handlePointerDown(x, y) {
    if (!_state || _state.phase !== 'PLAYING') return;
    const spot = _hitTestSpot(x, y, _state.spots);
    if (!spot) return;
    if (spot.connections >= 3) { _getModules().UI.showToast('That spot is full'); return; }
    _drawingState = { active: true, startSpotId: spot.id, points: [{ x, y }] };
    _state.phase = 'DRAWING';
  }

  function handlePointerMove(x, y) {
    if (!_state || _state.phase !== 'DRAWING' || !_drawingState.active) return;
    _drawingState.points.push({ x, y });
    _getModules().Renderer.render(_state, _drawingState, _canvas);
  }

  function handlePointerUp(x, y) {
    if (!_state || _state.phase !== 'DRAWING' || !_drawingState.active) return;
    const { Validator, Renderer, UI } = _getModules();

    _drawingState.points.push({ x, y });
    const endSpot = _hitTestSpot(x, y, _state.spots);

    function discard() {
      _drawingState = { active: false, startSpotId: null, points: [] };
      _state.phase = 'PLAYING';
      Renderer.render(_state, _drawingState, _canvas);
    }

    if (!endSpot) { discard(); return; }
    if (endSpot.connections >= 3) { UI.showToast('That spot is full'); discard(); return; }

    const curve = {
      id: _nextCurveId++,
      points: [..._drawingState.points],
      startSpotId: _drawingState.startSpotId,
      endSpotId: endSpot.id,
    };

    // Require minimum arc length to prevent click-on-spot spawning a dot
    const MIN_CURVE_LENGTH = HIT_RADIUS * 2;
    let curveLength = 0;
    for (let i = 0; i < curve.points.length - 1; i++) {
      const dx = curve.points[i + 1].x - curve.points[i].x;
      const dy = curve.points[i + 1].y - curve.points[i].y;
      curveLength += Math.sqrt(dx * dx + dy * dy);
    }
    if (curveLength < MIN_CURVE_LENGTH) { discard(); return; }

    const result = Validator.validateCurve(curve.points, curve.startSpotId, curve.endSpotId, _state);
    if (!result.valid) { UI.showToast(result.reason || 'Invalid move'); discard(); return; }

    _applyMove(curve, curve.startSpotId, curve.endSpotId);
  }

  function handlePointerCancel() {
    if (!_state || _state.phase !== 'DRAWING') return;
    _drawingState = { active: false, startSpotId: null, points: [] };
    _state.phase = 'PLAYING';
    _getModules().Renderer.render(_state, _drawingState, _canvas);
  }

  function _applyMove(curve, startSpotId, endSpotId) {
    const { Geometry, Validator, Renderer, UI } = _getModules();
    const isLoop = startSpotId === endSpotId;

    _undoStack.push(JSON.parse(JSON.stringify(_state)));

    _state.curves.push(curve);

    const startSpot = _state.spots.find(s => s.id === startSpotId);
    if (startSpot) startSpot.connections += isLoop ? 2 : 1;

    if (!isLoop) {
      const endSpot = _state.spots.find(s => s.id === endSpotId);
      if (endSpot) endSpot.connections += 1;
    }

    const mid = Geometry.polylineMidpoint(curve.points);
    const newId = Math.max(..._state.spots.map(s => s.id)) + 1;
    _state.spots.push({ id: newId, x: mid.x, y: mid.y, connections: 2 });

    _moveCount++;

    if (!Validator.hasAnyValidMove(_state)) {
      _state.phase = 'GAME_OVER';
      _state.winner = _state.activePlayer;
      _drawingState = { active: false, startSpotId: null, points: [] };
      Renderer.render(_state, _drawingState, _canvas);
      UI.showGameOver(_state.winner, _moveCount);
    } else {
      _state.activePlayer = _state.activePlayer === 1 ? 2 : 1;
      _state.phase = 'PLAYING';
      _drawingState = { active: false, startSpotId: null, points: [] };
      Renderer.render(_state, _drawingState, _canvas);
      UI.updateStatus(_state.activePlayer, _state.phase, _moveCount);
    }
  }

  function newGame() {
    _state = null;
    _drawingState = { active: false, startSpotId: null, points: [] };
    _moveCount = 0;
    _undoStack = [];
    const { UI, Renderer } = _getModules();
    if (_canvas) Renderer.render(null, _drawingState, _canvas);
    UI.showStartScreen();
  }

  function undo() {
    if (_undoStack.length === 0) return;
    _state = _undoStack.pop();
    _state.phase = 'PLAYING';
    _moveCount = Math.max(0, _moveCount - 1);
    _drawingState = { active: false, startSpotId: null, points: [] };
    const { Renderer, UI } = _getModules();
    Renderer.render(_state, _drawingState, _canvas);
    UI.updateStatus(_state.activePlayer, _state.phase, _moveCount);
  }

  function setCanvas(canvas) { _canvas = canvas; }
  function getState()        { return _state; }
  function getDrawingState() { return _drawingState; }

  // Exposed for tests — operates on a provided state object
  function applyMove(curve, startSpotId, endSpotId, state) {
    const Geometry  = (globalThis.modules || globalThis).Geometry;
    const Validator = (globalThis.modules || globalThis).Validator;
    const GameState = (globalThis.modules || globalThis).GameState;
    const isLoop = startSpotId === endSpotId;
    state.curves.push(curve);
    const startSpot = state.spots.find(s => s.id === startSpotId);
    if (startSpot) startSpot.connections += isLoop ? 2 : 1;
    if (!isLoop) {
      const endSpot = state.spots.find(s => s.id === endSpotId);
      if (endSpot) endSpot.connections += 1;
    }
    const mid = Geometry.polylineMidpoint(curve.points);
    const newId = Math.max(...state.spots.map(s => s.id)) + 1;
    state.spots.push({ id: newId, x: mid.x, y: mid.y, connections: 2 });
    if (!Validator.hasAnyValidMove(state)) {
      GameState.setPhase(state, 'GAME_OVER');
      GameState.setWinner(state, state.activePlayer);
    } else {
      GameState.togglePlayer(state);
      GameState.setPhase(state, 'PLAYING');
    }
    return state;
  }

  const GameController = {
    startGame, handlePointerDown, handlePointerMove, handlePointerUp,
    handlePointerCancel, newGame, undo, setCanvas, getState, getDrawingState, applyMove,
  };

  if (typeof globalThis.modules === 'object') {
    globalThis.modules.GameController = GameController;
  } else {
    globalThis.GameController = GameController;
  }
})();

// ── UI module ────────────────────────────────────────────────────────────
// DOM state transitions: screens, status bar, toasts, rules modal.
// ────────────────────────────────────────────────────────────────────────

(function () {
  function showStartScreen() {
    const startScreen    = document.getElementById('startScreen');
    const gameOverOverlay = document.getElementById('gameOverOverlay');
    const statusBar      = document.getElementById('statusBar');
    if (startScreen)     startScreen.classList.remove('hidden');
    if (gameOverOverlay) gameOverOverlay.classList.add('hidden');
    if (statusBar)       statusBar.classList.add('hidden');
    const errorEl = document.getElementById('startError');
    if (errorEl) errorEl.textContent = '';
  }

  function showGame() {
    const startScreen = document.getElementById('startScreen');
    const statusBar   = document.getElementById('statusBar');
    if (startScreen) startScreen.classList.add('hidden');
    if (statusBar)   statusBar.classList.remove('hidden');
  }

  function showStartError(msg) {
    const errorEl = document.getElementById('startError');
    if (errorEl) errorEl.textContent = msg || 'Invalid number of spots.';
  }

  function updateStatus(activePlayer, phase, moveCount) {
    const label   = document.getElementById('turnLabel');
    const counter = document.getElementById('moveCounter');
    const undoBtn = document.getElementById('undoBtn');
    if (label)   label.textContent   = phase === 'GAME_OVER' ? 'Game Over' : `Player ${activePlayer}'s turn`;
    if (counter) counter.textContent = `Move ${moveCount ?? 0}`;
    if (undoBtn) undoBtn.disabled    = !moveCount;
  }

  function showGameOver(winner, moveCount) {
    const overlay    = document.getElementById('gameOverOverlay');
    const winnerText = document.getElementById('winnerText');
    const statusBar  = document.getElementById('statusBar');
    const counter    = document.getElementById('moveCounter');
    const undoBtn    = document.getElementById('undoBtn');
    if (winnerText) winnerText.textContent = `Player ${winner} wins! (${moveCount} move${moveCount === 1 ? '' : 's'})`;
    if (overlay)    overlay.classList.remove('hidden');
    if (statusBar)  statusBar.classList.add('hidden');
    if (counter)    counter.textContent = `Move ${moveCount ?? 0}`;
    if (undoBtn)    undoBtn.disabled = true;
  }

  function showRules() {
    const modal = document.getElementById('rulesModal');
    if (modal) modal.classList.add('open');
  }

  function hideRules() {
    const modal = document.getElementById('rulesModal');
    if (modal) modal.classList.remove('open');
  }

  function showToast(msg, durationMs = 2000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
    }, durationMs);
  }

  const UI = { showStartScreen, showGame, showStartError, updateStatus, showGameOver, showToast, showRules, hideRules };

  if (typeof globalThis.modules === 'object') {
    globalThis.modules.UI = UI;
  } else {
    globalThis.UI = UI;
  }
})();

// ── Bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const canvas    = document.getElementById('gameCanvas');
  const container = document.getElementById('canvasContainer');

  GameController.setCanvas(canvas);
  Renderer.resizeCanvas(canvas, container);

  new ResizeObserver(() => {
    Renderer.resizeCanvas(canvas, container);
    Renderer.render(GameController.getState(), GameController.getDrawingState(), canvas);
  }).observe(container);

  InputHandler.attach(canvas, GameController);

  document.getElementById('newGameBtn')   ?.addEventListener('click', () => GameController.newGame());
  document.getElementById('newGameOverBtn')?.addEventListener('click', () => GameController.newGame());
  document.getElementById('undoBtn')      ?.addEventListener('click', () => GameController.undo());
  document.getElementById('rulesBtn')     ?.addEventListener('click', () => UI.showRules());
  document.getElementById('closeRulesBtn')?.addEventListener('click', () => UI.hideRules());

  document.getElementById('rulesModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('rulesModal')) UI.hideRules();
  });

  document.getElementById('startForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    GameController.startGame(parseInt(document.getElementById('spotCountInput').value, 10));
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const modal = document.getElementById('rulesModal');
    if (e.key === 'Escape' && modal?.classList.contains('open')) { UI.hideRules(); return; }
    if (e.key === 'n' || e.key === 'N') GameController.newGame();
    if (e.key === 'u' || e.key === 'U') GameController.undo();
    if (e.key === '?') UI.showRules();
  });

  UI.showStartScreen();
});
