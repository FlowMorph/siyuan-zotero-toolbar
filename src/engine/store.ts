import {newId, strokeBBox, translateStroke} from "./geometry";
import {
    deserializeNote,
    deserializeStroke,
    serializeNote,
    serializeStroke,
    type Note,
    type PencilPayload,
    type Point,
    type Stroke,
    type StrokeTool,
} from "./types";

/** the mutable part of a note — what one undo step restores */
export type NoteState = Pick<Note, "text" | "color" | "x" | "y" | "anchor">;

export const noteState = (n: Note): NoteState => ({
    text: n.text,
    color: n.color,
    x: n.x,
    y: n.y,
    ...(n.anchor ? {anchor: {...n.anchor}} : {}),
});

const sameNoteState = (a: NoteState, b: NoteState) =>
    a.text === b.text && a.color === b.color && a.x === b.x && a.y === b.y &&
    a.anchor?.blockId === b.anchor?.blockId;

const applyNoteState = (n: Note, st: NoteState) => {
    n.text = st.text;
    n.color = st.color;
    n.x = st.x;
    n.y = st.y;
    if (st.anchor) n.anchor = {...st.anchor};
    else delete n.anchor;
};

export type Op =
    | { type: "add"; strokes: Stroke[]; notes?: Note[] }
    | { type: "remove"; strokes: Stroke[]; notes?: Note[] }
    | { type: "move"; strokes: Stroke[]; dx: number; dy: number }
    | { type: "note"; note: Note; before: NoteState; after: NoteState };

const UNDO_LIMIT = 100;

/** In-memory document state: stroke list + undo/redo + persistence bookkeeping. */
export class DocStore {
    strokes: Stroke[] = [];
    notes: Note[] = [];
    docId: string;

    /** unsaved local changes exist (need to be pushed to the kernel) */
    dirty = false;
    /** updatedAt of the payload we last wrote or adopted */
    lastSavedAt = 0;
    /** in-flight save promise, so flushes can be awaited */
    saving: Promise<unknown> | null = null;

    private undoStack: Op[] = [];
    private redoStack: Op[] = [];

    constructor(docId: string) {
        this.docId = docId;
    }

    get canUndo() {
        return this.undoStack.length > 0;
    }

    get canRedo() {
        return this.redoStack.length > 0;
    }

    private pushOp(op: Op) {
        this.undoStack.push(op);
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
        this.redoStack = [];
    }

    addStroke(tool: StrokeTool, config: { color: string; width: number; opacity: number; simulate: boolean }, points: Point[]): Stroke {
        const stroke: Stroke = {
            id: newId(),
            tool,
            color: config.color,
            width: config.width,
            opacity: config.opacity,
            simulate: config.simulate,
            points,
            createdAt: Date.now(),
        };
        this.strokes.push(stroke);
        this.pushOp({type: "add", strokes: [stroke]});
        this.dirty = true;
        return stroke;
    }

    /** Removes strokes hit by the eraser segment; returns what was removed. */
    eraseWhere(predicate: (s: Stroke) => boolean): Stroke[] {
        const removed = this.strokes.filter(predicate);
        if (removed.length === 0) return [];
        const removedIds = new Set(removed.map((s) => s.id));
        this.strokes = this.strokes.filter((s) => !removedIds.has(s.id));
        this.pushOp({type: "remove", strokes: removed});
        this.dirty = true;
        return removed;
    }

    /** Visual-only translation while a drag is in progress (no undo entry). */
    moveStrokesTransient(strokes: Stroke[], dx: number, dy: number) {
        if (strokes.length === 0 || (dx === 0 && dy === 0)) return;
        for (const s of strokes) translateStroke(s, dx, dy);
    }

    /** Records the completed drag as one undoable op (points already moved). */
    commitMove(strokes: Stroke[], dx: number, dy: number) {
        if (strokes.length === 0 || (dx === 0 && dy === 0)) return;
        this.pushOp({type: "move", strokes, dx, dy});
        this.dirty = true;
    }

    moveStrokes(strokes: Stroke[], dx: number, dy: number) {
        this.moveStrokesTransient(strokes, dx, dy);
        this.commitMove(strokes, dx, dy);
    }

    /** removes every stroke and note as one undoable step; @returns true if anything was removed */
    clearAll(): boolean {
        const strokes = this.strokes;
        const notes = this.notes;
        if (strokes.length === 0 && notes.length === 0) return false;
        this.strokes = [];
        this.notes = [];
        this.pushOp({type: "remove", strokes, notes});
        this.dirty = true;
        return true;
    }

    // ---------------------------------------------------------------- notes

    addNote(note: Note) {
        this.notes.push(note);
        this.pushOp({type: "add", strokes: [], notes: [note]});
        this.dirty = true;
    }

