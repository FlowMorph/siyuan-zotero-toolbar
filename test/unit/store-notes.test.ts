import {describe, expect, it} from "vitest";
import {DocStore, noteState} from "../../src/engine/store";
import type {Note} from "../../src/engine/types";

const mkNote = (id: string, extra: Partial<Note> = {}): Note => ({
    id, color: "#ffd400", text: "", x: 10, y: 20, createdAt: Number(id.replace(/\D/g, "")) || 1,
    anchor: {blockId: "20261108183627-aaaaaaa", ox: 0, oy: 0}, ...extra,
});

describe("便笺的撤销/重做", () => {
    it("新增、修改、删除都能逐步撤销和重做", () => {
        const st = new DocStore("doc");
        const n = mkNote("n1");
        st.addNote(n);

        const before = noteState(n);
        n.text = "批注";
        n.x = 99;
        expect(st.commitNoteChange(n, before)).toBe(true);

        st.removeNote(n);
        expect(st.notes).toHaveLength(0);

        st.undo();
        expect(st.notes).toEqual([n]);
        st.undo();
        expect(n.text).toBe("");
        expect(n.x).toBe(10);
        st.undo();
        expect(st.notes).toHaveLength(0);

        st.redo();
        st.redo();
        expect(st.notes[0].text).toBe("批注");
        expect(st.notes[0].x).toBe(99);
    });

    it("没有实际变化的提交不进撤销栈", () => {
        const st = new DocStore("doc");
        const n = mkNote("n1");
        st.addNote(n);
        expect(st.commitNoteChange(n, noteState(n))).toBe(false);
        st.undo();
        expect(st.canUndo).toBe(false);
    });

    it("锚点变化可撤销", () => {
        const st = new DocStore("doc");
        const n = mkNote("n1");
        st.addNote(n);
        const before = noteState(n);
        n.anchor = {blockId: "20261108183627-bbbbbbb", ox: 0, oy: 0};
        st.commitNoteChange(n, before);
        st.undo();
        expect(n.anchor?.blockId).toBe("20261108183627-aaaaaaa");
    });

    it("清空一次删掉笔迹和便笺，一次撤销全部恢复", () => {
        const st = new DocStore("doc");
        st.addStroke("pen", {color: "#000", width: 2, opacity: 1, simulate: true}, [{x: 0, y: 0, p: 0.5}, {x: 5, y: 5, p: 0.5}]);
        st.addNote(mkNote("n1"));
        expect(st.clearAll()).toBe(true);
        expect(st.strokes.length + st.notes.length).toBe(0);
        st.undo();
        expect(st.strokes).toHaveLength(1);
        expect(st.notes).toHaveLength(1);
        expect(new DocStore("x").clearAll()).toBe(false);
    });
});

describe("序列化与同步合并", () => {
    it("便笺随载荷往返，锚点只存块 ID", () => {
        const st = new DocStore("doc");
        st.addNote(mkNote("n1", {text: "((20261108183627-r1df30v '方差'))", color: "#2ea8e5"}));
        const payload = JSON.parse(JSON.stringify(st.serialize()));
        expect(payload.notes[0].blockId).toBe("20261108183627-aaaaaaa");
        const back = new DocStore("doc");
        back.adoptPayload(payload);
        expect(back.notes[0]).toEqual(st.notes[0]);
    });

    it("旧载荷没有 notes 字段也能读", () => {
        const st = new DocStore("doc");
        st.adoptPayload({version: 1, docId: "doc", updatedAt: 1, strokes: []});
        expect(st.notes).toEqual([]);
    });

    it("远端便笺按 id 并集合并，本地同 id 优先", () => {
        const local = new DocStore("doc");
        local.addNote(mkNote("n1", {text: "本地"}));
        const remote = new DocStore("doc");
        remote.addNote(mkNote("n1", {text: "远端"}));
        remote.addNote(mkNote("n2", {text: "新"}));
        expect(local.mergeRemote(remote.serialize())).toBe(true);
        expect(local.notes.map((n) => n.text)).toEqual(["本地", "新"]);
        expect(local.mergeRemote(remote.serialize())).toBe(false);
    });
});
