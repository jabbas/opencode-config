/**
 * permission-model / parse.js — dependency-free shell command parser (plain ESM).
 *
 * Splits a shell command line into SIMPLE commands. The splitter, heredoc,
 * `$( )` / backtick / `<( )` and quote handling is ported from
 * `plugins/shell-style.js` (without any of its rules); this module only parses.
 *
 * Simple (one simple command after splitting on `; && || | & \n` and recursing
 * into `$( )`, backticks, `<( )`, `( )` and `sh -c '…'`):
 *
 *   {
 *     words:     string[],      // quotes removed; expansions keep their source text
 *     dynamic:   boolean[],     // parallel to words: word contains $VAR, ${…}, $( ), `…`, <( )
 *     assigns:   {name, value, dynamic?}[],   // leading NAME=value words
 *     redirects: {op, target, dynamic?}[],    // `>` `2>` `>>` `&>` `<` `2>&1` …
 *     heredoc:   boolean,       // has a `<<` heredoc (its body is DATA, never parsed as commands)
 *     heredocExpands: boolean,  // a heredoc delimiter is unquoted → body expands $( ) / $VAR at runtime
 *                               // (those inner commands are NOT emitted; the caller decides)
 *     stdinFrom?: "heredoc" | "herestring" | "pipe",
 *     nested?:   "subst" | "shell-c",   // set on commands found INSIDE another command
 *     funcDef?:  true,          // `name ( )` — a shell function definition
 *     raw:       string,        // source text of this command (without heredoc body)
 *   }
 *
 * Order: an outer command is emitted first, followed by the commands nested in it.
 * Leading grammar words (`do then else if while ! { time …`) are dropped from `words`.
 */

// Leading words that are shell grammar, not the command itself.
const RESERVED = new Set([
  'do', 'done', 'then', 'else', 'elif', 'if', 'fi', 'while', 'until', '!', '{', '}', 'esac', 'time',
]);
// Prefix commands that run the next word (only used to find `sh -c`).
const WRAPPERS = new Set(['command', 'exec', 'builtin', 'nohup', 'env']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const MAX_DEPTH = 20;

const HEREDOC_RE = /<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([\w.-]+))/y;
const ASSIGN_RE = /^([A-Za-z_]\w*)(?:\[[^\]]*\])?(\+?)=/;

/**
 * Skip a heredoc body starting at `from` (first char after the newline).
 * @param {string} src
 * @param {number} from
 * @param {{delim: string, strip: boolean}} h
 * @returns {number} index just after the terminator line (or `src.length + 1` when unterminated)
 */
function skipHeredocBody(src, from, h) {
  let i = from;
  while (i < src.length) {
    let eol = src.indexOf('\n', i);
    if (eol < 0) eol = src.length;
    const line = src.slice(i, eol);
    i = eol + 1;
    if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
  }
  return i;
}

/**
 * Find the index of the bracket that closes the one at `open`.
 * Quote-, escape- and heredoc-aware. Returns `src.length` when unterminated.
 * @param {string} src
 * @param {number} open index of the opening bracket
 * @param {string} openCh
 * @param {string} closeCh
 * @returns {number}
 */
function matchClose(src, open, openCh, closeCh) {
  let depth = 0;
  let heredocs = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    // Heredoc bodies (e.g. `$(cat <<'EOF' … EOF)`) may hold unbalanced quotes/brackets.
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<' && src[i - 1] !== '<') {
      HEREDOC_RE.lastIndex = i;
      const r = HEREDOC_RE.exec(src);
      if (r) {
        heredocs.push({ delim: r[2] ?? r[3] ?? r[4], strip: r[1] === '-' });
        i = HEREDOC_RE.lastIndex - 1;
        continue;
      }
    }
    if (c === '\n' && heredocs.length) {
      let p = i + 1;
      for (const h of heredocs) p = skipHeredocBody(src, p, h);
      heredocs = [];
      i = p - 1;
      continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) return src.length;
      i = j;
      continue;
    }
    if (c === '"') { i = skipDouble(src, i); continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

/**
 * Index of the closing `"` for the double quote opened at `open`.
 * @param {string} src
 * @param {number} open
 * @returns {number}
 */
function skipDouble(src, open) {
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') return i;
    if (c === '$' && src[i + 1] === '(') i = matchClose(src, i + 1, '(', ')');
  }
  return src.length;
}

/**
 * Remove shell quoting from a text: `'a b'` → `a b`, `"a\"b"` → `a"b`, `a\ b` → `a b`.
 * No expansion is performed.
 * @param {string} text
 * @returns {string}
 */
