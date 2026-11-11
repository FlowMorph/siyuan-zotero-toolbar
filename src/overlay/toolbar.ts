import type {ShapeKind, ToolId} from "../engine/types";
import type {OverlayConfig, OverlaySettings} from "./overlay";
import {ICONS} from "./icons";
import {NOTE_COLORS} from "./notes";

/** pen/shape palette: Zotero's grid with gray swapped for black (ink needs black) */
export const PEN_COLORS = ["#1e1e1e", "#ff6666", "#5fb236", "#2ea8e5", "#a28ae5", "#e56eee", "#f19837", "#ffd400"];
export const HL_COLORS = NOTE_COLORS;

/** slider ranges for stroke width / eraser size — pen max is settings-driven */
export const WIDTH_RANGE = {
    pen: {min: 1, max: 20, step: 1}, // max overridden by settings.penWidthMax
    highlighter: {min: 10, max: 60, step: 5},
    shape: {min: 1, max: 12, step: 1},
    eraser: {min: 10, max: 50, step: 5},
} as const;

const snapToRange = (v: number, r: { min: number; max: number; step: number }) =>
    Math.min(r.max, Math.max(r.min, Math.round((v - r.min) / r.step) * r.step + r.min));

export type PaletteAction =
    | "undo" | "redo" | "clear" | "export" | "collapse" | "settings"
    | "deleteSel" | "dupSel" | "doneSel";

export interface PaletteState {
    mode: boolean;
    canUndo: boolean;
    canRedo: boolean;
    hasSelection: boolean;
}

export interface PaletteDeps {
    i18n: (key: string, vars?: Record<string, string>) => string;
    config: OverlayConfig;
    settings: OverlaySettings;
    onSelectTool: (tool: ToolId) => void;
    onColor: (color: string) => void;
    onShapeKind: (shape: ShapeKind) => void;
    onWidth: (width: number) => void;
    onAction: (action: PaletteAction) => void;
    /** tapping the floating handle toggles drawing mode */
    onHandleActivate: () => void;
}

const POS_KEY = "zotero-toolbar.toolbar-pos-v2";
const HANDLE_POS_KEY = "zotero-toolbar.handle-pos";
const POPOVER_GAP = 10;

const loadPos = (key: string): { x: number; y: number } | null => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (typeof v?.x === "number" && typeof v?.y === "number") return v;
    } catch { /* ignore */ }
    return null;
};

const savePos = (key: string, pos: { x: number; y: number }) => {
    try {
        localStorage.setItem(key, JSON.stringify(pos));
    } catch { /* ignore */ }
};

type PopoverKind = "options" | "menu";

/** tools whose button, tapped again while active, opens the options popover */
const TOOLS_WITH_OPTIONS: ReadonlySet<ToolId> = new Set(["highlighter", "pen", "shape", "note", "eraser"]);

/**
 * Zotero-style vertical toolbar: icon-only tools, one color dot that opens a
 * secondary popover (color grid, width, shape kind), then undo / redo /
 * close / menu at the bottom.
 */
export class Palette {
    readonly toolbar: HTMLDivElement;
    readonly handle: HTMLButtonElement;

    private readonly deps: PaletteDeps;
    private state: PaletteState = {mode: false, canUndo: false, canRedo: false, hasSelection: false};
    private suppressClick = false;
    private popover: HTMLDivElement | null = null;
    private popoverKind: PopoverKind | null = null;
    /** data-anchor of the button the popover hangs off (tool button, dot or ⋯) */
    private popoverAnchor: string | null = null;

    constructor(deps: PaletteDeps) {
        this.deps = deps;

        this.toolbar = document.createElement("div");
        this.toolbar.className = "zt-toolbar";
        this.toolbar.style.display = "none";
        document.body.appendChild(this.toolbar);

        this.handle = document.createElement("button");
        this.handle.className = "zt-handle";
        this.handle.innerHTML = ICONS.penStroke;
        this.handle.style.display = "none";
        document.body.appendChild(this.handle);

        this.bindDragging();
        this.handle.addEventListener("click", () => {
            if (!this.suppressClick) this.deps.onHandleActivate();
            this.suppressClick = false;
        });
        this.renderToolbar();
        this.restorePositions();
    }

    // -------------------------------------------------------------- layout

    private restorePositions() {
        const pos = loadPos(POS_KEY);
        if (pos) this.place(this.toolbar, pos);
        else this.defaultToolbarPos();
        const hpos = loadPos(HANDLE_POS_KEY);
        if (hpos) this.place(this.handle, hpos);
        else this.place(this.handle, {x: window.innerWidth - 62, y: Math.max(80, window.innerHeight * 0.3)});
    }

    /** left side, vertically centred — where Zotero keeps it */
    private defaultToolbarPos() {
        const h = this.toolbar.offsetHeight || 480;
        this.place(this.toolbar, {x: 56, y: (window.innerHeight - h) / 2});
    }

