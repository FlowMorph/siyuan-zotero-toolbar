import {expect, it} from "vitest";
import {blockRefText, parseNoteText} from "../../src/engine/noteText";

const ID = "20261108183627-r1df30v";

it("块引用（单引号/双引号/无标题）", () => {
    expect(parseNoteText(`看 ((${ID} '方差分析')) 这里`)).toEqual([
        {type: "text", text: "看 "},
        {type: "ref", id: ID, label: "方差分析"},
        {type: "text", text: " 这里"},
    ]);
    expect(parseNoteText(`((${ID} "A"))`)).toEqual([{type: "ref", id: ID, label: "A"}]);
    expect(parseNoteText(`((${ID}))`)).toEqual([{type: "ref", id: ID, label: ID}]);
});

it("siyuan:// 链接与 Markdown 链接", () => {
    expect(parseNoteText(`siyuan://blocks/${ID}`)).toEqual([{type: "ref", id: ID, label: `siyuan://blocks/${ID}`}]);
    expect(parseNoteText(`[笔记](siyuan://blocks/${ID})`)).toEqual([{type: "ref", id: ID, label: "笔记"}]);
    expect(parseNoteText("[文档](https://example.com/a)")).toEqual([
        {type: "url", href: "https://example.com/a", label: "文档"},
    ]);
});

it("裸网址去掉句末标点", () => {
    expect(parseNoteText("见 https://example.com/x?a=1。下一句")).toEqual([
        {type: "text", text: "见 "},
        {type: "url", href: "https://example.com/x?a=1", label: "https://example.com/x?a=1"},
        {type: "text", text: "。下一句"},
    ]);
});

it("纯文本和多行原样保留", () => {
    expect(parseNoteText("第一行\n第二行")).toEqual([{type: "text", text: "第一行\n第二行"}]);
    expect(parseNoteText("")).toEqual([]);
});

it("blockRefText 去掉标题里的引号", () => {
    expect(blockRefText(ID, `它'说"好`)).toBe(`((${ID} '它说好'))`);
    expect(blockRefText(ID, "  ")).toBe(`((${ID}))`);
    const [seg] = parseNoteText(blockRefText(ID, "无重复 双因素"));
    expect(seg).toEqual({type: "ref", id: ID, label: "无重复 双因素"});
});