export function stripQuotes(text) {
  const s = String(text ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { out += s[i + 1] ?? ''; i++; continue; }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j < 0 ? s.length : j;
      out += s.slice(i + 1, end);
      i = end;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && '$"`\\'.includes(s[i + 1] ?? '')) { out += s[i + 1]; i += 2; continue; }
        out += s[i];
        i++;
      }
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * @typedef {{text: string, quoted: boolean, dynamic: boolean, prefix: string|undefined}} Word
 * @typedef {{op: string, target: string, dynamic?: true}} Redirect
 * @typedef {{
 *   words: string[], dynamic: boolean[], assigns: {name: string, value: string, dynamic?: true}[],
 *   redirects: Redirect[], heredoc: boolean, heredocExpands: boolean, stdinFrom?: 'heredoc'|'herestring'|'pipe',
 *   nested?: 'subst'|'shell-c', funcDef?: true, raw: string
 * }} Simple
 */

/** @returns {Word} */
const newWord = () => ({ text: '', quoted: false, dynamic: false, prefix: undefined });

/**
 * Set `nested` on the commands of a nested parse that do not carry their own marker.
 * @param {Simple[]} list
 * @param {'subst'|'shell-c'} kind
 * @returns {Simple[]}
 */
function mark(list, kind) {
  for (const s of list) s.nested ??= kind;
  return list;
}

/**
 * If the command is `sh|bash|zsh|… [opts] -c SCRIPT`, return SCRIPT.
 * @param {string[]} words
 * @returns {string|null}
 */
function shellCScript(words) {
  let k = 0;
  while (k < words.length && (WRAPPERS.has(words[k]) || ASSIGN_RE.test(words[k]))) k++;
  if (k >= words.length) return null;
  const name = words[k].slice(words[k].lastIndexOf('/') + 1);
  if (!SHELLS.has(name)) return null;
  for (let a = k + 1; a < words.length; a++) {
    const t = words[a];
    if (t === '--') return null;
    if (t.startsWith('-') || t.startsWith('+')) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) return words[a + 1] ?? null;
      if (/^[-+][oO]$/.test(t)) a++;
      continue;
    }
    return null; // first operand is a script file
  }
  return null;
}

/**
 * @param {string} src
 * @param {number} depth
 * @returns {Simple[]}
 */