    /** viewport is `fixed`-positioned: x/y are the top-left corner */
    private place(el: HTMLElement, pos: { x: number; y: number }) {
        const w = el.offsetWidth || 52;
        const h = el.offsetHeight || 46;
        const x = Math.min(Math.max(8, pos.x), Math.max(8, window.innerWidth - w - 8));
        const y = Math.min(Math.max(8, pos.y), Math.max(8, window.innerHeight - h - 8));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }

    private currentPos(el: HTMLElement) {
        return {x: parseFloat(el.style.left || "0"), y: parseFloat(el.style.top || "0")};
    }

    private bindDragging() {
        for (const [elRaw, key] of [[this.toolbar, POS_KEY], [this.handle, HANDLE_POS_KEY]] as const) {
            const el = elRaw as HTMLElement;
            el.addEventListener("pointerdown", (e: PointerEvent) => {
                const target = e.target as HTMLElement;
                if (el === this.toolbar && target.closest("button")) return; // controls stay interactive
                e.preventDefault();
                e.stopPropagation();
                const rect = el.getBoundingClientRect();
                const offX = e.clientX - rect.left;
                const offY = e.clientY - rect.top;
                let moved = false;
                const startX = e.clientX;
                const startY = e.clientY;
                const move = (ev: PointerEvent) => {
                    // sub-threshold drift (Apple Pencil taps jitter ~1-2px) is
                    // a tap, not a drag — otherwise the ball never activates
                    if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
                    if (!moved) this.closePopover();
                    moved = true;
                    this.place(el, {x: ev.clientX - offX, y: ev.clientY - offY});
                };
                const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    if (moved) {
                        savePos(key, this.currentPos(el));
                        if (el === this.handle) this.suppressClick = true; // drag, not a tap
                    } else if (el === this.handle) {
                        // a plain tap on the handle toggles drawing mode
                        this.deps.onHandleActivate();
                        this.suppressClick = true;
                    }
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
            });
        }
    }

    // -------------------------------------------------------------- render

