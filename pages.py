# -*- coding: utf-8 -*-
"""
Todoister — in-app guide rendering (Markdown -> styled HTML page).
Split out of server.py 2026-07-08 (mechanical move, no behavior change).
"""
import os

from store import BASE


def md_to_html(md):
    """Minimal Markdown -> HTML for the in-app guide (headings, lists, tables,
    code fences, hr, inline bold/code/links). No external dependency."""
    import re
    import html as _h

    def inline(s):
        s = _h.escape(s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
                   r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
        return s

    lines = md.split("\n")
    n = len(lines)
    out = []
    i = 0
    while i < n:
        line = lines[i]
        if line.strip().startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(_h.escape(lines[i]))
                i += 1
            i += 1
            out.append("<pre><code>" + "\n".join(buf) + "</code></pre>")
            continue
        if re.match(r"^\s*---+\s*$", line):
            out.append("<hr>")
            i += 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            lvl = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (lvl, inline(m.group(2)), lvl))
            i += 1
            continue
        if ("|" in line and i + 1 < n and "-" in lines[i + 1]
                and re.match(r"^\s*\|?[\s:|-]+\|?\s*$", lines[i + 1])):
            header = [c.strip() for c in line.strip().strip("|").split("|")]
            i += 2
            rows = []
            while i < n and "|" in lines[i] and lines[i].strip():
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            th = "".join("<th>%s</th>" % inline(c) for c in header)
            trs = ""
            for r in rows:
                trs += "<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>"
            out.append("<table><thead><tr>%s</tr></thead><tbody>%s</tbody></table>" % (th, trs))
            continue
        if re.match(r"^\s*[-*]\s+", line):
            # Bullet list. A wrapped bullet continues on indented non-bullet
            # lines; a deeper-indented bullet opens a nested <ul> (one level).
            items = []          # top-level items: [text, [sub-items]]
            while i < n and lines[i].strip() and re.match(r"^\s*[-*]\s+", lines[i]) or (i < n and items and lines[i].startswith(" ") and lines[i].strip()):
                cur = lines[i]
                mb = re.match(r"^(\s*)[-*]\s+(.*)$", cur)
                if mb:
                    depth = len(mb.group(1))
                    if depth >= 2 and items:
                        items[-1][1].append(mb.group(2))
                    else:
                        items.append([mb.group(2), []])
                else:                                   # continuation line
                    txt = cur.strip()
                    if items[-1][1]:
                        items[-1][1][-1] += " " + txt
                    else:
                        items[-1][0] += " " + txt
                i += 1
            html_items = []
            for text, subs in items:
                sub = ("<ul>" + "".join("<li>%s</li>" % inline(t) for t in subs) + "</ul>") if subs else ""
                html_items.append("<li>%s%s</li>" % (inline(text), sub))
            out.append("<ul>" + "".join(html_items) + "</ul>")
            continue
        if not line.strip():
            i += 1
            continue
        buf = [line]
        i += 1
        while (i < n and lines[i].strip()
               and "|" not in lines[i]
               and not re.match(r"^(#{1,6}\s|```|\s*[-*]\s|\s*---+\s*$)", lines[i])):
            buf.append(lines[i])
            i += 1
        out.append("<p>" + inline(" ".join(buf)) + "</p>")
    return "\n".join(out)


GUIDE_CSS = """
  :root{--bg:#1e1e1e;--card:#252525;--text:#eee;--dim:#b3b3b3;--line:#4d4d4d;--accent:#dc4c3e;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);
       font-family:-apple-system,'Segoe UI','Noto Sans Georgian',Roboto,sans-serif;
       line-height:1.6;font-size:15px;}
  .wrap{max-width:780px;margin:0 auto;padding:40px 28px 80px;}
  h1{font-size:26px;margin:0 0 8px;} h2{font-size:20px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px;}
  h3{font-size:16px;margin:20px 0 6px;color:var(--dim);}
  a{color:var(--accent);} code{background:var(--card);padding:1px 5px;border-radius:4px;font-size:13px;}
  pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;}
  pre code{background:none;padding:0;}
  ul{padding-left:22px;} li{margin:3px 0;}
  table{border-collapse:collapse;width:100%;margin:10px 0;}
  th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;font-size:14px;}
  th{background:var(--card);}
  hr{border:none;border-top:1px solid var(--line);margin:24px 0;}
  /* same thin scrollbar as the app (the guide renders inside its iframe) */
  ::-webkit-scrollbar{width:10px;height:10px;}
  ::-webkit-scrollbar-thumb{background:#3a3a3a;border-radius:5px;}
  ::-webkit-scrollbar-thumb:hover{background:#4d4d4d;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-corner{background:transparent;}
  *{scrollbar-color:#3a3a3a transparent;scrollbar-width:thin;}
"""


GUIDE_TOPICS = ("program", "sync", "notes", "buddy", "calendar", "calendar-simple", "calendar-full")

def build_guide_page(topic="program", lang="en"):
    """Render one help topic (guide/<topic>.<lang>.md) as a styled HTML page."""
    if topic not in GUIDE_TOPICS:
        topic = "program"
    if lang not in ("en", "ka"):
        lang = "en"
    candidates = [
        os.path.join(BASE, "guide", "%s.%s.md" % (topic, lang)),
        os.path.join(BASE, "guide", "%s.en.md" % topic),
        os.path.join(BASE, "GUIDE.md"),
    ]
    fp = next((p for p in candidates if os.path.isfile(p)), candidates[-1])
    with open(fp, "r", encoding="utf-8") as f:
        md = f.read()
    return ("<!DOCTYPE html><html lang=\"%s\"><head><meta charset=\"UTF-8\">"
            "<title>Todoister — Guide</title><style>%s</style></head>"
            "<body><div class=\"wrap\">%s</div></body></html>"
            % (lang, GUIDE_CSS, md_to_html(md)))
