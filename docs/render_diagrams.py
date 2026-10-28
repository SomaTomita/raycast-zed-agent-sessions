"""Renders the diagrams embedded in README.md.

Run from the repository root:

    uv run --with graphviz --python 3.12 docs/render_diagrams.py

Requires Graphviz (`brew install graphviz`). Every box holds its own label, so nothing has to be
squeezed under an icon and the text stays readable at README width.
"""

from pathlib import Path

from graphviz import Digraph

INK = "#1F2328"
BLUE = "#2F6FB3"
ORANGE = "#C4622D"
GREY = "#8B949E"

FILL_START = "#E9F7D0"
FILL_CHOICE = "#FDEBCB"
FILL_STEP = "#D8F3F7"
FILL_DATA = "#E6E3FF"
FILL_READ = "#DCEBFA"
FILL_ACT = "#FBE3D3"
FILL_GROUP = "#F6F8FA"

# A solid background: GitHub shows these images unchanged, and dark ink on a transparent
# background is unreadable in dark mode.
GRAPH_ATTR = {
    "bgcolor": "#FFFFFF",
    "fontcolor": INK,
    "fontname": "Helvetica",
    "fontsize": "15",
    "pad": "0.3",
    "nodesep": "0.45",
    "ranksep": "0.55",
    "dpi": "110",
}
NODE_ATTR = {
    "fontcolor": INK,
    "fontname": "Helvetica",
    "fontsize": "12",
    "style": "filled",
    "color": GREY,
    "margin": "0.18,0.1",
}
EDGE_ATTR = {"fontcolor": INK, "fontname": "Helvetica", "fontsize": "11"}


def chart(title: str, filename: str, rankdir: str = "TB") -> Digraph:
    return Digraph(
        filename,
        format="png",
        graph_attr={**GRAPH_ATTR, "label": title, "labelloc": "b", "rankdir": rankdir},
        node_attr=NODE_ATTR,
        edge_attr=EDGE_ATTR,
    )


def write(diagram: Digraph) -> None:
    """Writes the PNG exactly at <filename>.png; `render()` would name it <filename>.gv.png."""
    Path(f"{diagram.name}.png").write_bytes(diagram.pipe(format="png"))


def pill(diagram: Digraph, key: str, label: str) -> None:
    diagram.node(key, label, shape="box", style="rounded,filled", fillcolor=FILL_START)


def choice(diagram: Digraph, key: str, label: str) -> None:
    diagram.node(key, label, shape="diamond", fillcolor=FILL_CHOICE, margin="0.05,0.05")


def step(diagram: Digraph, key: str, label: str) -> None:
    diagram.node(key, label, shape="box", fillcolor=FILL_STEP)


def link(diagram: Digraph, src: str, dst: str, label: str = "", color: str = BLUE) -> None:
    diagram.edge(src, dst, label=f" {label} " if label else "", color=color, fontcolor=INK)


def group(name: str, title: str) -> Digraph:
    sub = Digraph(name=f"cluster_{name}")
    sub.attr(label=title, style="rounded,filled", color=GREY, fillcolor=FILL_GROUP, fontname="Helvetica", fontsize="13")
    return sub


def architecture() -> None:
    """One box per responsibility, not per file."""
    # Top to bottom keeps the picture close to square; left to right is three times as wide as tall.
    diagram = chart("Raycast Zed Agent Sessions", "docs/architecture", rankdir="TB")
    diagram.graph_attr.update({"nodesep": "0.35", "ranksep": "0.6", "newrank": "true"})

    data = group("data", "Local data (read-only)")
    data.node("claude_files", "Claude Code\n~/.claude sessions,\nprojects, history", shape="cylinder", fillcolor=FILL_DATA)
    data.node("claude_cli", "claude agents\n--all --json", shape="box", fillcolor=FILL_STEP)
    data.node("codex_files", "Codex\n~/.codex catalog,\nrollout files", shape="cylinder", fillcolor=FILL_DATA)
    data.node("processes", "ps and lsof\nprocess table", shape="box", fillcolor=FILL_STEP)
    data.node("zed_db", "Zed workspace DB\n(Stable)", shape="cylinder", fillcolor=FILL_DATA)
    diagram.subgraph(data)

    read = group("read", "Read layer")
    read.node("claude_readers", "registry, agents,\ntranscript, prompts", shape="box", fillcolor=FILL_READ)
    read.node("codex_readers", "providers/codex,\ncodex-live, codex-activity", shape="box", fillcolor=FILL_READ)
    read.node("host", "host, process-age\nhost and pid identity", shape="box", fillcolor=FILL_READ)
    read.node("merge", "sessions, session-status\nmerge and state", shape="box", fillcolor=FILL_READ)
    diagram.subgraph(read)

    step(diagram, "ui", "Raycast command\nsessions.tsx\nsession-actions.tsx")

    act = group("act", "Action layer")
    act.node("goto", "goto, focus", shape="box", fillcolor=FILL_ACT)
    act.node("resolver", "zed-workspaces, zed-targets\npath resolver", shape="box", fillcolor=FILL_READ)
    act.node("windows", "windows, native-zed\nAccessibility, JXA", shape="box", fillcolor=FILL_ACT)
    act.node("resume", "resume, resume-spec", shape="box", fillcolor=FILL_ACT)
    diagram.subgraph(act)

    targets = group("targets", "Targets")
    for key, label in (("editor", "Zed window"), ("terminal", "Terminal / iTerm2"), ("clipboard", "Clipboard")):
        targets.node(key, label, shape="box", style="rounded,filled", fillcolor=FILL_START)
    diagram.subgraph(targets)

    link(diagram, "claude_files", "claude_readers")
    link(diagram, "claude_cli", "claude_readers", "45 s cache")
    link(diagram, "codex_files", "codex_readers")
    link(diagram, "processes", "host")
    link(diagram, "host", "claude_readers")
    link(diagram, "host", "codex_readers")
    link(diagram, "claude_readers", "merge")
    link(diagram, "codex_readers", "merge")
    link(diagram, "merge", "ui", "30 s / refresh")

    link(diagram, "ui", "goto", color=ORANGE)
    link(diagram, "zed_db", "resolver")
    link(diagram, "resolver", "windows")
    link(diagram, "goto", "windows", color=ORANGE)
    link(diagram, "goto", "resume", "nothing hosts it", ORANGE)
    link(diagram, "windows", "editor", color=ORANGE)
    link(diagram, "resume", "clipboard", "copy", ORANGE)
    link(diagram, "resume", "terminal", "explicit", ORANGE)
    write(diagram)


