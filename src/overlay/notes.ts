import {noteState, type NoteState} from "../engine/store";
import {parseNoteText} from "../engine/noteText";
import type {Note} from "../engine/types";
import {ICONS} from "./icons";

/** Zotero's annotation colors */
export const NOTE_COLORS = ["#ffd400", "#ff6666", "#5fb236", "#2ea8e5", "#a28ae5", "#e56eee", "#f19837", "#aaaaaa"];

export const NOTE_ICON_SIZE = 22;
const DRAG_THRESHOLD = 4;
const POPUP_WIDTH = 260;

export interface NotePlacement {
    /** icon top-left in overlay-root pixels */
    left: number;
    top: number;
    visible: boolean;
}

export interface NoteLayerDeps {
    i18n: (key: string) => string;
    /** an edit/recolor finished; `before` is the state when it started */
    onChange: (note: Note, before: NoteState) => void;
    /** a drag finished (note.x/y already moved by the drag delta) */
    onDragEnd: (note: Note, before: NoteState) => void;
    onDelete: (note: Note) => void;
    openRef: (blockId: string) => void;
    previewRef: (blockId: string, target: HTMLElement) => void;
    openUrl: (href: string) => void;
}

/** events that must not reach SiYuan's editor/global handlers */
const ISOLATED_EVENTS = [
    "pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu",
    "keydown", "keyup", "keypress", "input", "beforeinput", "paste", "copy", "cut",
    "compositionstart", "compositionupdate", "compositionend", "dragstart",
];

/**
 * DOM layer for sticky notes: one small icon per note, plus a popup for the
 * note being read or edited. Positions are pushed in by the overlay on every
 * redraw (scroll, reflow, undo), so notes track their anchor blocks exactly
 * like strokes do.
 */
export class NoteLayer {
    readonly el: HTMLDivElement;

    private readonly deps: NoteLayerDeps;
    private icons = new Map<string, HTMLDivElement>();
    private place: (n: Note) => NotePlacement = () => ({left: 0, top: 0, visible: false});

    private popup: HTMLDivElement | null = null;
    private openNote: Note | null = null;
    private editing: {textarea: HTMLTextAreaElement; before: NoteState} | null = null;
    private drag: {note: Note; pointerId: number; startX: number; startY: number;
        baseX: number; baseY: number; moved: boolean; before: NoteState} | null = null;

    constructor(deps: NoteLayerDeps) {
        this.deps = deps;
        this.el = document.createElement("div");
        this.el.className = "zt-notes";
    }

    /** sync icons (and the open popup) with the store; called on every overlay redraw */
    render(notes: Note[], place: (n: Note) => NotePlacement) {
        this.place = place;
        const alive = new Set<string>();
        for (const note of notes) {
            alive.add(note.id);
            let icon = this.icons.get(note.id);
            if (!icon) {
                icon = this.createIcon(note);
                this.icons.set(note.id, icon);
                this.el.appendChild(icon);
            }
            icon.style.color = note.color;
            this.positionIcon(icon, note);
        }
        for (const [id, icon] of this.icons) {
            if (!alive.has(id)) {
                icon.remove();
                this.icons.delete(id);
            }
        }
        if (this.openNote) {
            if (!notes.includes(this.openNote)) this.close();
            else this.refreshPopup();
        }
    }

    /** open a note's popup; `edit` starts in the text editor (new notes) */
    open(note: Note, edit = false) {
        if (this.openNote !== note) this.close();
        this.openNote = note;
        if (!this.popup) {
            this.popup = document.createElement("div");
            this.popup.className = "zt-note-popup";
            isolate(this.popup);
            this.el.appendChild(this.popup);
            document.addEventListener("pointerdown", this.onOutsidePointer, true);
        }
        this.buildPopup(note);
        if (edit) this.startEdit();
        this.positionPopup();
    }

    close() {
        if (this.editing) this.finishEdit();
        this.popup?.remove();
        this.popup = null;
        this.openNote = null;
        document.removeEventListener("pointerdown", this.onOutsidePointer, true);
        for (const icon of this.icons.values()) icon.classList.remove("zt-note--open");
    }

    get openNoteId(): string | null {
        return this.openNote?.id ?? null;
    }

    destroy() {
        this.close();
        this.el.remove();
    }

    // ---------------------------------------------------------------- icons

    private createIcon(note: Note): HTMLDivElement {
        const icon = document.createElement("div");
        icon.className = "zt-note";
        icon.innerHTML = ICONS.note;
        icon.dataset.noteId = note.id;
        isolate(icon);
        icon.addEventListener("pointerdown", (e) => this.onIconDown(e, note));
        icon.addEventListener("pointermove", this.onIconMove);
        icon.addEventListener("pointerup", this.onIconUp);
        icon.addEventListener("pointercancel", this.onIconUp);
        return icon;
    }

    private positionIcon(icon: HTMLDivElement, note: Note) {
        const p = this.place(note);
        icon.style.display = p.visible ? "" : "none";
        icon.style.transform = `translate(${p.left}px, ${p.top}px)`;
        icon.classList.toggle("zt-note--open", this.openNote === note);
    }

    private onIconDown(e: PointerEvent, note: Note) {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        this.drag = {
            note, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
            baseX: note.x, baseY: note.y, moved: false, before: noteState(note),
        };
    }

    private onIconMove = (e: PointerEvent) => {
        const d = this.drag;
        if (!d || e.pointerId !== d.pointerId) return;
        const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        d.note.x = d.baseX + dx;
        d.note.y = d.baseY + dy;
        const icon = this.icons.get(d.note.id);
        if (icon) this.positionIcon(icon, d.note);
        if (this.openNote === d.note) this.positionPopup();
    };

