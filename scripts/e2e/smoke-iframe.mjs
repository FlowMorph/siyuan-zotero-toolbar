/** 第 1 步验证：覆盖层能否盖在 iframe 动画上书写，退出书写模式后动画能否操作。 */
import {check, deploy, launch, openDoc, withPlugin} from "./lib.mjs";

const DOC = process.argv[2] || "20261108183627-r1df30v";
await deploy();
const {browser, page} = await launch();
try {
    await openDoc(page, DOC);
    const iframe = page.locator(".protyle:not(.fn__none) iframe").first();
    await iframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const box = await iframe.boundingBox();
    check("iframe 可见", !!box && box.height > 100, box);

    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const hitOff = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [cx, cy]);
    check("浏览状态下指针落在 iframe 上", hitOff === "IFRAME", hitOff);

    await withPlugin(page, (pl) => pl.toggleMode());
    await page.waitForTimeout(300);
    const hitOn = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [cx, cy]);
    check("书写状态下指针落在捕获层上", String(hitOn).includes("zt-capture"), hitOn);

    await page.mouse.move(cx - 120, cy);
    await page.mouse.down();
    for (let i = 0; i <= 20; i++) await page.mouse.move(cx - 120 + i * 12, cy + Math.sin(i / 2) * 30);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const n = await withPlugin(page, (pl) => pl.activeOverlay.store.strokes.length);
    check("在 iframe 上方画出一笔", n >= 1, n);
    await page.screenshot({path: "/tmp/zt-smoke-on.png"});

    await withPlugin(page, (pl) => pl.toggleMode());
    await page.waitForTimeout(300);
    const frame = await (await iframe.elementHandle()).contentFrame();
    const next = frame.locator("button", {hasText: "下一步"});
    const before = await frame.locator(".dot").evaluateAll((ds) => ds.findIndex((d) => d.className.includes("on")));
    await next.click();
    await page.waitForTimeout(600);
    const after = await frame.locator(".dot").evaluateAll((ds) => ds.findIndex((d) => d.className.includes("on")));
    check("浏览状态下能点动画的「下一步」", after !== before, {before, after});
    await page.screenshot({path: "/tmp/zt-smoke-off.png"});

    // 清掉测试笔迹
    await withPlugin(page, (pl) => { pl.activeOverlay.clearAll(); return pl.flushAll(); });
} finally {
    await browser.close();
}
process.exit(check.summary() ? 0 : 1);