def reaching_a_live_session() -> None:
    """↩ on a row whose process is alive. See goToSession() in src/lib/goto.ts.

    Claude Code and Codex rows take the same path. Live jump is designed for Zed; VS Code and
    Cursor are not considered here.
    """
    diagram = chart("↩ · reaching a live session", "docs/flow-live")
    pill(diagram, "start", "live session\n(Claude Code or Codex)")
    choice(diagram, "host", "what hosts it?")
    step(diagram, "tab", "select the tab\nwhose tty matches")
    choice(diagram, "window", "exactly one Zed window\nmatches the directory?")
    step(diagram, "raise", "raise it with Accessibility,\nconfirm the focused title\n(Window menu as fallback)")
    step(diagram, "activate", "activate the host pid\n(never launches)")
    pill(diagram, "nohost", "no GUI host (tmux, ssh):\nthe resume flow applies")

    link(diagram, "start", "host")
    link(diagram, "host", "tab", "iTerm2 / Terminal")
    link(diagram, "host", "window", "Zed")
    link(diagram, "host", "activate", "another GUI app", GREY)
    link(diagram, "host", "nohost", "no GUI host", GREY)
    link(diagram, "tab", "activate", "no tab on that tty", ORANGE)
    link(diagram, "window", "raise", "yes")
    link(diagram, "window", "activate", "none, several or unreadable", ORANGE)
    write(diagram)


def resuming_a_session() -> None:
    """↩ on a row nothing can reach. See primary() in components/session-actions.tsx.

    No process is ever terminated, and no keystroke or paste is sent to Zed.
    """
    diagram = chart("↩ · nothing hosts it", "docs/flow-resume")
    pill(diagram, "history", "history row:\nno process, only a transcript")
    step(diagram, "copy", "copy the resume command\n(paste it into the project's\nZed terminal yourself)")
    pill(diagram, "stuck", "live row with no GUI host\n(tmux, ssh)")
    choice(diagram, "window", "exactly one Zed window\nmatches the directory?")
    step(diagram, "raise", "raise it")
    step(diagram, "new", "open one\n(zed --new)")
    step(diagram, "report", "report it and open nothing;\nthe copied command stays")

    link(diagram, "history", "copy", color=ORANGE)
    link(diagram, "copy", "window", color=ORANGE)
    link(diagram, "stuck", "window", color=ORANGE)
    link(diagram, "window", "raise", "yes")
    link(diagram, "window", "new", "none", ORANGE)
    link(diagram, "window", "report", "several or unknown", GREY)

    pill(diagram, "job", "background agent row:\nclaude --bg job")
    step(diagram, "attach", "copy\nclaude attach <id>")
    link(diagram, "job", "attach", color=GREY)

    pill(diagram, "stopped", "explicit action:\nResume in Terminal / iTerm2\n(stopped sessions only)")
    choice(diagram, "recheck", "ownership confirmed\nas stopped?")
    step(diagram, "terminal", "claude --resume / codex resume\nin a new terminal window")
    step(diagram, "refuse", "refuse")
    link(diagram, "stopped", "recheck", color=ORANGE)
    link(diagram, "recheck", "terminal", "yes")
    link(diagram, "recheck", "refuse", "live or unknown", ORANGE)
    write(diagram)


if __name__ == "__main__":
    architecture()
    reaching_a_live_session()
    resuming_a_session()
    print("wrote docs/architecture.png, docs/flow-live.png, docs/flow-resume.png")
