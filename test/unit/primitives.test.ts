import {describe, expect, it} from "vitest";
import {arrowHeadLength, buildShape, constrainEnd, isDegenerateShape} from "../../src/engine/primitives";

const pt = (x: number, y: number) => ({x, y, p: 0.5});

describe("buildShape", () => {
    it("矩形是首尾闭合的 5 点折线，与拖拽方向无关", () => {
        const a = buildShape("rect", pt(100, 80), pt(10, 20), 3);
        expect(a).toHaveLength(5);
        expect(a[0]).toEqual(pt(10, 20));
        expect(a[2]).toEqual(pt(100, 80));
        expect(a[4]).toEqual(a[0]);
    });

    it("椭圆的点都在外接框内并闭合", () => {
        const e = buildShape("ellipse", pt(0, 0), pt(200, 100), 3);
        expect(e.length).toBeGreaterThan(32);
        for (const q of e) {
            expect(((q.x - 100) / 100) ** 2 + ((q.y - 50) / 50) ** 2).toBeCloseTo(1, 6);
        }
        expect(e[0].x).toBeCloseTo(e[e.length - 1].x, 6);
        expect(e[0].y).toBeCloseTo(e[e.length - 1].y, 6);
    });

    it("箭头：杆 + 两个倒刺都从尖端出发", () => {
        const arr = buildShape("arrow", pt(0, 0), pt(100, 0), 3);
        expect(arr).toHaveLength(5);
        expect(arr[1]).toEqual(pt(100, 0));
        expect(arr[3]).toEqual(pt(100, 0));
        expect(arr[2].x).toBeLessThan(100);
        expect(arr[2].y).toBeCloseTo(-arr[4].y, 6);
        expect(Math.hypot(100 - arr[2].x, arr[2].y)).toBeCloseTo(arrowHeadLength(3, 100), 6);
    });

    it("所有点压感一致，渲染走等宽折线", () => {
        for (const kind of ["rect", "ellipse", "line", "arrow"] as const) {
            expect(buildShape(kind, pt(0, 0), pt(50, 40), 2).every((q) => q.p === 0.5)).toBe(true);
        }
    });
});

describe("Shift 约束", () => {
    it("矩形/椭圆变正方形/圆，保持拖拽方向", () => {
        expect(constrainEnd("rect", pt(0, 0), pt(-30, 10))).toEqual(pt(-30, 30));
    });

    it("直线/箭头吸附到 45° 倍数", () => {
        const e = constrainEnd("line", pt(0, 0), pt(100, 8));
        expect(e.y).toBeCloseTo(0, 6);
        expect(e.x).toBeCloseTo(Math.hypot(100, 8), 6);
        const d = constrainEnd("arrow", pt(0, 0), pt(50, 55));
        expect(d.x).toBeCloseTo(d.y, 6);
    });
});

it("点击不拖动不算形状", () => {
    expect(isDegenerateShape(pt(0, 0), pt(2, 2))).toBe(true);
    expect(isDegenerateShape(pt(0, 0), pt(10, 0))).toBe(false);
});
