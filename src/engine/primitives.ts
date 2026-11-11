import type {Point, ShapeKind} from "./types";

/**
 * Shape-tool geometry. Every shape becomes a sparse polyline with uniform
 * pressure, so it is stored, selected, erased, exported and undone exactly
 * like a pen stroke (the renderer strokes uniform-pressure polylines at the
 * configured width, keeping corners crisp).
 */

const P = 0.5;
const ELLIPSE_SEGMENTS = 64;
const ARROW_HEAD_ANGLE = Math.PI / 7;

/**
 * `constrain` (Shift held) makes rect/ellipse square/circular and snaps
 * line/arrow direction to 45° steps — the usual drawing-app convention.
 */
export const constrainEnd = (kind: ShapeKind, a: Point, b: Point): Point => {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (kind === "rect" || kind === "ellipse") {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        return {x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side, p: P};
    }
    const len = Math.hypot(dx, dy);
    const step = Math.PI / 4;
    const ang = Math.round(Math.atan2(dy, dx) / step) * step;
    return {x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len, p: P};
};

/** arrowhead size grows with the line width but never dwarfs a short arrow */
export const arrowHeadLength = (width: number, shaftLength: number) =>
    Math.min(Math.max(10, width * 4), shaftLength * 0.45);

export const buildShape = (
    kind: ShapeKind,
    start: Point,
    end: Point,
    width: number,
    constrain = false,
): Point[] => {
    const a = {x: start.x, y: start.y, p: P};
    const b = constrain ? constrainEnd(kind, a, end) : {x: end.x, y: end.y, p: P};
    if (kind === "line") return [a, b];
    if (kind === "arrow") {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1) return [a, b];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const head = arrowHeadLength(width, len);
        const wing = (sign: number): Point => ({
            x: b.x - head * Math.cos(ang + sign * ARROW_HEAD_ANGLE),
            y: b.y - head * Math.sin(ang + sign * ARROW_HEAD_ANGLE),
            p: P,
        });
        // shaft, then both barbs drawn out from the tip and back again
        return [a, {...b}, wing(1), {...b}, wing(-1)];
    }
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    if (kind === "rect") {
        return [
            {x: minX, y: minY, p: P},
            {x: maxX, y: minY, p: P},
            {x: maxX, y: maxY, p: P},
            {x: minX, y: maxY, p: P},
            {x: minX, y: minY, p: P},
        ];
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
    const pts: Point[] = [];
    for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
        const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        pts.push({x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t), p: P});
    }
    return pts;
};

/** too small to be a deliberate shape (a click without a drag) */
export const isDegenerateShape = (start: Point, end: Point) =>
    Math.hypot(end.x - start.x, end.y - start.y) < 4;