function parseSimples(src, depth) {
  /** @type {Simple[]} */
  const out = [];
  if (depth > MAX_DEPTH) return out;
  const n = src.length;
  const newCmd = () => ({
    words: /** @type {Word[]} */ ([]),
    kids: /** @type {Simple[]} */ ([]),
    redirects: /** @type {Redirect[]} */ ([]),
    heredoc: false,
    heredocExpands: false,
    stdinFrom: /** @type {string|undefined} */ (undefined),
    piped: false,
    funcDef: false,
  });
  let cur = newCmd();
  /** @type {Word|null} */
  let word = null;
  /** @type {{chars: string, fd: string|null, dup: boolean}|null} */
  let pendingRedirect = null;
  /** @type {{strip: boolean}|null} */
  let pendingHeredoc = null;
  let pendingHerestring = false;
  /** @type {{delim: string, strip: boolean}[]} */
  let heredocs = [];
  let segStart = 0;
  let i = 0;

  const kid = (inner) => { cur.kids.push(...mark(parseSimples(inner, depth + 1), 'subst')); };
  /**
   * Substitutions hidden inside text that is not parsed as words (`${x:-$(cmd)}`, `$((1+$(cmd)))`,
   * `A=( $(cmd) )`): every `$( )` / backtick in it becomes a nested command. Deliberately
   * over-approximate (single quotes are not honoured) — an extra nested command only adds scrutiny.
   * @returns {boolean} whether an expansion was found
   */
  const hidden = (text) => {
    let found = false;
    for (let p = 0; p < text.length; p++) {
      const ch = text[p];
      if (ch === '\\') { p++; continue; }
      if (ch === '`') {
        let j = p + 1;
        while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
        kid(text.slice(p + 1, j));
        found = true;
        p = j;
      } else if (ch === '$' && text[p + 1] === '(') {
        const j = matchClose(text, p + 1, '(', ')');
        if (text[p + 2] === '(' && j - 1 > p + 2 && text[j - 1] === ')') hidden(text.slice(p + 2, j));
        else kid(text.slice(p + 2, j));
        found = true;
        p = j;
      } else if (ch === '$' && /[A-Za-z_{@*#?!$0-9-]/.test(text[p + 1] ?? '')) {
        found = true;
      }
    }
    return found;
  };
  const quoteStart = () => {
    word ??= newWord();
    word.prefix ??= word.text;
    word.quoted = true;
  };
  const expansionStart = () => {
    word ??= newWord();
    word.prefix ??= word.text;
    word.dynamic = true;
  };
  const flushWord = () => {
    if (!word) return;
    const w = word;
    word = null;
    if (pendingHeredoc) {
      heredocs.push({ delim: w.text, strip: pendingHeredoc.strip });
      if (!w.quoted) cur.heredocExpands = true; // unquoted delimiter → body expands $( ) / $VAR
      pendingHeredoc = null;
    } else if (pendingHerestring) {
      pendingHerestring = false;
    } else if (pendingRedirect) {
      const { chars, fd, dup } = pendingRedirect;
      const op = (fd ?? '') + chars + (dup ? '&' + w.text : '');
      /** @type {Redirect} */
      const r = { op, target: w.text };
      if (w.dynamic) r.dynamic = true;
      cur.redirects.push(r);
      pendingRedirect = null;
    } else {
      cur.words.push(w);
    }
  };
  const endCommand = (end) => {
    flushWord();
    pendingRedirect = null;
    pendingHeredoc = null;
    pendingHerestring = false;
    const c = cur;
    cur = newCmd();
    let k = 0;
    while (k < c.words.length && !c.words[k].quoted && RESERVED.has(c.words[k].text)) k++;
    const assigns = [];
    for (; k < c.words.length; k++) {
      const w = c.words[k];
      const m = ASSIGN_RE.exec(w.prefix ?? w.text);
      if (!m) break;
      const a = { name: m[1], value: w.text.slice(m[0].length) };
      if (w.dynamic) a.dynamic = true;
      assigns.push(a);
    }
    const rest = c.words.slice(k);
    if (rest.length || assigns.length || c.redirects.length || c.funcDef) {
      /** @type {Simple} */
      const s = {
        words: rest.map((w) => w.text),
        dynamic: rest.map((w) => w.dynamic),
        assigns,
        redirects: c.redirects,
        heredoc: c.heredoc,
        heredocExpands: c.heredocExpands,
        raw: src.slice(segStart, end).trim(),
      };
      const stdinFrom = c.stdinFrom ?? (c.piped ? 'pipe' : undefined);
      if (stdinFrom) s.stdinFrom = /** @type {any} */ (stdinFrom);
      if (c.funcDef) s.funcDef = true;
      out.push(s);
      out.push(...c.kids);
      const script = shellCScript(s.words);
      if (script !== null) out.push(...mark(parseSimples(script, depth + 1), 'shell-c'));
    } else {
      out.push(...c.kids);
    }
  };
  /** End the current command at `end` and start the next one at `next`. */
  const cut = (end, next) => { endCommand(end); segStart = next; };
  const effectiveWords = () => {
    let k = 0;
    while (k < cur.words.length && !cur.words[k].quoted && RESERVED.has(cur.words[k].text)) k++;
    return cur.words.slice(k);
  };
  // Handle `$…` at index `at`; returns the next index.
  const readDollar = (at, inDouble) => {
    word ??= newWord();
    const nx = src[at + 1];
    if (nx === '(') {
      const j = matchClose(src, at + 1, '(', ')');
      expansionStart();
      // `$(( … ))` is arithmetic, not a command — but may hide `$(cmd)` inside.
      if (src[at + 2] === '(' && j - 1 > at + 2 && src[j - 1] === ')') hidden(src.slice(at + 2, j));
      else kid(src.slice(at + 2, j));
      word.text += src.slice(at, j + 1);
      return j + 1;
    }
    if (nx === '{') {
      const j = matchClose(src, at + 1, '{', '}');
      expansionStart();
      hidden(src.slice(at + 2, j)); // `${x:-$(cmd)}`
      word.text += src.slice(at, j + 1);
      return j + 1;
    }
    if (nx === "'" && !inDouble) {
      // $'…' ANSI-C quoting: treat the content as quoted text.
      quoteStart();
      let j = at + 2;
      while (j < n && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      word.text += src.slice(at + 2, j);
      return j + 1;
    }
    if (nx !== undefined && /[A-Za-z_0-9@*#?!$-]/.test(nx)) expansionStart();
    word.text += '$';
    return at + 1;
  };
  const readBacktick = (at) => {
    word ??= newWord();
    let j = at + 1;
    while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
    expansionStart();
    kid(src.slice(at + 1, j));
    word.text += src.slice(at, j + 1);
    return j + 1;
  };

  while (i < n) {
    const c = src[i];

    if (c === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue; }
      quoteStart();
      word.text += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === "'") {
      quoteStart();
      let j = src.indexOf("'", i + 1);
      if (j < 0) j = n;
      word.text += src.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      quoteStart();
      i++;
      while (i < n && src[i] !== '"') {
        const d = src[i];
        if (d === '\\') {
          const nx = src[i + 1];
          if (nx === undefined) { i++; break; }
          if (nx === '\n') { i += 2; continue; }
          word.text += '$"`\\'.includes(nx) ? nx : '\\' + nx;
          i += 2;
          continue;
        }
        if (d === '$') { i = readDollar(i, true); continue; }
        if (d === '`') { i = readBacktick(i); continue; }
        word.text += d;
        i++;
      }
      i++;
      continue;
    }
    if (c === '`') { i = readBacktick(i); continue; }
    if (c === '$') { i = readDollar(i, false); continue; }

    if (c === '#' && word === null) {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { flushWord(); i++; continue; }
    if (c === '\n') {
      const at = i;
      i++;
      cut(at, i);
      for (const h of heredocs) i = skipHeredocBody(src, i, h);
      heredocs = [];
      segStart = i;
      continue;
    }
    if (c === ';') { cut(i, i + 1); i++; continue; }
    if (c === '&') {
      if (src[i + 1] === '>') {
        // `&>` / `&>>` redirect of both streams
        flushWord();
        let j = i + 1;
        while (j < n && src[j] === '>') j++;
        pendingRedirect = { chars: src.slice(i, j), fd: null, dup: false };
        i = j;
        continue;
      }
      const w = src[i + 1] === '&' ? 2 : 1;
      cut(i, i + w);
      i += w;
      continue;
    }
    if (c === '|') {
      const w = src[i + 1] === '|' || src[i + 1] === '&' ? 2 : 1;
      cut(i, i + w);
      if (src[i + 1] !== '|') cur.piped = true; // a real pipe (not `||`)
      i += w;
      continue;
    }
    if (c === ')') { cut(i, i + 1); i++; continue; }
    if (c === '(') {
      if (word && word.prefix === undefined && word.text.endsWith('=')) {
        // array assignment `NAME=( … )` — part of the word
        const j = matchClose(src, i, '(', ')');
        const arr = src.slice(i, j + 1);
        if (hidden(arr)) expansionStart(); // `A=( $(cmd) )` — keeps the NAME= prefix
        word.text += arr;
        i = j + 1;
        continue;
      }
      flushWord();
      const eff = effectiveWords();
      const closeParen = /\s*\)/y;
      closeParen.lastIndex = i + 1;
      if (eff.length === 1 && /^[\w@%+.:,-]+$/.test(eff[0].text) && closeParen.test(src)) {
        cur.funcDef = true; // `name ( )`
        const next = closeParen.lastIndex;
        cut(i, next);
        i = next;
        continue;
      }
      if (eff.length === 0) {
        const j = matchClose(src, i, '(', ')');
        if (src[i + 1] === '(' && j - 1 > i + 1 && src[j - 1] === ')') {
          // `(( … ))` arithmetic command
          word = newWord();
          word.text = src.slice(i, j + 1);
          if (hidden(word.text)) word.dynamic = true;
          flushWord();
        } else {
          kid(src.slice(i + 1, j)); // subshell
        }
        i = j + 1;
        continue;
      }
      cut(i, i + 1);
      i++;
      continue;
    }
    if (c === '<' || c === '>') {
      if (src[i + 1] === '(') {
        // process substitution <( … ) / >( … )
        word ??= newWord();
        const j = matchClose(src, i + 1, '(', ')');
        expansionStart();
        kid(src.slice(i + 2, j));
        word.text += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      let fd = null;
      if (word && !word.quoted && /^\d+$/.test(word.text)) { fd = word.text; word = null; } // fd number
      else flushWord();
      let j = i + 1;
      while (j < n && (src[j] === '<' || src[j] === '>')) j++;
      let chars = src.slice(i, j);
      let strip = false;
      let dup = false;
      if (src[j] === '&') { j++; dup = true; }
      else if (src[j] === '|' && chars === '>') { j++; chars = '>|'; }
      else if (chars === '<<' && src[j] === '-') { strip = true; j++; }
      if (chars.startsWith('<<') && chars !== '<<<') {
        pendingHeredoc = { strip };
        cur.heredoc = true;
        cur.stdinFrom = 'heredoc';
      } else if (chars === '<<<') {
        pendingHerestring = true;
        cur.stdinFrom = 'herestring';
      } else {
        pendingRedirect = { chars, fd, dup };
      }
      i = j;
      continue;
    }

    word ??= newWord();
    word.text += c;
    i++;
  }
  endCommand(n);
  return out;
}

/**
 * Parse a shell command line into simple commands (see the file header).
 * Never throws; unterminated quotes/brackets are treated as running to the end.
 * @param {string} command
 * @returns {Simple[]}
 */
export function parseCommand(command) {
  return parseSimples(String(command ?? ''), 0);
}
