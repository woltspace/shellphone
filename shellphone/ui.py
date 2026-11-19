"""How the shellphone command looks in a terminal: one console, the room's own colours, a few small pieces.
Only the command's own screens use this (the bare command, list, stop). What agents read (the connector's output)
and the room's start-up lines are printed plainly and need none of it. Piped, or with NO_COLOR set, everything
here comes out as plain text."""
from rich.console import Console
from rich.markup import escape
from rich.table import Table
from rich.text import Text

# From the site's own palette: its teal (the sea a shell comes from) for what stands out, its green for what is shared
# and well, its yellow for a warning, its muted brown for quiet words. Each reads on a dark terminal and on a light one.
ACC, GREEN, AMBER, DIM = "#179299", "#40a02b", "#df8e1d", "#8a7a68"
FLAG, ARG = "#df8e1d", "#7287fd"  # in a command as it is typed: an option in the site's yellow, what you fill in yourself in its lavender


SEA = ("#179299", "#209fb5", "#7287fd", "#8839ef", "#ea76cb")  # the site's teal, sapphire, lavender, mauve and pink: a shell from its deep middle to the pink of its lip


def along(t, stops=SEA):
    """The colour a part t of the way along (0 to 1) through the stops, blended between the two nearest."""
    t = min(1.0, max(0.0, t)) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    a, b = (tuple(int(c[k:k + 2], 16) for k in (1, 3, 5)) for c in (stops[i], stops[i + 1]))
    return "#" + "".join(f"{round(x + (y - x) * (t - i)):02x}" for x, y in zip(a, b))


def console(err=False):
    """Nothing is guessed at: no automatic colouring of numbers and paths, no emoji codes, and a line is never cut to
    fit (a path or a command must stay whole to be copied)."""
    return Console(stderr=err, highlight=False, emoji=False, soft_wrap=True)


def can_draw(text, out):
    """Whether this output can show these characters (the spiral is drawn in Braille dots)."""
    try:
        text.encode(out.encoding or "ascii")
        return True
    except (UnicodeError, LookupError):
        return False


def command(line, quiet=False):
    """A command as it is typed, each part in its own colour so it reads at a glance: the program's name plain, what
    it does in teal, an option in yellow, what you fill in yourself in lavender. quiet: all of it in quiet words."""
    out = Text()
    for i, word in enumerate(line.split(" ")):
        if i:
            out.append(" ")
        style = DIM if quiet else "bold" if i == 0 else FLAG if word.startswith("-") else ARG if word[:1] in "<'" or word.isupper() else f"bold {ACC}"
        out.append(word, style=style)
    return out


def grid(rows, quiet=False):
    """Two columns with no lines: a command on the left, what it does on the right."""
    t = Table.grid(padding=(0, 3))
    t.add_column(no_wrap=True)
    t.add_column()
    for a, b in rows:
        t.add_row(command(a, quiet), Text(b, style=DIM if quiet else ""))
    return t


__all__ = ["ACC", "GREEN", "AMBER", "DIM", "FLAG", "ARG", "SEA", "along", "console", "can_draw", "command", "grid", "escape", "Table", "Text"]
