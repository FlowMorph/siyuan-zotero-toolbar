/**
 * Sticky-note text is plain text with links recognised on display:
 *   ((20240101120000-abcdefg 'title'))   SiYuan block ref (the "copy block ref" format)
 *   siyuan://blocks/20240101120000-abcdefg
 *   [label](https://… or siyuan://blocks/…)
 *   https://…  bare URLs
 */

export type NoteSegment =
    | {type: "text"; text: string}
    | {type: "ref"; id: string; label: string}
    | {type: "url"; href: string; label: string};

const BLOCK_ID = String.raw`\d{14}-[0-9a-z]{7}`;
const SIYUAN_URL = new RegExp(String.raw`^siyuan://blocks/(${BLOCK_ID})`);

const PATTERN = new RegExp([
    // 1: md label, 2: md href
    String.raw`\[([^\]\n]+)\]\(((?:https?|siyuan)://[^\s)]+)\)`,
    // 3: ref id, 4/5: quoted title
    String.raw`\(\((${BLOCK_ID})(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'))?\)\)`,
    // 6: bare siyuan link or url
    String.raw`((?:siyuan://blocks/${BLOCK_ID})|https?://[^\s<>"')\]\u0080-\uffff]+)`,
].join("|"), "g");

/** trailing punctuation is almost always sentence text, not part of the URL
 *  (bare URLs also stop at non-ASCII: real URLs percent-encode it) */
const TRAILING = /[.,;:!?。，；：！？、]+$/;

const linkFor = (href: string, label: string): NoteSegment => {
    const m = SIYUAN_URL.exec(href);
    return m ? {type: "ref", id: m[1], label} : {type: "url", href, label};
};

export const parseNoteText = (text: string): NoteSegment[] => {
    const out: NoteSegment[] = [];
    const pushText = (t: string) => {
        if (!t) return;
        const last = out[out.length - 1];
        if (last?.type === "text") last.text += t;
        else out.push({type: "text", text: t});
    };
    let pos = 0;
    for (const m of text.matchAll(PATTERN)) {
        const start = m.index ?? 0;
        pushText(text.slice(pos, start));
        let raw = m[0];
        if (m[1] !== undefined) {
            out.push(linkFor(m[2], m[1]));
        } else if (m[3] !== undefined) {
            out.push({type: "ref", id: m[3], label: m[4] ?? m[5] ?? m[3]});
        } else {
            const trail = TRAILING.exec(raw)?.[0] ?? "";
            raw = raw.slice(0, raw.length - trail.length);
            out.push(linkFor(raw, raw));
            pushText(trail);
            raw += trail;
        }
        pos = start + raw.length;
    }
    pushText(text.slice(pos));
    return out;
};

/** block ref in SiYuan's own "copy block ref" format; quotes in the title are dropped */
export const blockRefText = (id: string, title: string) => {
    const clean = title.replace(/['"\n\r]/g, "").trim();
    return clean ? `((${id} '${clean}'))` : `((${id}))`;
};
