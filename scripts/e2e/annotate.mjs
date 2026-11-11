/**
 * 端到端验证（真实思源网页端）：形状、便笺、链接、拖入文档/块、持久化、
 * 重排对齐、与 iframe 动画共存。结束时清空本次产生的批注。
 *
 * 用法：node scripts/e2e/annotate.mjs [含 iframe 动画的文档 ID] [被引用的另一篇文档 ID]
 */
import {api, check, deploy, getFile, launch, NAME, openDoc, withPlugin} from "./lib.mjs";

const DOC = process.argv[2] || "20261108183627-r1df30v";
const REF_DOC = process.argv[3] || "20261108183627-qzqrp2s";
const SHOT = "/tmp/zt-e2e";

await deploy();
const {browser, page} = await launch();

const overlayState = () => withPlugin(page, (pl) => {
    const st = pl.activeOverlay.store;
    return {
        docId: pl.activeOverlay.docId,
        strokes: st.strokes.map((s) => ({n: s.points.length, tool: s.tool, color: s.color, anchor: s.anchor?.blockId, pts: s.points})),
        notes: st.notes.map((n) => ({id: n.id, text: n.text, color: n.color, x: n.x, y: n.y, anchor: n.anchor?.blockId})),
    };
});
const tool = async (title) => {
    await page.click(`.zt-toolbar button[title="${title}"]`);
    await page.waitForTimeout(120);
};
const drag = async (from, to, {shift = false, steps = 12} = {}) => {
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    }
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
    await page.waitForTimeout(150);
};
const iconBox = (id) => page.locator(`.zt-note[data-note-id="${id}"]`).boundingBox();
const blockBox = (id) => page.locator(`.protyle[data-e2e-active] .protyle-wysiwyg [data-node-id="${id}"]`).first().boundingBox();
const flush = () => withPlugin(page, (pl) => pl.flushAll());
const setMode = (on) => withPlugin(page, (pl, want) => { if (pl.modeOn !== want) pl.toggleMode(); }, on);

