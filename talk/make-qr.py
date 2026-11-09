#!/usr/bin/env python3
"""Write repo-qr.svg: a QR code for the repository URL, for the closing slide.

    python3 make-qr.py

Dependency-free on purpose (the deck's only other build dependency is Marp, fetched by build.sh).
A byte-mode QR encoder per ISO/IEC 18004: versions 1-6, error-correction level M, best mask by the
standard penalty score. build.sh inlines the SVG into slides.html like the diagram.
"""
import pathlib

URL = "https://github.com/AugustinasNomicas/graph-engineering-claude-code"
OUT = pathlib.Path(__file__).with_name("repo-qr.svg")
QUIET = 4  # quiet zone, in modules

# --- tables (index = version), levels L, M, Q, H ---------------------------------------------
ECC_PER_BLOCK = {
    "L": [-1, 7, 10, 15, 20, 26, 18],
    "M": [-1, 10, 16, 26, 18, 24, 16],
    "Q": [-1, 13, 22, 18, 26, 18, 24],
    "H": [-1, 17, 28, 22, 16, 22, 28],
}
NUM_BLOCKS = {
    "L": [-1, 1, 1, 1, 1, 1, 2],
    "M": [-1, 1, 1, 1, 2, 2, 4],
    "Q": [-1, 1, 1, 2, 2, 4, 4],
    "H": [-1, 1, 1, 2, 4, 4, 4],
}
FORMAT_BITS = {"L": 1, "M": 0, "Q": 3, "H": 2}


def raw_codewords(ver):
    n = (16 * ver + 128) * ver + 64
    if ver >= 2:
        a = ver // 7 + 2
        n -= (25 * a - 10) * a - 55
        if ver >= 7:
            n -= 36
    return n // 8


def data_capacity_bytes(ver, ecl):
    return raw_codewords(ver) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver]


# --- GF(256) Reed-Solomon --------------------------------------------------------------------
def gf_mul(a, b):
    # Russian-peasant multiplication modulo 0x11D, consuming b's bits from the top (Horner form).
    r = 0
    for i in range(7, -1, -1):
        r = (r << 1) ^ ((r >> 7) * 0x11D)
        r ^= ((b >> i) & 1) * a
    return r & 0xFF


def rs_generator(degree):
    g = [1]
    root = 1
    for _ in range(degree):
        g = [0] + g
        for i in range(len(g) - 1):
            g[i] ^= gf_mul(g[i + 1], root)
        root = gf_mul(root, 2)
    # g is lowest-degree-first and monic; the remainder step wants highest-first without the leading 1
    return list(reversed(g))[1:]


def rs_remainder(data, gen):
    rem = [0] * len(gen)
    for b in data:
        factor = b ^ rem.pop(0)
        rem.append(0)
        for i, c in enumerate(gen):
            rem[i] ^= gf_mul(c, factor)
    return rem