    removeNote(note: Note) {
        if (!this.notes.includes(note)) return;
        this.notes = this.notes.filter((n) => n !== note);
        this.pushOp({type: "remove", strokes: [], notes: [note]});
        this.dirty = true;
    }

    /**
     * Records an edit/move/recolor already applied to `note` as one undo
     * step; `before` is the state captured when the edit began.
     */
    commitNoteChange(note: Note, before: NoteState): boolean {
        const after = noteState(note);
        if (sameNoteState(before, after)) return false;
        this.pushOp({type: "note", note, before, after});
        this.dirty = true;
        return true;
    }

    duplicateStroke(stroke: Stroke): Stroke | null {
        const copy: Stroke = {
            ...stroke,
            id: newId(),
            createdAt: Date.now(),
            points: stroke.points.map((p) => ({...p})),
        };
        translateStroke(copy, 12, 12);
        const idx = this.strokes.findIndex((s) => s.id === stroke.id);
        if (idx >= 0) this.strokes.splice(idx + 1, 0, copy);
        else this.strokes.push(copy);
        this.pushOp({type: "add", strokes: [copy]});
        this.dirty = true;
        return copy;
    }

    private dropItems(op: {strokes: Stroke[]; notes?: Note[]}) {
        const ids = new Set(op.strokes.map((s) => s.id));
        this.strokes = this.strokes.filter((s) => !ids.has(s.id));
        if (op.notes?.length) {
            const noteIds = new Set(op.notes.map((n) => n.id));
            this.notes = this.notes.filter((n) => !noteIds.has(n.id));
        }
    }

    private restoreItems(op: {strokes: Stroke[]; notes?: Note[]}) {
        this.strokes.push(...op.strokes);
        this.strokes.sort((a, b) => a.createdAt - b.createdAt);
        if (op.notes?.length) {
            this.notes.push(...op.notes);
            this.notes.sort((a, b) => a.createdAt - b.createdAt);
        }
    }

    undo(): boolean {
        const op = this.undoStack.pop();
        if (!op) return false;
        if (op.type === "add") {
            this.dropItems(op);
        } else if (op.type === "remove") {
            this.restoreItems(op);
        } else if (op.type === "note") {
            applyNoteState(op.note, op.before);
        } else {
            for (const s of op.strokes) translateStroke(s, -op.dx, -op.dy);
        }
        this.redoStack.push(op);
        this.dirty = true;
        return true;
    }

    redo(): boolean {
        const op = this.redoStack.pop();
        if (!op) return false;
        if (op.type === "add") {
            this.restoreItems(op);
        } else if (op.type === "remove") {
            this.dropItems(op);
        } else if (op.type === "note") {
            applyNoteState(op.note, op.after);
        } else {
            for (const s of op.strokes) translateStroke(s, op.dx, op.dy);
        }
        this.undoStack.push(op);
        this.dirty = true;
        return true;
    }

    /** bbox of everything drawn (for export); offsets = block-anchor deltas */
    contentBBox(offsets?: (s: Stroke) => {dx: number; dy: number}) {
        if (this.strokes.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of this.strokes) {
            const b = strokeBBox(s);
            const o = offsets ? offsets(s) : {dx: 0, dy: 0};
            minX = Math.min(minX, b.minX + o.dx); minY = Math.min(minY, b.minY + o.dy);
            maxX = Math.max(maxX, b.maxX + o.dx); maxY = Math.max(maxY, b.maxY + o.dy);
        }
        return {minX, minY, maxX, maxY};
    }

    serialize(): PencilPayload {
        return {
            version: 1,
            docId: this.docId,
            updatedAt: Date.now(),
            strokes: this.strokes.map(serializeStroke),
            notes: this.notes.map(serializeNote),
        };
    }

    adoptPayload(payload: PencilPayload) {
        this.strokes = (payload.strokes || []).map(deserializeStroke);
        this.notes = (payload.notes || []).map(deserializeNote);
        this.lastSavedAt = payload.updatedAt || 0;
        this.undoStack = [];
        this.redoStack = [];
        this.dirty = false;
    }

    /**
     * Union-merge a remote payload (sync from another device) into local
     * strokes and notes by id; local copies win for identical ids.
     */
    mergeRemote(payload: PencilPayload): boolean {
        this.lastSavedAt = Math.max(this.lastSavedAt, payload.updatedAt || 0);
        const localIds = new Set(this.strokes.map((s) => s.id));
        const strokes = (payload.strokes || []).map(deserializeStroke).filter((s) => !localIds.has(s.id));
        const localNoteIds = new Set(this.notes.map((n) => n.id));
        const notes = (payload.notes || []).map(deserializeNote).filter((n) => !localNoteIds.has(n.id));
        if (strokes.length === 0 && notes.length === 0) return false;
        this.restoreItems({strokes, notes});
        return true;
    }
}