try {
    await openDoc(page, DOC);
    await withPlugin(page, (pl) => { pl.activeOverlay.clearAll(); return pl.flushAll(); });

    const iframe = page.locator(".protyle[data-e2e-active] iframe").first();
    await iframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const fb = await iframe.boundingBox();

    // ---------------------------------------------------------- shapes
    await page.click(".zt-handle");
    await page.waitForTimeout(300);
    check("点笔形按钮进入批注模式", await withPlugin(page, (pl) => pl.modeOn));
    const toast = await page.evaluate(() => document.querySelector("#message")?.textContent || "");
    check("切换模式不弹提示", !toast.includes("批注模式"), toast);
    const titles = await page.locator(".zt-toolbar button").evaluateAll((bs) => bs.map((b) => b.title));
    check("竖排工具栏：Zotero 顺序 + 颜色点 + 撤销/重做/更多/关闭",
        JSON.stringify(titles) === JSON.stringify(["选择", "荧光笔", "钢笔", "形状", "便笺", "橡皮擦", "颜色与粗细", "撤销", "重做", "更多", "收起工具栏"]), titles);
    const isLast = await page.evaluate(() => document.querySelector(".zt-toolbar").lastElementChild.classList.contains("zt-toolbar__drag"));
    check("最底部的 ≡ 是拖动手柄", isLast);
    const tb0 = await page.locator(".zt-toolbar").boundingBox();
    const hb = await page.locator(".zt-toolbar__drag").boundingBox();
    await page.locator(".zt-toolbar__drag").click();
    await page.waitForTimeout(150);
    check("点 ≡ 不弹任何面板", await page.locator(".zt-pop").count() === 0);
    await drag({x: hb.x + hb.width / 2, y: hb.y + hb.height / 2}, {x: hb.x + hb.width / 2 + 120, y: hb.y + hb.height / 2 - 40});
    const tb1 = await page.locator(".zt-toolbar").boundingBox();
    check("拖 ≡ 移动整条工具栏", Math.abs(tb1.x - tb0.x - 120) < 2 && Math.abs(tb1.y - tb0.y + 40) < 2, {tb0, tb1});
    await drag({x: hb.x + hb.width / 2 + 120, y: hb.y + hb.height / 2 - 40}, {x: hb.x + hb.width / 2, y: hb.y + hb.height / 2});
    check("工具栏只有图标没有文字", (await page.locator(".zt-toolbar").innerText()).trim() === "");

    // color dot → secondary popover
    await tool("钢笔");
    await tool("颜色与粗细");
    check("颜色点打开二级面板：8 色 + 粗细", await page.locator(".zt-pop .zt-swatch").count() === 8 &&
        await page.locator(".zt-pop input[type=range]").count() === 1);
    await page.locator(".zt-pop .zt-swatch[title='#2ea8e5']").click();
    await page.waitForTimeout(150);
    check("选色后面板关闭、颜色点更新", await page.locator(".zt-pop").count() === 0 &&
        (await withPlugin(page, (pl) => pl.config.penColor)) === "#2ea8e5" &&
        (await page.locator(".zt-dot").evaluate((d) => getComputedStyle(d).backgroundColor)) === "rgb(46, 168, 229)");
    await tool("颜色与粗细");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    check("Esc 只关二级面板，不退出批注模式", await page.locator(".zt-pop").count() === 0 && await withPlugin(page, (pl) => pl.modeOn));
    await tool("更多");
    const menu = await page.locator(".zt-pop .zt-pop__item").allInnerTexts();
    check("菜单里是导出、清空、设置", menu.length === 3, menu);
    await page.mouse.click(fb.x + fb.width / 2, fb.y - 30);
    await page.waitForTimeout(150);
    check("点别处关闭菜单", await page.locator(".zt-pop").count() === 0);
    await page.screenshot({path: `${SHOT}-toolbar.png`});

    // tapping the active tool again opens its options beside that button
    await tool("选择");
    await tool("钢笔");
    check("第一次点工具只切换、不弹面板", await page.locator(".zt-pop").count() === 0);
    const penBtn = page.locator('.zt-toolbar button[title="钢笔"]');
    const pb0 = await penBtn.boundingBox();
    await penBtn.click();
    await page.waitForTimeout(150);
    const pop0 = await page.locator(".zt-pop").boundingBox().catch(() => null);
    check("再点当前工具在原位弹出二级面板", !!pop0 && await page.locator(".zt-pop .zt-swatch").count() === 8 &&
        Math.abs((pop0.y + pop0.height / 2) - (pb0.y + pb0.height / 2)) < pop0.height / 2, {pop0, pb0});
    await page.locator(".zt-pop input[type=range]").fill("8");
    await page.waitForTimeout(100);
    check("调粗细后面板仍在原位", await page.locator(".zt-pop").count() === 1);
    await penBtn.click();
    await page.waitForTimeout(150);
    check("第三次点同一工具收起面板", await page.locator(".zt-pop").count() === 0);
    await tool("选择");
    await tool("选择");
    check("选择工具再点不弹面板", await page.locator(".zt-pop").count() === 0);

    const shapeKind = async (title) => {
        await tool("颜色与粗细");
        await page.click(`.zt-pop button[title="${title}"]`);
        await page.waitForTimeout(100);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(100);
    };
    await tool("形状");
    await shapeKind("矩形");
    await drag({x: fb.x + 70, y: fb.y + 55}, {x: fb.x + 230, y: fb.y + 175});
    await shapeKind("椭圆");
    await drag({x: fb.x + 320, y: fb.y + 60}, {x: fb.x + 470, y: fb.y + 160});
    await shapeKind("箭头");
    await drag({x: fb.x + 470, y: fb.y + 230}, {x: fb.x + 300, y: fb.y + 190});
    await shapeKind("直线");
    await drag({x: fb.x + 60, y: fb.y + 250}, {x: fb.x + 260, y: fb.y + 262}, {shift: true});
    let s = await overlayState();
    check("画出 4 个形状", s.strokes.length === 4, s.strokes.length);
    check("矩形 5 点、椭圆 65 点、箭头 5 点、直线 2 点",
        JSON.stringify(s.strokes.map((x) => x.n)) === JSON.stringify([5, 65, 5, 2]), s.strokes.map((x) => x.n));
    const line = s.strokes[3]?.pts ?? [];
    check("Shift 让直线保持水平", line.length === 2 && Math.abs(line[0].y - line[1].y) < 0.01, line);
    check("形状锚定在 iframe 所在块上", s.strokes.every((x) => x.anchor), s.strokes.map((x) => x.anchor));

    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(150);
    check("撤销去掉最后一个形状", (await overlayState()).strokes.length === 3);
    await page.keyboard.press("Meta+Shift+z");
    await page.waitForTimeout(150);
    check("重做恢复形状", (await overlayState()).strokes.length === 4);

    // ---------------------------------------------------------- sticky note
    await tool("便笺");
    const para = page.locator(".protyle[data-e2e-active] .protyle-wysiwyg [data-type='NodeParagraph']", {hasText: "动画用本篇例子"}).first();
    const pb = await para.boundingBox();
    await page.mouse.click(pb.x + pb.width - 30, pb.y + 12);
    await page.waitForTimeout(250);
    s = await overlayState();
    check("点击页面放下一个便笺", s.notes.length === 1, s.notes);
    const noteId = s.notes[0]?.id;
    const focused = await page.evaluate(() => document.activeElement?.className);
    check("新便笺直接进入编辑", String(focused).includes("zt-note-popup__input"), focused);
    const text = `复习时对比 ((${REF_DOC} '13 交互作用')) 和 https://example.com/anova`;
    await page.keyboard.insertText(text);
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(200);
    s = await overlayState();
    check("便笺文字已保存", s.notes[0]?.text === text, s.notes[0]);
    const links = await page.locator(".zt-note-popup .zt-note-link").evaluateAll((as) => as.map((a) => a.className + "|" + a.textContent));
    check("块引用和网址渲染为链接", links.length === 2 && links[0].includes("--ref|13 交互作用") && links[1].includes("--url|"), links);
    check("便笺锚定到所在段落", s.notes[0]?.anchor === (await para.getAttribute("data-node-id")), s.notes[0]);

    await page.locator(".zt-note-popup__swatch[title='#2ea8e5']").click();
    await page.waitForTimeout(150);
    check("在弹窗里换颜色", (await overlayState()).notes[0]?.color === "#2ea8e5");
    await page.screenshot({path: `${SHOT}-annotated.png`});

    // ---------------------------------------------------------- browse mode
    await setMode(false);
    await page.waitForTimeout(250);
    check("退出批注模式后便笺仍在", await page.locator(`.zt-note[data-note-id="${noteId}"]`).isVisible());
    const frame = await (await iframe.elementHandle()).contentFrame();
    const dotIdx = () => frame.locator(".dot").evaluateAll((ds) => ds.findIndex((d) => d.className.includes("on")));
    const before = await dotIdx();
    await frame.locator("button", {hasText: "下一步"}).click();
    await page.waitForTimeout(500);
    check("形状盖在动画上时，浏览状态仍能点「下一步」", (await dotIdx()) !== before);

    // click elsewhere closes the popup
    await page.mouse.click(8, 450);
    await page.waitForTimeout(150);
    check("点别处关闭便笺弹窗", !(await page.locator(".zt-note-popup").isVisible().catch(() => false)));

    // drag the note in browse mode, then undo
    // the animation may still be resizing its iframe (content shifts) — compare
    // against the anchor block rather than raw screen positions
    let ib = await iconBox(noteId);
    const startState = (await overlayState()).notes[0];
    const relTo = async (blockId) => {
        const a = await iconBox(noteId), b = await blockBox(blockId);
        return {x: a.x - b.x, y: a.y - b.y};
    };
    const rel0 = await relTo(startState.anchor);
    check("动画改变 iframe 高度后便笺仍贴着锚定块",
        Math.abs(rel0.x - startState.x) < 1.5 && Math.abs(rel0.y - startState.y) < 1.5, {rel0, startState});
    await drag({x: ib.x + 11, y: ib.y + 11}, {x: ib.x + 11 - 160, y: ib.y + 11 + 50});
    const moved = (await overlayState()).notes[0];
    const rel1 = await relTo(startState.anchor);
    check("浏览状态下可拖动便笺", Math.abs(rel1.x - rel0.x + 160) < 2 && Math.abs(rel1.y - rel0.y - 50) < 2,
        {rel0, rel1, startState, moved});
    check("拖动不会打开弹窗", !(await page.locator(".zt-note-popup").isVisible().catch(() => false)));
    await withPlugin(page, (pl) => pl.activeOverlay.undo());
    await page.waitForTimeout(250);
    ib = await iconBox(noteId);
    const undone = (await overlayState()).notes[0];
    check("撤销拖动回到原位", undone.x === startState.x && undone.y === startState.y && undone.anchor === startState.anchor, {undone, startState});

    // open the popup in browse mode and follow the block ref
    await page.mouse.click(ib.x + 11, ib.y + 11);
    await page.waitForTimeout(200);
    check("浏览状态下点便笺打开弹窗", await page.locator(".zt-note-popup").isVisible());
    const floatMode = await page.evaluate(() => window.siyuan.config.editor.floatWindowMode);
    await page.locator(".zt-note-popup .zt-note-link--ref").hover();
    await page.mouse.move((await page.locator(".zt-note-popup .zt-note-link--ref").boundingBox()).x + 6,
        (await page.locator(".zt-note-popup .zt-note-link--ref").boundingBox()).y + 6);
    await page.waitForTimeout(1500);
    if (floatMode === 0) check("悬停块引用弹出思源的预览", await page.locator(".block__popover").count() > 0);
    else console.log(`SKIP 悬停预览（思源设置为 floatWindowMode=${floatMode}，不是悬停触发）`);
    await page.mouse.move(8, 450);
    await page.waitForTimeout(300);
    await page.locator(".zt-note-popup .zt-note-link--ref").click();
    await page.waitForFunction((id) => window.siyuan.ws.app.plugins.find((p) => p.name === "siyuan-zotero-toolbar")
        .activeOverlay?.docId === id, REF_DOC, {timeout: 10000}).catch(() => {});
    check("点块引用打开被引用的文档", (await withPlugin(page, (pl) => pl.activeOverlay?.docId)) === REF_DOC);

    // ---------------------------------------------------------- persistence
    await flush();
    const anchorId = startState.anchor;
    await openDoc(page, DOC);
    await page.locator(`.zt-note[data-note-id="${noteId}"]`).waitFor({state: "attached", timeout: 8000});
    s = await overlayState();
    check("重新打开后形状和便笺都在", s.strokes.length === 4 && s.notes.length === 1 && s.notes[0].text === text,
        {strokes: s.strokes.length, notes: s.notes});
    const file = await getFile(`/data/storage/petal/${NAME}/${DOC}.json`);
    check("便笺写进插件存储文件", file.includes(noteId) && file.includes('"notes"'), file.slice(0, 200));

    // reflow: icon must keep its offset to the anchor block
    await page.locator(`.protyle[data-e2e-active] .protyle-wysiwyg [data-node-id="${anchorId}"]`).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    check("滚到锚定块后便笺可见", await page.locator(`.zt-note[data-note-id="${noteId}"]`).isVisible());
    // reflow can push the block out of view (note then hidden) — bring it back first
    const rel = async () => {
        await page.locator(`.protyle[data-e2e-active] .protyle-wysiwyg [data-node-id="${anchorId}"]`).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const a = await iconBox(noteId), b = await blockBox(anchorId);
        return {dx: a.x - b.x, dy: a.y - b.y};
    };
    const r1 = await rel();
    await page.setViewportSize({width: 1000, height: 900});
    await page.waitForTimeout(1200);
    const r2 = await rel();
    const content = await page.locator(".protyle[data-e2e-active] .protyle-content").boundingBox();
    const narrow = await iconBox(noteId);
    check("窗口变窄后便笺仍贴着锚定块的纵向位置", Math.abs(r1.dy - r2.dy) < 2, {r1, r2});
    check("窗口变窄后便笺不会跑出正文区域", narrow && narrow.x >= content.x && narrow.x + 22 <= content.x + content.width + 0.5,
        {narrow, content});
    await page.setViewportSize({width: 1440, height: 900});
    await page.waitForTimeout(1200);
    const r3 = await rel();
    check("窗口恢复后便笺回到原位", Math.abs(r1.dx - r3.dx) < 2 && Math.abs(r1.dy - r3.dy) < 2, {r1, r3});

    // ---------------------------------------------------------- drops
    await setMode(true);
    await page.waitForTimeout(250);
    const heading = await page.evaluate(() => document.querySelector(".protyle[data-e2e-active] .protyle-wysiwyg [data-type='NodeHeading']")?.dataset.nodeId);
    const dropAt = async (types) => {
        const pb2 = await para.boundingBox();
        await page.evaluate(([t, x, y]) => {
            const dt = new DataTransfer();
            for (const [k, v] of Object.entries(t)) dt.setData(k, v);
            const target = document.elementFromPoint(x, y);
            for (const type of ["dragenter", "dragover", "drop"]) {
                target.dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt}));
            }
        }, [types, pb2.x + 40, pb2.y + 30]);
        await page.waitForTimeout(800);
    };
    await dropAt({"application/siyuan-file": REF_DOC, "application/siyuan-documents": JSON.stringify({ids: [REF_DOC]})});
    s = await overlayState();
    check("从文档树拖入文档生成链接便笺", s.notes.length === 2 && s.notes[1].text === `((${REF_DOC} '13 交互作用'))`, s.notes);
    await dropAt({[`application/siyuan-gutternodeheading\u200bh3\u200b${heading}\u200b/ws`]: "{}"});
    s = await overlayState();
    check("拖入块生成链接便笺", s.notes.length === 3 && s.notes[2].text.startsWith(`((${heading} '`), s.notes);
    const docLen = await page.evaluate(() => document.querySelectorAll(".protyle[data-e2e-active] .protyle-wysiwyg [data-node-id]").length);
    await page.waitForTimeout(300);
    check("拖入不会改动正文", docLen === await page.evaluate(() => document.querySelectorAll(".protyle[data-e2e-active] .protyle-wysiwyg [data-node-id]").length));
    await page.screenshot({path: `${SHOT}-drop.png`});
} finally {
    await withPlugin(page, (pl) => { pl.activeOverlay?.clearAll(); return pl.flushAll(); }).catch(() => {});
    await api("/api/file/removeFile", {path: `/data/storage/petal/${NAME}/${DOC}.json`}).catch(() => {});
    await browser.close();
}
process.exit(check.summary() ? 0 : 1);
