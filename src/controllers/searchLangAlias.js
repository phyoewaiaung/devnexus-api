// controllers/searchLangAlias.js
// Central place to normalize language aliases used in code blocks / tags.
// Keep this small and readable. Extend as needed to match what you store in Post.ALLOWED_LANGS.

// Canonical targets should match the values you put in Post.ALLOWED_LANGS.
const LANG_ALIAS = Object.freeze({
    // JavaScript / TypeScript
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    node: 'javascript',

    ts: 'typescript',
    tsx: 'typescript',

    // Web
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',

    // Shell / config
    shell: 'bash',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',

    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',

    md: 'markdown',
    markdown: 'markdown',

    // C-family
    c: 'c',
    h: 'c',
    'c++': 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',

    'c#': 'csharp',
    csharp: 'csharp',

    // JVM
    java: 'java',
    kt: 'kotlin',
    kotlin: 'kotlin',
    groovy: 'groovy',
    scala: 'scala',

    // Python / Ruby / PHP
    py: 'python',
    python: 'python',

    rb: 'ruby',
    ruby: 'ruby',

    php: 'php',

    // Go / Rust
    go: 'go',
    golang: 'go',

    rs: 'rust',
    rust: 'rust',

    // Swift / Objective-C
    swift: 'swift',
    m: 'objectivec',
    mm: 'objectivec',
    objc: 'objectivec',
    objectivec: 'objectivec',

    // Data / ML
    json: 'json',
    csv: 'csv',
    sql: 'sql',
    r: 'r',

    // Misc
    lua: 'lua',
    perl: 'perl',
    dart: 'dart',
    haskell: 'haskell',
    ocaml: 'ocaml',
    clj: 'clojure',
    clojure: 'clojure',
});

/**
 * Normalize an input language/token to its canonical form.
 * If there is no known alias, returns the lowercased input.
 */
function normalizeLang(input) {
    const key = String(input || '').trim().toLowerCase();
    return LANG_ALIAS[key] || key;
}

module.exports = {
    LANG_ALIAS,
    normalizeLang,
};