    private btn(icon: string, title: string, onClick: (b: HTMLButtonElement) => void, cls = ""): HTMLButtonElement {
        const b = document.createElement("button");
        b.className = `zt-btn ${cls}`.trim();
        b.innerHTML = icon;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick(b);
        });
        return b;
    }

    private renderToolbar() {
        const t = this.deps.i18n;
        const tool = this.deps.config.tool;
        this.toolbar.innerHTML = "";

        // Zotero's order: select, highlight, draw, shapes, note, eraser
        const toolDefs: Array<[ToolId, string, string]> = [
            ["select", ICONS.select, t("toolSelect")],
            ["highlighter", ICONS.highlighter, t("toolHighlighter")],
            ["pen", ICONS.penStroke, t("toolPen")],
            ["shape", ICONS.shapes, t("toolShape")],
            ["note", ICONS.noteTool, t("toolNote")],
            ["eraser", ICONS.eraser, t("toolEraser")],
        ];
        for (const [id, icon, label] of toolDefs) {
            // tapping the active tool again opens its options right beside it
            const b = this.btn(icon, label, (el) => {
                if (tool === id && TOOLS_WITH_OPTIONS.has(id)) this.togglePopover("options", el);
                else this.deps.onSelectTool(id);
            }, tool === id ? "zt-btn--active" : "");
            b.dataset.anchor = `tool:${id}`;
            this.toolbar.appendChild(b);
        }

        // the secondary slot: selection actions, or the options dot
        if (tool === "select" && this.state.hasSelection) {
            this.toolbar.appendChild(this.btn(ICONS.duplicate, t("strokeDuplicate"), () => this.deps.onAction("dupSel")));
            this.toolbar.appendChild(this.btn(ICONS.trash, t("strokeDelete"), () => this.deps.onAction("deleteSel")));
        } else if (tool !== "select") {
            const dot = this.btn("", t("toolOptions"), (b) => this.togglePopover("options", b), "zt-btn--dot");
            dot.dataset.anchor = "dot";
            const swatch = document.createElement("i");
            swatch.className = "zt-dot";
            const color = this.activeColor();
            if (color) swatch.style.background = color;
            else swatch.classList.add("zt-dot--hollow");
            dot.appendChild(swatch);
            this.toolbar.appendChild(dot);
        }

        const spacer = document.createElement("div");
        spacer.className = "zt-toolbar__spacer";
        this.toolbar.appendChild(spacer);

        const undo = this.btn(ICONS.undo, t("undo"), () => this.deps.onAction("undo"));
        undo.disabled = !this.state.canUndo;
        const redo = this.btn(ICONS.redo, t("redo"), () => this.deps.onAction("redo"));
        redo.disabled = !this.state.canRedo;
        // like Zotero, ≡ at the bottom is the drag handle (not a button)
        const drag = document.createElement("div");
        drag.className = "zt-toolbar__drag";
        drag.innerHTML = ICONS.menu;
        drag.title = t("dragToolbar");
        const more = this.btn(ICONS.more, t("more"), (b) => this.togglePopover("menu", b));
        more.dataset.anchor = "more";
        this.toolbar.append(
            undo,
            redo,
            more,
            this.btn(ICONS.closeCircle, t("collapse"), () => this.deps.onAction("collapse")),
            drag,
        );

        if (this.toolbar.style.left) this.place(this.toolbar, this.currentPos(this.toolbar));
    }

    private activeColor(): string | null {
        const cfg = this.deps.config;
        switch (cfg.tool) {
            case "pen": return cfg.penColor;
            case "highlighter": return cfg.hlColor;
            case "shape": return cfg.shapeColor;
            case "note": return cfg.noteColor;
            default: return null;
        }
    }

    // ------------------------------------------------------------- popover

    private togglePopover(kind: PopoverKind, anchor: HTMLElement) {
        if (this.popover && this.popoverAnchor === anchor.dataset.anchor) {
            this.closePopover();
            return;
        }
        this.openPopover(kind, anchor);
    }

    private openPopover(kind: PopoverKind, anchor: HTMLElement) {
        this.closePopover();
        const pop = document.createElement("div");
        pop.className = "zt-pop";
        pop.addEventListener("pointerdown", (e) => e.stopPropagation());
        if (kind === "options") this.fillOptions(pop);
        else this.fillMenu(pop);
        document.body.appendChild(pop);
        this.popover = pop;
        this.popoverKind = kind;
        this.popoverAnchor = anchor.dataset.anchor ?? null;
        anchor.classList.add("zt-btn--open");
        this.positionPopover(anchor);
        document.addEventListener("pointerdown", this.onOutside, true);
        // window capture runs before the plugin's document-level Esc (exit mode)
        window.addEventListener("keydown", this.onPopoverKey, true);
    }

    private closePopover() {
        if (!this.popover) return;
        this.popover.remove();
        this.popover = null;
        this.popoverKind = null;
        this.popoverAnchor = null;
        this.toolbar.querySelectorAll(".zt-btn--open").forEach((b) => b.classList.remove("zt-btn--open"));
        document.removeEventListener("pointerdown", this.onOutside, true);
        window.removeEventListener("keydown", this.onPopoverKey, true);
    }

    private onOutside = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        // the anchor button's own click toggles it
        if (target && (this.popover?.contains(target) || target.closest(".zt-btn--open"))) return;
        // like Zotero: a tap on the page only dismisses the popover — it must
        // not also start a stroke. Other SiYuan UI still gets its click.
        if (target?.closest(".zt-capture")) {
            e.preventDefault();
            e.stopPropagation();
        }
        this.closePopover();
    };

    private onPopoverKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation(); // Esc closes the popover, not annotation mode
        this.closePopover();
    };

    /** beside the anchor button, on whichever side of the toolbar has room */
    private positionPopover(anchor: HTMLElement) {
        const pop = this.popover;
        if (!pop) return;
        const tb = this.toolbar.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        let x = tb.right + POPOVER_GAP;
        const left = x + w > window.innerWidth - 8;
        if (left) x = tb.left - POPOVER_GAP - w;
        const y = Math.min(Math.max(8, a.top + a.height / 2 - h / 2), window.innerHeight - h - 8);
        pop.style.left = `${Math.max(8, x)}px`;
        pop.style.top = `${y}px`;
        // the little arrow keeps pointing at the anchor button
        pop.style.setProperty("--zt-pop-arrow", `${a.top + a.height / 2 - y}px`);
        pop.classList.toggle("zt-pop--left", left);
    }

    private fillOptions(pop: HTMLDivElement) {
        const cfg = this.deps.config;
        const t = this.deps.i18n;
        const tool = cfg.tool;

        if (tool === "shape") {
            const row = document.createElement("div");
            row.className = "zt-pop__row";
            const kinds: Array<[ShapeKind, string, string]> = [
                ["rect", ICONS.rect, t("shapeRect")],
                ["ellipse", ICONS.ellipse, t("shapeEllipse")],
                ["line", ICONS.line, t("shapeLine")],
                ["arrow", ICONS.arrow, t("shapeArrow")],
            ];
            for (const [id, icon, label] of kinds) {
                row.appendChild(this.btn(icon, label, () => this.deps.onShapeKind(id),
                    cfg.shape === id ? "zt-btn--active" : ""));
            }
            pop.appendChild(row);
        }

        const colors = tool === "pen" || tool === "shape" ? PEN_COLORS
            : tool === "highlighter" || tool === "note" ? HL_COLORS : null;
        const active = this.activeColor();
        if (colors && active) {
            const grid = document.createElement("div");
            grid.className = "zt-pop__colors";
            for (const c of colors) {
                const sw = document.createElement("button");
                sw.className = `zt-swatch${c.toLowerCase() === active.toLowerCase() ? " zt-swatch--active" : ""}`;
                sw.style.setProperty("--zt-swatch", c);
                sw.title = c;
                sw.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.closePopover();
                    this.deps.onColor(c);
                });
                grid.appendChild(sw);
            }
            pop.appendChild(grid);
        }

        if (tool === "pen" || tool === "highlighter" || tool === "shape") {
            const width = tool === "pen" ? cfg.penWidth : tool === "highlighter" ? cfg.hlWidth : cfg.shapeWidth;
            pop.appendChild(this.widthSlider(tool, width, active ?? "#888"));
        } else if (tool === "eraser") {
            pop.appendChild(this.widthSlider("eraser", this.deps.settings.eraserRadius, "#9aa0a6"));
        }
    }

    private fillMenu(pop: HTMLDivElement) {
        const t = this.deps.i18n;
        pop.classList.add("zt-pop--menu");
        const items: Array<[string, string, PaletteAction]> = [
            [ICONS.export, t("exportImage"), "export"],
            [ICONS.trash, t("clearAll"), "clear"],
            [ICONS.gear, t("settings"), "settings"],
        ];
        for (const [icon, label, action] of items) {
            const item = document.createElement("button");
            item.className = "zt-pop__item";
            item.innerHTML = icon;
            const span = document.createElement("span");
            span.textContent = label;
            item.appendChild(span);
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                this.closePopover();
                this.deps.onAction(action);
            });
            pop.appendChild(item);
        }
    }

    /** width slider with a live dot preview; value flows out through deps.onWidth */
    private widthSlider(kind: keyof typeof WIDTH_RANGE, value: number, dotColor: string): HTMLDivElement {
        let range: {min: number; max: number; step: number} = WIDTH_RANGE[kind];
        if (kind === "pen") {
            // cap is user-adjustable in settings
            const max = Math.max(range.min, Math.round(this.deps.settings.penWidthMax || 20));
            range = {min: range.min, max, step: range.step};
        }
        const wrap = document.createElement("div");
        wrap.className = "zt-width";

        const dotBox = document.createElement("span");
        dotBox.className = "zt-width__preview";
        const dot = document.createElement("i");
        dot.style.background = dotColor;
        dotBox.appendChild(dot);
        const setDot = (v: number) => {
            const d = Math.round(4 + ((v - range.min) / (range.max - range.min)) * 18);
            dot.style.width = `${d}px`;
            dot.style.height = `${d}px`;
        };

        const input = document.createElement("input");
        input.type = "range";
        input.min = String(range.min);
        input.max = String(range.max);
        input.step = String(range.step);
        input.value = String(snapToRange(value, range));
        wrap.title = `${input.value}px`;
        setDot(Number(input.value));

        input.addEventListener("input", () => {
            const v = Number(input.value);
            setDot(v);
            wrap.title = `${v}px`;
            this.deps.onWidth(v);
        });
        wrap.append(input, dotBox);
        return wrap;
    }

    // --------------------------------------------------------------- state

    setMode(on: boolean) {
        this.state.mode = on;
        this.toolbar.style.display = on ? "" : "none";
        this.handle.style.display = on ? "none" : "";
        this.handle.classList.toggle("zt-handle--on", on);
        if (!on) this.closePopover();
        else if (!loadPos(POS_KEY)) this.defaultToolbarPos();
        else this.place(this.toolbar, this.currentPos(this.toolbar));
    }

    update(state: Partial<PaletteState>) {
        const prev = this.state;
        this.state = {...prev, ...state};
        const structural =
            prev.canUndo !== this.state.canUndo ||
            prev.canRedo !== this.state.canRedo ||
            prev.hasSelection !== this.state.hasSelection;
        if (structural) this.refresh();
        this.handle.classList.toggle("zt-handle--on", this.state.mode);
    }

    /** re-render after tool/color/shape changes; an open options popover stays open */
    refresh() {
        const kind = this.popoverKind;
        const key = this.popoverAnchor;
        this.closePopover();
        this.renderToolbar();
        if (kind === "options") {
            const anchor = this.toolbar.querySelector<HTMLElement>(`[data-anchor="${key}"]`) ??
                this.toolbar.querySelector<HTMLElement>(".zt-btn--dot");
            if (anchor) this.openPopover(kind, anchor);
        }
    }

    repositionForViewport() {
        this.closePopover();
        this.place(this.toolbar, this.currentPos(this.toolbar));
        this.place(this.handle, this.currentPos(this.handle));
    }
}
