// Small QR code generator (no dependencies), written for this app: byte mode,
// error correction level M, versions 1-10 (up to 213 bytes, plenty for a join
// link). Follows ISO/IEC 18004; structure after Project Nayuki's reference
// implementation (MIT). encodeQr(text) returns the module matrix (true = dark),
// qrSvg(text) an SVG string with a 4-module quiet zone.

// Per version (1-10), level M: [ec codewords per block, [data codewords per block, ...]]
const BLOCKS_M = [
    null,
    [10, [16]],
    [16, [28]],
    [26, [44]],
    [18, [32, 32]],
    [24, [43, 43]],
    [16, [27, 27, 27, 27]],
    [18, [31, 31, 31, 31]],
    [22, [38, 38, 39, 39]],
    [22, [36, 36, 36, 37, 37]],
    [26, [43, 43, 43, 43, 44]]
];
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const FORMAT_BITS_M = 0;

function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
}

function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = gfMultiply(result[j], root);
            if (j + 1 < result.length) result[j] ^= result[j + 1];
        }
        root = gfMultiply(root, 0x02);
    }
    return result;
}

function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
    }
    return result;
}

function utf8Bytes(text) {
    return Array.from(new TextEncoder().encode(String(text)));
}

function chooseVersion(byteCount) {
    for (let v = 1; v <= 10; v++) {
        const capacityBits = BLOCKS_M[v][1].reduce((a, b) => a + b, 0) * 8;
        const needed = 4 + (v < 10 ? 8 : 16) + byteCount * 8;
        if (needed <= capacityBits) return v;
    }
    throw new Error('Texten är för lång för QR-koden.');
}

function buildCodewords(bytes, version) {
    const [ecLen, blockSizes] = BLOCKS_M[version];
    const dataCapacity = blockSizes.reduce((a, b) => a + b, 0);
    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, dataCapacity * 8 - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
    for (let pad = 0xEC; data.length < dataCapacity; pad ^= 0xEC ^ 0x11) data.push(pad);

    const divisor = rsDivisor(ecLen);
    const blocks = [];
    let offset = 0;
    blockSizes.forEach((size) => {
        const blockData = data.slice(offset, offset + size);
        offset += size;
        blocks.push({ data: blockData, ec: rsRemainder(blockData, divisor) });
    });
    const out = [];
    const maxData = Math.max(...blockSizes);
    for (let i = 0; i < maxData; i++) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.ec[i]));
    return out;
}

function maskApplies(mask, x, y) {
    switch (mask) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
}

function createMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || y < 0 || x >= size || y >= size) continue;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                set(x, y, dist !== 2 && dist !== 4);
            }
        }
    });
    const positions = ALIGNMENT[version];
    const last = positions.length - 1;
    positions.forEach((cy, i) => positions.forEach((cx, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }));
    return { size, modules, isFunction, set };
}

function drawFormatBits(matrix, mask) {
    const { size, set } = matrix;
    const data = (FORMAT_BITS_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
}

function drawVersionBits(matrix, version) {
    if (version < 7) return;
    const { size, set } = matrix;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
    }
}

function drawCodewords(matrix, codewords) {
    const { size, modules, isFunction } = matrix;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (!isFunction[y][x] && i < codewords.length * 8) {
                    modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
                    i++;
                }
            }
        }
    }
}

function applyMask(matrix, mask) {
    const { size, modules, isFunction } = matrix;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!isFunction[y][x] && maskApplies(mask, x, y)) modules[y][x] = !modules[y][x];
        }
    }
}

// Penalty rules 1 (runs), 2 (2x2 blocks) and 4 (balance); enough to pick a readable mask
function penalty(modules) {
    const size = modules.length;
    let score = 0;
    const runScore = (line) => {
        let run = 1;
        for (let i = 1; i <= line.length; i++) {
            if (i < line.length && line[i] === line[i - 1]) run++;
            else {
                if (run >= 5) score += 3 + (run - 5);
                run = 1;
            }
        }
    };
    for (let y = 0; y < size; y++) runScore(modules[y]);
    for (let x = 0; x < size; x++) runScore(modules.map((row) => row[x]));
    let dark = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (modules[y][x]) dark++;
            if (y < size - 1 && x < size - 1) {
                const c = modules[y][x];
                if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
            }
        }
    }
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
}

export function encodeQr(text) {
    const bytes = utf8Bytes(text);
    const version = chooseVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
        const matrix = createMatrix(version);
        drawFormatBits(matrix, mask);
        drawVersionBits(matrix, version);
        drawCodewords(matrix, codewords);
        applyMask(matrix, mask);
        const score = penalty(matrix.modules);
        if (!best || score < best.score) best = { score, modules: matrix.modules };
    }
    return best.modules;
}

/** An SVG image of the QR code (dark on white, 4-module quiet zone) */
export function qrSvg(text, { size = 192, label = 'QR-kod' } = {}) {
    const modules = encodeQr(text);
    const n = modules.length + 8;
    let path = '';
    modules.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }));
    const safeLabel = String(label).replace(/[<>&"']/g, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" role="img" aria-label="${safeLabel}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
