"""Pixel layer for the glasses: a 9x24 grid, packed the way the panel wants.

Geometry established against live hardware:
    9 rows, 24 columns per lens
    row 0 = bottom, row 8 = top
    column 0 = left
    row r occupies bit 2*r of the 3-byte column word (two bits per pixel)

The odd bits are unused by this encoder. Setting only the even bit lights the
pixel; what the odd bit does (brightness, or nothing) is not yet established.
"""
from __future__ import annotations

from . import protocol as p

ROWS = 9
COLS = 24
STRIDE = 2

# The panel is not a full rectangle. Two physical gaps, both centred, mapped by
# drawing a border and reading back what was missing:
#   - top row: middle 6 pixels absent
#   - bottom: a triangular nose-bridge notch, 2 rows tall, 6 wide at the very
#     bottom and narrowing by one pixel each side going up
DEAD: dict[int, range] = {
    8: range(9, 15),   # top row, 6 missing
    1: range(10, 14),  # notch upper row, 4 missing
    0: range(9, 15),   # notch bottom row, 6 missing
}


def alive(row: int, col: int) -> bool:
    """Is there physically an LED at this coordinate?"""
    if not (0 <= row < ROWS and 0 <= col < COLS):
        return False
    return col not in DEAD.get(row, ())


def edge_pixels() -> list[tuple[int, int]]:
    """Every live pixel that borders either a gap or the outside of the panel.

    Tracing these lights the true silhouette of the panel, notches included,
    rather than a rectangle that would drop pixels into the dead zones.
    """
    out = []
    for r in range(ROWS):
        for c in range(COLS):
            if not alive(r, c):
                continue
            if any(not alive(r + dr, c + dc)
                   for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out.append((r, c))
    return out


class Grid:
    """A mutable 9x24 monochrome frame. Origin (0,0) is BOTTOM-LEFT."""

    def __init__(self) -> None:
        self.px = [[0] * COLS for _ in range(ROWS)]

    def clear(self) -> None:
        for row in self.px:
            for c in range(COLS):
                row[c] = 0

    def set(self, row: int, col: int, on: int = 1) -> None:
        if 0 <= row < ROWS and 0 <= col < COLS:
            self.px[row][col] = 1 if on else 0

    def blit(self, bitmap: list[list[int]], row0: int = 0, col0: int = 0) -> None:
        """Draw a [row][col] bitmap with its bottom-left at (row0, col0)."""
        for r, line in enumerate(bitmap):
            for c, v in enumerate(line):
                if v:
                    self.set(row0 + r, col0 + c)

    def to_frames(self) -> list[bytes]:
        """Pack into one encrypted-ready 16-byte plaintext frame per column."""
        frames = []
        for c in range(COLS):
            bits = 0
            for r in range(ROWS):
                if self.px[r][c]:
                    bits |= 1 << (STRIDE * r)
            frames.append(p.column(c, bits.to_bytes(3, "big")))
        return frames

    def render(self) -> str:
        """ASCII preview, top row first, so terminal output matches the lens."""
        out = []
        for r in range(ROWS - 1, -1, -1):
            out.append("".join("#" if v else "." for v in self.px[r]))
        return "\n".join(out)
