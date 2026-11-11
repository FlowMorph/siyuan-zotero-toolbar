/**
 * 端到端测试公共工具：部署插件到思源工作空间、启用插件，
 * 用 playwright-core 驱动本机 Chrome 打开思源网页端（与桌面端共用同一内核）。
 *
 * 环境变量：
 *   SIYUAN_WORKSPACE  工作空间目录，默认 ~/SiYuan
 *   SIYUAN_BASE       内核地址，默认 http://127.0.0.1:6806
 *   CHROME_PATH       Chrome 可执行文件，默认 macOS 安装位置
 *   HEADED=1          显示浏览器窗口
 */
import {execSync} from "node:child_process";
import {cpSync, mkdirSync, readFileSync, readdirSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const NAME = "siyuan-zotero-toolbar";
export const WORKSPACE = process.env.SIYUAN_WORKSPACE || join(homedir(), "SiYuan");
export const BASE = process.env.SIYUAN_BASE || "http://127.0.0.1:6806";
const CHROME = process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const token = () =>
    JSON.parse(readFileSync(join(WORKSPACE, "conf", "conf.json"), "utf8")).api.token;

export async function api(path, body = {}) {
    const res = await fetch(BASE + path, {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Token ${token()}`},
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(`${path}: ${json.msg}`);
    return json.data;
}

/** 读工作空间文件原文（getFile 直接返回文件内容，不带 {code} 包装） */
export async function getFile(path) {
    const res = await fetch(BASE + "/api/file/getFile", {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Token ${token()}`},
        body: JSON.stringify({path}),
    });
    return res.text();
}

/** 构建并复制到 data/plugins/<NAME>，再通过内核启用 */
export async function deploy({build = true} = {}) {
    if (build) execSync("npm run build", {cwd: ROOT, stdio: "inherit"});
    const target = join(WORKSPACE, "data", "plugins", NAME);
    mkdirSync(target, {recursive: true});
    const buildDir = join(ROOT, "build");
    for (const entry of readdirSync(buildDir)) {
        cpSync(join(buildDir, entry), join(target, entry), {recursive: true});
    }
    await api("/api/petal/setPetalEnabled", {packageName: NAME, enabled: true, app: "e2e"});
}

export async function launch() {
    const browser = await chromium.launch({executablePath: CHROME, headless: !process.env.HEADED});
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    page.on("console", (m) => {
        if (m.type() === "error" || m.text().includes("[zotero-toolbar]")) console.log(`[console.${m.type()}]`, m.text());
    });
    return {browser, page};
}

/** 打开思源网页端并跳到指定文档，等插件挂上覆盖层 */
export async function openDoc(page, docId) {
    await page.goto(`${BASE}/stage/build/desktop/?id=${docId}`);
    // restored tabs attach overlays too — wait for the visible one of this doc
    // and make it the active overlay
    await page.waitForFunction(([name, id]) => {
        const pl = window.siyuan?.ws?.app?.plugins?.find((p) => p.name === name);
        const ov = pl && [...pl.overlays.values()].find((o) =>
            o.docId === id && !o.protyle.element.closest(".fn__none") &&
            o.protyle.element.querySelector(".protyle-wysiwyg [data-node-id]"));
        if (ov) {
            pl.activeOverlay = ov;
            document.querySelectorAll("[data-e2e-active]").forEach((el) => el.removeAttribute("data-e2e-active"));
            ov.protyle.element.dataset.e2eActive = "1";
        }
        return !!ov;
    }, [NAME, docId], {timeout: 30000});
    await page.waitForTimeout(800);
}

/** 当前测试文档所在编辑器（openDoc 打的标记） */
export const ACTIVE = ".protyle[data-e2e-active]";

/** 在页面里对插件实例求值：fn(plugin, arg) */
export const withPlugin = (page, fn, arg) =>
    page.evaluate(([src, a, name]) => {
        const pl = window.siyuan.ws.app.plugins.find((p) => p.name === name);
        return (0, eval)(`(${src})`)(pl, a);
    }, [fn.toString(), arg, NAME]);

export const check = (() => {
    let pass = 0, fail = 0;
    const fn = (name, cond, extra) => {
        if (cond) { pass++; console.log("PASS", name); }
        else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra)); }
    };
    fn.summary = () => {
        console.log(`[total] ${pass} passed, ${fail} failed`);
        return fail === 0;
    };
    return fn;
})();
