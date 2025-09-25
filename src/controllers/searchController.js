// controllers/searchController.js
const User = require('../models/UsersModel');
const Post = require('../models/PostModel');
const { LANG_ALIAS } = require('./searchLangAlias'); // see helper below

// helper to normalize languages (shared with posts controller’s logic)
function normalizeLang(s) {
    const raw = String(s || '').toLowerCase().trim();
    return LANG_ALIAS[raw] || raw;
}

function escapeRx(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function computeConnectedSet(userId) {
    if (!userId) return new Set();
    const me = await User.findById(userId).select('_id following followers').lean();
    const set = new Set([String(userId)]);
    (me?.following || []).forEach(x => set.add(String(x)));
    (me?.followers || []).forEach(x => set.add(String(x)));
    return set;
}

function buildVisibilityFilter(connectedSet) {
    const orVis = [{ visibility: 'public' }, { visibility: { $exists: false } }];
    if (connectedSet && connectedSet.size > 0) {
        orVis.push({ visibility: 'followers', author: { $in: Array.from(connectedSet) } });
    }
    return { $or: orVis };
}

// GET /api/search/suggest?q=...
exports.suggest = async (req, res, next) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q || q.length < 2) {
            return res.json({ users: [], posts: [], languages: [], tags: [] });
        }

        const rx = new RegExp(escapeRx(q), 'i');

        // USERS (top 5)
        const users = await User.find({
            $or: [{ username: rx }, { name: rx }, { email: rx }]
        })
            .limit(5)
            .select('_id name username avatarUrl');

        // LANGUAGES (prefix/smart match against Post.ALLOWED_LANGS)
        const qLangNorm = normalizeLang(q);
        const allowed = Post.ALLOWED_LANGS || [];
        const languages = allowed
            .filter(l => l.includes(qLangNorm) || l.startsWith(qLangNorm))
            .slice(0, 6);

        // TAGS (pull top matching tags from posts, distinct, small sample)
        // Note: for speed without an extra tags collection:
        const tagDocs = await Post.aggregate([
            { $match: { tags: { $exists: true, $ne: [] } } },
            { $unwind: '$tags' },
            { $match: { tags: rx } },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 6 },
        ]);
        const tags = tagDocs.map(d => d._id);

        // POSTS (quick preview list: only public/connected)
        const connected = await computeConnectedSet(req.user?.id);
        const vis = buildVisibilityFilter(connected);

        const posts = await Post.find({
            ...vis,
            $or: [
                { text: rx },
                { tags: rx },
                { languages: rx }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('_id text createdAt author tags languages')
            .populate({ path: 'author', select: 'username' })
            .lean();

        const postPreviews = posts.map(p => ({
            _id: p._id,
            createdAt: p.createdAt,
            author: p.author,
            preview: String(p.text || '').slice(0, 100),
            tags: p.tags || [],
            languages: p.languages || []
        }));

        return res.json({
            users,
            posts: postPreviews,
            languages,
            tags
        });
    } catch (e) { next(e); }
};

// GET /api/search?q=...&limit=...
exports.search = async (req, res, next) => {
    try {
        const q = String(req.query.q || '').trim();
        const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 50);
        if (!q) return res.json({ users: [], posts: [], languages: [], tags: [] });

        const rx = new RegExp(escapeRx(q), 'i');

        const [users, connected] = await Promise.all([
            User.find({ $or: [{ username: rx }, { name: rx }, { email: rx }] })
                .limit(20)
                .select('_id name username avatarUrl bio skills'),
            computeConnectedSet(req.user?.id)
        ]);

        const vis = buildVisibilityFilter(connected);

        // posts match: text or tag or language; prefer recent
        const posts = await Post.find({
            ...vis,
            $or: [
                { text: rx },
                { tags: rx },
                { languages: rx }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate([{ path: 'author', select: 'name username avatarUrl' }])
            .lean();

        // languages list (from allowed that match q) + from posts that contain
        const qLangNorm = normalizeLang(q);
        const allowed = Post.ALLOWED_LANGS || [];
        const langSet = new Set(
            allowed.filter(l => l.includes(qLangNorm) || l.startsWith(qLangNorm))
        );
        posts.forEach(p => (p.languages || []).forEach(l => { if (l.includes(qLangNorm)) langSet.add(l); }));
        const languages = Array.from(langSet).slice(0, 20);

        // top tags matching q from posts
        const tagDocs = await Post.aggregate([
            { $match: { ...vis, tags: { $exists: true, $ne: [] } } },
            { $unwind: '$tags' },
            { $match: { tags: rx } },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 },
        ]);
        const tags = tagDocs.map(d => d._id);

        res.json({ users, posts, languages, tags });
    } catch (e) { next(e); }
};