    private onIconUp = (e: PointerEvent) => {
        const d = this.drag;
        if (!d || e.pointerId !== d.pointerId) return;
        this.drag = null;
        if (d.moved) {
            this.deps.onDragEnd(d.note, d.before);
        } else if (this.openNote === d.note) {
            this.close();
        } else {
            this.open(d.note);
        }
    };

    // ---------------------------------------------------------------- popup

    private buildPopup(note: Note) {
        const popup = this.popup!;
        const t = this.deps.i18n;
        popup.innerHTML = "";
        popup.style.setProperty("--zt-note-color", note.color);

        const head = document.createElement("div");
        head.className = "zt-note-popup__head";
        for (const c of NOTE_COLORS) {
            const sw = document.createElement("button");
            sw.className = `zt-note-popup__swatch${c === note.color ? " zt-note-popup__swatch--active" : ""}`;
            sw.style.background = c;
            sw.title = c;
            sw.addEventListener("click", () => {
                if (note.color === c) return;
                const before = noteState(note);
                note.color = c;
                this.deps.onChange(note, before);
            });
            head.appendChild(sw);
        }
        const del = document.createElement("button");
        del.className = "zt-note-popup__btn";
        del.innerHTML = ICONS.trash;
        del.title = t("noteDelete");
        del.addEventListener("click", () => {
            this.close();
            this.deps.onDelete(note);
        });
        head.appendChild(del);

        const body = document.createElement("div");
        body.className = "zt-note-popup__body";
        popup.append(head, body);
        this.renderBody();
    }

    /** view mode: text with clickable links; clicking elsewhere starts editing */
    private renderBody() {
        const note = this.openNote;
        const body = this.popup?.querySelector<HTMLDivElement>(".zt-note-popup__body");
        if (!note || !body || this.editing) return;
        body.innerHTML = "";
        body.title = this.deps.i18n("noteEditHint");
        if (!note.text.trim()) {
            const ph = document.createElement("span");
            ph.className = "zt-note-popup__placeholder";
            ph.textContent = this.deps.i18n("notePlaceholder");
            body.appendChild(ph);
        }
        for (const seg of parseNoteText(note.text)) {
            if (seg.type === "text") {
                body.appendChild(document.createTextNode(seg.text));
                continue;
            }
            const a = document.createElement("a");
            a.className = `zt-note-link zt-note-link--${seg.type}`;
            a.textContent = seg.label;
            if (seg.type === "ref") {
                a.dataset.id = seg.id;
                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    this.deps.openRef(seg.id);
                });
                a.addEventListener("mouseenter", () => this.deps.previewRef(seg.id, a));
            } else {
                a.href = seg.href;
                a.title = seg.href;
                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    this.deps.openUrl(seg.href);
                });
            }
            body.appendChild(a);
        }
        body.onclick = (e) => {
            if ((e.target as HTMLElement).closest(".zt-note-link")) return;
            this.startEdit();
        };
    }

    private refreshPopup() {
        const note = this.openNote;
        if (!note || !this.popup) return;
        this.popup.style.setProperty("--zt-note-color", note.color);
        this.popup.querySelectorAll<HTMLButtonElement>(".zt-note-popup__swatch").forEach((sw) =>
            sw.classList.toggle("zt-note-popup__swatch--active", sw.title === note.color));
        this.renderBody();
        this.positionPopup();
    }

    private startEdit() {
        const note = this.openNote;
        const body = this.popup?.querySelector<HTMLDivElement>(".zt-note-popup__body");
        if (!note || !body || this.editing) return;
        body.innerHTML = "";
        body.onclick = null;
        body.removeAttribute("title");
        const ta = document.createElement("textarea");
        ta.className = "zt-note-popup__input";
        ta.value = note.text;
        ta.placeholder = this.deps.i18n("notePlaceholder");
        const autosize = () => {
            ta.style.height = "auto";
            ta.style.height = `${Math.min(320, Math.max(60, ta.scrollHeight))}px`;
        };
        ta.addEventListener("input", autosize);
        ta.addEventListener("keydown", (e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                this.finishEdit();
                if (e.key === "Escape") this.close();
            }
        });
        ta.addEventListener("blur", () => this.finishEdit());
        body.appendChild(ta);
        this.editing = {textarea: ta, before: noteState(note)};
        autosize();
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
    }

    private finishEdit() {
        const ed = this.editing;
        const note = this.openNote;
        if (!ed || !note) return;
        this.editing = null;
        note.text = ed.textarea.value;
        this.renderBody();
        this.deps.onChange(note, ed.before);
    }

    private positionPopup() {
        const note = this.openNote;
        const popup = this.popup;
        if (!note || !popup) return;
        const p = this.place(note);
        popup.style.display = p.visible ? "" : "none";
        const hostW = this.el.clientWidth || POPUP_WIDTH * 2;
        const hostH = this.el.clientHeight || 400;
        // to the right of the icon, flipped left when it would overflow
        let left = p.left + NOTE_ICON_SIZE + 6;
        if (left + POPUP_WIDTH > hostW - 4) left = Math.max(4, p.left - POPUP_WIDTH - 6);
        const h = popup.offsetHeight || 120;
        const top = Math.min(Math.max(4, p.top - 4), Math.max(4, hostH - h - 4));
        popup.style.transform = `translate(${left}px, ${top}px)`;
    }

    private onOutsidePointer = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target || !this.popup) return;
        if (this.popup.contains(target)) return;
        if (target.closest(".zt-note")) return; // icon handlers decide (toggle / drag)
        if (target.closest(".block__popover")) return; // ref preview opened from the note
        this.close();
    };
}

const isolate = (el: HTMLElement) => {
    for (const type of ISOLATED_EVENTS) {
        el.addEventListener(type, (e) => e.stopPropagation());
    }
};
