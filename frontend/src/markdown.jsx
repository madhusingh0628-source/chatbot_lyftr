// Small, dependency-free Markdown renderer for chat replies.
// Everything is rendered as React elements (never innerHTML), so model output can't inject HTML.
import { memo, useState } from "react";
import { Icon } from "./icons.jsx";
import { copyText } from "./utils.js";

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

const INLINE_SOURCE = [
  "(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)",                       // 1,2  `code`
  "\\[([^\\]\\n]+)\\]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)",        // 3,4  [text](url)
  "(https?:\\/\\/[^\\s<>()]+[^\\s<>().,:;\"'!?\\]*_])",         // 5    bare URL
  "\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*",                          // 6    **bold**
  "__(?=\\S)([\\s\\S]*?\\S)__(?!\\w)",                          // 7    __bold__
  "~~(?=\\S)([\\s\\S]*?\\S)~~",                                  // 8    ~~strike~~
  "(?<![\\w*])\\*(?=[^\\s*])([^*\\n]*?[^\\s*])\\*(?![\\w*])",    // 9    *italic*
  "(?<![\\w_])_(?=[^\\s_])([^_\\n]*?[^\\s_])_(?![\\w_])",        // 10   _italic_
].join("|");

function renderInline(str, kp = "i") {
  const out = [];
  const re = new RegExp(INLINE_SOURCE, "g");
  let last = 0;
  let n = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) out.push(str.slice(last, m.index));
    const k = `${kp}.${n++}`;
    if (m[1]) {
      out.push(<code key={k} className="inline-code">{m[2]}</code>);
    } else if (m[3] !== undefined) {
      out.push(SAFE_URL.test(m[4])
        ? <a key={k} href={m[4]} target="_blank" rel="noopener noreferrer">{renderInline(m[3], k)}</a>
        : m[0]);
    } else if (m[5]) {
      out.push(<a key={k} href={m[5]} target="_blank" rel="noopener noreferrer">{m[5]}</a>);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      out.push(<strong key={k}>{renderInline(m[6] ?? m[7], k)}</strong>);
    } else if (m[8] !== undefined) {
      out.push(<del key={k}>{renderInline(m[8], k)}</del>);
    } else {
      out.push(<em key={k}>{renderInline(m[9] ?? m[10], k)}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}

/* ---------- block parsing ---------- */

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
const isBlank = (line) => !line.trim();
const isTableStart = (lines, i) =>
  lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-");

function startsBlock(lines, i) {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || isTableStart(lines, i);
}

function splitRow(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseList(lines, i) {
  const first = lines[i].match(LIST);
  const baseIndent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : null;
  const items = [];
  let contentIndent = baseIndent + first[2].length + 1;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(LIST);
    if (m && indentOf(m[1]) <= baseIndent + 1) {
      if (/\d/.test(m[2]) !== ordered) break;           // different list type -> new list
      contentIndent = indentOf(m[1]) + m[2].length + 1;
      items.push([m[3]]);
      i++;
      continue;
    }
    if (isBlank(line)) {
      // a blank line between items (very common in LLM output) does NOT end the list
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j >= lines.length) break;
      const next = lines[j].match(LIST);
      const sameLevelItem = next && indentOf(next[1]) <= baseIndent + 1 && /\d/.test(next[2]) === ordered;
      if (sameLevelItem || indentOf(lines[j]) > baseIndent) {
        items[items.length - 1].push("");
        i = j;
        continue;
      }
      break;
    }
    if (indentOf(line) > baseIndent) {                   // continuation / nested list
      const strip = Math.min(indentOf(line), contentIndent);
      items[items.length - 1].push(line.replace(/\t/g, "    ").slice(strip));
      i++;
      continue;
    }
    if (startsBlock(lines, i)) break;
    items[items.length - 1].push(line.trim());           // lazy continuation
    i++;
  }
  return {
    block: { type: "list", ordered, start, items: items.map((itemLines) => parseBlocks(itemLines.join("\n"))) },
    next: i,
  };
}

export function parseBlocks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      const body = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
      i++; // skip closing fence (or run off the end of an unclosed one)
      blocks.push({ type: "code", lang: fence[2] || "", code: body.join("\n").replace(/\s+$/, "") });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (HR.test(line)) { blocks.push({ type: "hr" }); i++; continue; }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ""));
      blocks.push({ type: "quote", children: parseBlocks(body.join("\n")) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : undefined);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    if (LIST.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const para = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) para.push(lines[i++].trim());
    blocks.push({ type: "p", lines: para });
  }
  return blocks;
}

/* ---------- rendering ---------- */

function CodeBlock({ lang, code }) {
  const [state, setState] = useState("idle");
  const [wrap, setWrap] = useState(false);
  const lineCount = code.split("\n").length;

  async function handleCopy() {
    const ok = await copyText(code);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{lang || "code"}{lineCount > 1 && <span className="code-lines"> · {lineCount} lines</span>}</span>
        <div className="code-actions">
          <button
            type="button"
            className={`code-btn ${wrap ? "on" : ""}`}
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            title={wrap ? "Don't wrap long lines" : "Wrap long lines"}
          >
            <Icon name="wrap" size={13} /> <span>Wrap</span>
          </button>
          <button type="button" className="code-btn" onClick={handleCopy} aria-live="polite">
            <Icon name={state === "copied" ? "check" : "copy"} size={13} />
            <span>{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
          </button>
        </div>
      </div>
      <pre className={`code-content ${wrap ? "wrap" : ""}`} tabIndex={0}><code>{code}</code></pre>
    </div>
  );
}

function Blocks({ blocks, kp = "b" }) {
  return blocks.map((b, idx) => {
    const k = `${kp}-${idx}`;
    switch (b.type) {
      case "code":
        return <CodeBlock key={k} lang={b.lang} code={b.code} />;
      case "heading": {
        const Tag = `h${Math.min(6, b.level + 1)}`;   // h1 in a reply -> h2 on the page
        return <Tag key={k} className={`md-h md-h${b.level}`}>{renderInline(b.text, k)}</Tag>;
      }
      case "hr":
        return <hr key={k} className="md-hr" />;
      case "quote":
        return <blockquote key={k} className="md-quote"><Blocks blocks={b.children} kp={k} /></blockquote>;
      case "table":
        return (
          <div key={k} className="md-table-wrap" tabIndex={0}>
            <table className="md-table">
              <thead>
                <tr>{b.header.map((c, j) => <th key={j} style={{ textAlign: b.align[j] }}>{renderInline(c, `${k}h${j}`)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {b.header.map((_, j) => <td key={j} style={{ textAlign: b.align[j] }}>{renderInline(row[j] ?? "", `${k}r${r}c${j}`)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "list": {
        const Tag = b.ordered ? "ol" : "ul";
        return (
          <Tag key={k} className="md-list" start={b.ordered && b.start !== 1 ? b.start : undefined}>
            {b.items.map((item, j) => <li key={j}><Blocks blocks={item} kp={`${k}.${j}`} /></li>)}
          </Tag>
        );
      }
      default:
        return (
          <p key={k} className="md-p">
            {b.lines.map((l, j) => (
              <span key={j}>{j > 0 && <br />}{renderInline(l, `${k}.${j}`)}</span>
            ))}
          </p>
        );
    }
  });
}

export const MarkdownView = memo(function MarkdownView({ content }) {
  if (!content) return null;
  return <div className="markdown-body"><Blocks blocks={parseBlocks(content)} /></div>;
});