# --- bit stream ---------------------------------------------------------------------------------
def encode_bytes(text, ecl):
    data = text.encode("utf-8")
    ver = next((v for v in range(1, 7) if data_capacity_bytes(v, ecl) >= len(data) + 2), None)
    if ver is None:
        raise SystemExit("text too long for versions 1-6; extend the tables")
    bits = []

    def put(val, n):
        bits.extend((val >> i) & 1 for i in range(n - 1, -1, -1))

    put(0b0100, 4)          # byte mode
    put(len(data), 8)       # char count, 8 bits for versions 1-9
    for b in data:
        put(b, 8)
    cap = data_capacity_bytes(ver, ecl) * 8
    put(0, min(4, cap - len(bits)))
    put(0, (8 - len(bits) % 8) % 8)
    for pad in [0xEC, 0x11] * ((cap - len(bits)) // 16 + 1):
        if len(bits) >= cap:
            break
        put(pad, 8)
    codewords = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    return ver, codewords


def add_ecc_and_interleave(ver, ecl, data):
    nblocks = NUM_BLOCKS[ecl][ver]
    ecc_len = ECC_PER_BLOCK[ecl][ver]
    raw = raw_codewords(ver)
    short_blocks = nblocks - raw % nblocks
    short_len = raw // nblocks
    gen = rs_generator(ecc_len)
    blocks, k = [], 0
    for i in range(nblocks):
        dlen = short_len - ecc_len + (0 if i < short_blocks else 1)
        dat = data[k:k + dlen]
        k += dlen
        ecc = rs_remainder(dat, gen)
        blocks.append((dat + [None]) if i < short_blocks else dat)
        blocks[-1] = blocks[-1] + ecc
    out = []
    for i in range(len(blocks[0])):
        for j, blk in enumerate(blocks):
            if i != short_len - ecc_len or j >= short_blocks:
                out.append(blk[i])
    assert len(out) == raw and None not in out
    return out


# --- matrix -------------------------------------------------------------------------------------
class Matrix:
    def __init__(self, ver):
        self.size = ver * 4 + 17
        self.m = [[False] * self.size for _ in range(self.size)]
        self.func = [[False] * self.size for _ in range(self.size)]
        self.ver = ver

    def set_func(self, x, y, dark):
        self.m[y][x] = dark
        self.func[y][x] = True

    def draw_function_patterns(self):
        s = self.size
        for i in range(s):
            self.set_func(6, i, i % 2 == 0)
            self.set_func(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (s - 4, 3), (3, s - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < s and 0 <= y < s:
                        d = max(abs(dx), abs(dy))
                        self.set_func(x, y, d not in (2, 4))
        pos = self.alignment_positions()
        for i, ax in enumerate(pos):
            for j, ay in enumerate(pos):
                if (i == 0 and j == 0) or (i == 0 and j == len(pos) - 1) or (i == len(pos) - 1 and j == 0):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.set_func(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)
        self.draw_format_bits(0)  # reserve; real bits written after masking

    def alignment_positions(self):
        if self.ver == 1:
            return []
        n = self.ver // 7 + 2
        step = 26 if self.ver == 32 else (self.ver * 4 + n * 2 + 1) // (n * 2 - 2) * 2
        pos = [self.size - 7 - i * step for i in range(n - 1)] + [6]
        return sorted(pos)

    def draw_format_bits(self, mask, ecl="M"):
        data = FORMAT_BITS[ecl] << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (data << 10 | rem) ^ 0x5412
        s = self.size
        bit = lambda i: (bits >> i) & 1 == 1
        for i in range(6):
            self.set_func(8, i, bit(i))
        self.set_func(8, 7, bit(6))
        self.set_func(8, 8, bit(7))
        self.set_func(7, 8, bit(8))
        for i in range(9, 15):
            self.set_func(14 - i, 8, bit(i))
        for i in range(8):
            self.set_func(s - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self.set_func(8, s - 15 + i, bit(i))
        self.set_func(8, s - 8, True)

    def place_data(self, codewords):
        s = self.size
        i = 0
        total = len(codewords) * 8
        right = s - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(s):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = s - 1 - vert if upward else vert
                    if not self.func[y][x] and i < total:
                        self.m[y][x] = (codewords[i >> 3] >> (7 - (i & 7))) & 1 == 1
                        i += 1
            right -= 2
        assert i == total

    def apply_mask(self, mask):
        f = [
            lambda x, y: (x + y) % 2 == 0,
            lambda x, y: y % 2 == 0,
            lambda x, y: x % 3 == 0,
            lambda x, y: (x + y) % 3 == 0,
            lambda x, y: (x // 3 + y // 2) % 2 == 0,
            lambda x, y: x * y % 2 + x * y % 3 == 0,
            lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
            lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
        ][mask]
        for y in range(self.size):
            for x in range(self.size):
                if not self.func[y][x] and f(x, y):
                    self.m[y][x] = not self.m[y][x]

    def penalty(self):
        s, m, score = self.size, self.m, 0
        lines = [row for row in m] + [[m[y][x] for y in range(s)] for x in range(s)]
        finder = [True, False, True, True, True, False, True]
        for line in lines:
            run, prev = 0, None
            for v in line + [None]:
                if v == prev:
                    run += 1
                else:
                    if run >= 5:
                        score += 3 + run - 5
                    run, prev = 1, v
            for i in range(s - 6):
                if line[i:i + 7] == finder:
                    if line[max(0, i - 4):i] == [False] * min(4, i) and i >= 4:
                        score += 40
                    if line[i + 7:i + 11] == [False] * 4:
                        score += 40
        for y in range(s - 1):
            for x in range(s - 1):
                if m[y][x] == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                    score += 3
        dark = sum(sum(r) for r in m)
        total = s * s
        k = (abs(dark * 20 - total * 10) + total - 1) // total - 1
        return score + k * 10


def make(text, ecl="M"):
    ver, data = encode_bytes(text, ecl)
    codewords = add_ecc_and_interleave(ver, ecl, data)
    best, best_score = None, None
    for mask in range(8):
        q = Matrix(ver)
        q.draw_function_patterns()
        q.place_data(codewords)
        q.apply_mask(mask)
        q.draw_format_bits(mask, ecl)
        sc = q.penalty()
        if best_score is None or sc < best_score:
            best, best_score, best_mask = q, sc, mask
    return best, ver, best_mask


def to_svg(q):
    s = q.size + 2 * QUIET
    path = " ".join(
        f"M{x + QUIET},{y + QUIET}h1v1h-1z" for y in range(q.size) for x in range(q.size) if q.m[y][x]
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}" shape-rendering="crispEdges">\n'
        f'  <title>{URL}</title>\n'
        f'  <rect width="{s}" height="{s}" fill="#fff"/>\n'
        f'  <path d="{path}" fill="#000"/>\n'
        "</svg>\n"
    )


def self_test():
    # Known answer from the spec's worked example ("HELLO WORLD", version 1-M): 16 data codewords
    # and their 10 error-correction codewords. A wrong generator polynomial fails here, not on stage.
    data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    want = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]
    got = rs_remainder(data, rs_generator(10))
    assert got == want, f"Reed-Solomon self-test failed: {got}"


if __name__ == "__main__":
    self_test()
    q, ver, mask = make(URL)
    OUT.write_text(to_svg(q), encoding="utf-8")
    print(f"wrote {OUT.name}: version {ver} ({q.size}x{q.size}), level M, mask {mask}, {len(URL)} chars")
