"""Generate the Pulseline mark: a tapered heartbeat/EKG line.

A plain SVG stroke has one uniform width, so it cannot taper to a point at the
ends. Instead we treat the line as a *centerline* of (x, y, half_width) key
points, smooth it with a Catmull-Rom spline, offset each sample along its
normal, and emit the result as a single filled outline path.

Shape, left to right: fades in from a point -> small blip -> tall spike ->
deep valley -> small blip -> fades out to a point.

To tweak the mark, edit KEY below and re-run:

    python brand/pulse.py

Outputs (all relative to this file's directory):
    pulse_path.txt          full-density path data, for large renders
    pulse_path_compact.txt  decimated path data, embedded inline in the app
    pulseline-mark.svg      standalone coral mark
"""

import math
import os

# (x, y, half_width). y grows downward, as in SVG. Baseline is y = 150.
KEY = [
    (0,   150, 0.2),
    (55,  150, 2.6),
    (120, 150, 4.6),
    (165, 127, 5.2),   # small blip
    (198, 150, 4.8),
    (242, 150, 5.4),
    (276, 52,  6.6),   # tall spike
    (309, 150, 5.8),
    (331, 246, 5.2),   # deep valley
    (357, 150, 4.8),
    (398, 150, 4.6),
    (432, 131, 4.4),   # small blip
    (462, 150, 4.0),
    (528, 150, 2.4),
    (600, 150, 0.2),
]

SAMPLES_PER_SEG = 26   # full density
COMPACT_STRIDE = 3     # keep every Nth sample for the compact path


def catmull_rom(p0, p1, p2, p3, t):
    """Centripetal-ish Catmull-Rom on a tuple of scalars, component-wise."""
    t2, t3 = t * t, t * t * t
    return tuple(
        0.5 * (
            2 * b
            + (-a + c) * t
            + (2 * a - 5 * b + 4 * c - d) * t2
            + (-a + 3 * b - 3 * c + d) * t3
        )
        for a, b, c, d in zip(p0, p1, p2, p3)
    )


def sample_centerline(key, n):
    """Spline the key points into a dense centerline of (x, y, w)."""
    pts = [key[0]] + list(key) + [key[-1]]  # duplicate ends so the curve reaches them
    out = []
    for i in range(len(pts) - 3):
        for s in range(n):
            out.append(catmull_rom(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], s / n))
    out.append(key[-1])
    return out


def offset_sides(center):
    """Walk the centerline, offsetting each sample along its unit normal."""
    upper, lower = [], []
    for i, (x, y, w) in enumerate(center):
        # Tangent from neighbours (one-sided at the ends).
        px, py = center[max(i - 1, 0)][:2]
        nx, ny = center[min(i + 1, len(center) - 1)][:2]
        tx, ty = nx - px, ny - py
        length = math.hypot(tx, ty) or 1.0
        # Normal is the tangent rotated 90 degrees.
        ox, oy = -ty / length * w, tx / length * w
        upper.append((x + ox, y + oy))
        lower.append((x - ox, y - oy))
    return upper, lower


def to_path(upper, lower, precision=2):
    """Up one side, back down the other, closed."""
    def fmt(v):
        s = f"{v:.{precision}f}".rstrip("0").rstrip(".")
        return s if s not in ("-0", "") else "0"

    ring = upper + lower[::-1]
    head = f"M{fmt(ring[0][0])} {fmt(ring[0][1])}"
    rest = "".join(f"L{fmt(x)} {fmt(y)}" for x, y in ring[1:])
    return head + rest + "Z"


def decimate(seq, stride):
    """Keep every Nth point, always preserving the tapered end points."""
    kept = seq[::stride]
    if kept[-1] != seq[-1]:
        kept.append(seq[-1])
    return kept


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="Pulseline">
  <path d="{path}" fill="{color}"/>
</svg>
"""

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))

    center = sample_centerline(KEY, SAMPLES_PER_SEG)
    upper, lower = offset_sides(center)

    full = to_path(upper, lower, precision=2)
    compact = to_path(decimate(upper, COMPACT_STRIDE), decimate(lower, COMPACT_STRIDE), precision=1)

    with open(os.path.join(here, "pulse_path.txt"), "w") as f:
        f.write(full)
    with open(os.path.join(here, "pulse_path_compact.txt"), "w") as f:
        f.write(compact)
    with open(os.path.join(here, "pulseline-mark.svg"), "w") as f:
        f.write(SVG.format(path=full, color="#FF4D5E"))

    print(f"full    {len(full):>6,} chars  ({len(upper)} samples/side)")
    print(f"compact {len(compact):>6,} chars  ({len(decimate(upper, COMPACT_STRIDE))} samples/side)")
