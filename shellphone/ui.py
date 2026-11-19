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


def grid(rows, first=None):
    """Two columns with no lines: a short thing on the left, what it is on the right."""
    t = Table.grid(padding=(0, 3))
    t.add_column(style=f"bold {first or ACC}", no_wrap=True)
    t.add_column()
    for a, b in rows:
        t.add_row(a, b)
    return t


__all__ = ["ACC", "GREEN", "AMBER", "DIM", "console", "can_draw", "grid", "escape", "Table", "Text"]
