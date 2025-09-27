// cors-origins.js
function normalize(o) {
    if (!o) return null;
    try { return new URL(o).origin; } catch { return o.replace(/\/+$/, ''); }
}

function parseOrigins(csv) {
    if (!csv) return null; // dev fallback handled by caller
    const list = csv
        .split(',')
        .map(s => normalize(s.trim()))
        .filter(Boolean);

    if (list.length === 0) return null;

    // dynamic function for express 'cors'
    const originFn = (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin / curl / server-to-server
        const o = normalize(origin);
        if (list.includes(o)) return cb(null, true);
        cb(new Error(`Not allowed by CORS: ${origin}`));
    };

    // also return the array for libs that expect an array (e.g. socket.io)
    originFn.list = list;
    return originFn;
}

module.exports = { parseOrigins };
