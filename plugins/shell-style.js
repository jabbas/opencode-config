/**
 * shell-style — OpenCode v2 plugin (dependency-free, plain ESM).
 *
 * Tightens permission decisions for the `shell` tool for command shapes that the
 * wildcard permission rules cannot judge, and explains the denial to the model:
 *
 *  1. shell function definitions (rules only see the function name, not its body)
 *  2. a variable used as the command word after assignments (`X=1 $sh w.sh`)
 *  3. scripts executed or sourced (`sh x`, `./x`, `source x`, `. x`) from $TMPDIR / /tmp
 *     (contents invisible to the rules)
 *  4. an unquoted jsonpath/custom-columns filter (`[?(` outside quotes) — the parentheses
 *     parse as a subshell and zsh fails on the glob
 *  5. agent-authored text written to a file via the shell (`echo x > f`, `cat > f <<EOF`,
 *     `tee f <<EOF`, `{ echo a; } > f`) outside tmp — the write/edit tools are the way
 *  6. an `env VAR=… cmd` prefix (rules see `env`, not the command it runs)
 *  7. a redirect with no command (`: > f`, `> f`) creating/truncating a file outside tmp
 *
 * It only ever makes a decision STRICTER (allow→ask/deny, ask→deny); it never
 * loosens config rules and never touches an incoming `deny`. Any internal error is
 * logged once and the event is left unchanged (fail-open — config still governs).
 *
 * Wiring (OpenCode v2):
 *  - ctx.tool.hook("execute.before")  stashes the shell command by tool-call id
 *  - ctx.permission.hook("evaluate")  looks the command up via `ev.source.id`
 *
 * Pure logic lives in `analyze()` (named export) so it can be unit-tested:
 *   node --test scripts/test-shell-style.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SUB = '\u0002'; // placeholder for a command/process substitution inside a word
const LIT = '\u0001'; // placeholder for a quoted/escaped (non-expanding) `$`

const MSG_FUNCTION =
  "Don't define shell functions — permission rules only see the function name, not its body. " +
  'Put the real command (e.g. `curl …`) directly, also inside loops.';
const MSG_VARCMD =
  "The command word is a variable — rules can't see what runs. " +
  'Write the literal command (`sh …`, `kubectl …`).';
const MSG_TMPSCRIPT =
  'This runs a script from $TMPDIR — its contents are invisible to the permission rules. ' +
  "Run the commands directly, or for a CI step use `sh <(yq '…' .github/workflows/…)`.";
const MSG_FILTER =
  'Quote the jsonpath / custom-columns argument in single quotes ' +
  '(`-o \'jsonpath={.items[?(@.x=="y")].name}\'`). ' +
  'Unquoted parentheses are parsed as a subshell and zsh fails on the unquoted glob.';
const MSG_FILEWRITE =
  'Write files with the write/edit tool, not via echo/printf/heredoc redirects — shell-written ' +
  'content is checked as commands (false prompts) and the user sees no diff. ' +
  'Shell writes are fine for scratch files in $TMPDIR and for real tool output (`cmd > log`).';
const MSG_ENVPREFIX =
  'Drop the `env VAR=…` prefix — permission rules see `env`, not the command it runs, so it is ' +
  'asked every time. Run the command directly and pass settings with its own flags ' +
  '(`--kubeconfig …`, `--config …`).';
const MSG_BAREREDIRECT =
  "A redirect with no command (`: > f`, `> f`) creates or truncates a file the rules can't see " +
  'as a write. Create or empty files with the write tool; shell writes are fine for scratch ' +
  'files in $TMPDIR.';

// Leading words that are shell grammar, not the command itself.
const RESERVED = new Set([
  'do', 'done', 'then', 'else', 'elif', 'if', 'fi', 'while', 'until', '!', '{', '}', 'esac', 'time',
]);
// Grammar words that start a command (closers like `done`/`}`/`fi` may carry a redirect).
const OPENERS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', 'time']);
// Prefix commands that run the next word.
const WRAPPERS = new Set(['command', 'exec', 'builtin', 'nohup']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const MAX_DEPTH = 20;

// ---------------------------------------------------------------------------
// Tokenizer / parser
// ---------------------------------------------------------------------------

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
 * Quote- and escape-aware. Returns `src.length` when unterminated.
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
      const m = /<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([\w.-]+))/y;
      m.lastIndex = i;
      const r = m.exec(src);
      if (r) {
        heredocs.push({ delim: r[2] ?? r[3] ?? r[4], strip: r[1] === '-' });
        i = m.lastIndex - 1;
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
 * Return `src` with everything the shell would not expand/parse as code removed:
 * single- and double-quoted text, backslash-escaped characters, comments and
 * heredoc bodies. Command substitutions stay (their content is unquoted code).
 * @param {string} src
 * @returns {string}
 */
function unquotedText(src) {
  let out = '';
  /** @type {{delim: string, strip: boolean}[]} */
  let heredocs = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; out += ' '; continue; }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) break;
      i = j;
      out += ' ';
      continue;
    }
    if (c === '"') { i = skipDouble(src, i); out += ' '; continue; }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(src[i - 1]))) {
      while (i + 1 < src.length && src[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<' && src[i - 1] !== '<') {
      const m = /<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([\w.-]+))/y;
      m.lastIndex = i;
      const r = m.exec(src);
      if (r) {
        heredocs.push({ delim: r[2] ?? r[3] ?? r[4], strip: r[1] === '-' });
        i = m.lastIndex - 1;
        out += ' ';
        continue;
      }
    }
    if (c === '\n' && heredocs.length) {
      let p = i + 1;
      for (const h of heredocs) p = skipHeredocBody(src, p, h);
      heredocs = [];
      i = p - 1;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * @typedef {{text: string, quoted: boolean}} Word
 * @typedef {{op: string, fd: string|null, dup: boolean, target: Word}} Redirect
 * @typedef {{words: Word[], children: Cmd[][], funcDef: boolean, redirects: Redirect[],
 *            stdinText: boolean, pipeFrom: Cmd|null}} Cmd
 */

/**
 * Parse a shell command line into simple commands. Substitutions, subshells and
 * process substitutions are parsed recursively into `children`. Quoted text,
 * comments, redirections and heredoc bodies never produce words/commands.
 * @param {string} src
 * @param {number} [depth]
 * @returns {Cmd[]}
 */
function parse(src, depth = 0) {
  /** @type {Cmd[]} */
  const commands = [];
  if (depth > MAX_DEPTH) return commands;
  const n = src.length;
  const newCmd = () => ({
    words: [], children: [], funcDef: false, redirects: [], stdinText: false, pipeFrom: null,
  });
  let cur = newCmd();
  /** @type {Word|null} */
  let word = null;
  /** @type {{op: string, fd: string|null, dup: boolean}|null} */
  let pendingRedirect = null;
  /** @type {{strip: boolean}|null} */
  let pendingHeredoc = null;
  /** @type {{delim: string, strip: boolean}[]} */
  let heredocs = [];
  let i = 0;

  const sub = (inner) => cur.children.push(parse(inner, depth + 1));
  const flushWord = () => {
    if (!word) return;
    if (pendingHeredoc) {
      heredocs.push({ delim: word.text, strip: pendingHeredoc.strip });
      pendingHeredoc = null;
    } else if (pendingRedirect) {
      cur.redirects.push({ ...pendingRedirect, target: word });
      pendingRedirect = null;
    } else {
      cur.words.push(word);
    }
    word = null;
  };
  const endCommand = () => {
    flushWord();
    pendingRedirect = null;
    pendingHeredoc = null;
    // A command may be redirects only (`> f`, `< in`): keep it so bare writes can be judged.
    if (cur.words.length || cur.children.length || cur.funcDef || cur.redirects.length) {
      commands.push(cur);
    }
    cur = newCmd();
  };
  const effectiveWords = () => {
    let k = 0;
    while (k < cur.words.length && !cur.words[k].quoted && RESERVED.has(cur.words[k].text)) k++;
    return cur.words.slice(k);
  };
  // Handle `$…` at index i; returns the next index.
  const readDollar = (at, inDouble) => {
    word ??= { text: '', quoted: false };
    const nx = src[at + 1];
    if (nx === '(') {
      const j = matchClose(src, at + 1, '(', ')');
      sub(src.slice(at + 2, j));
      word.text += SUB;
      return j + 1;
    }
    if (nx === '{') {
      const j = matchClose(src, at + 1, '{', '}');
      word.text += src.slice(at, j + 1);
      return j + 1;
    }
    if (nx === "'" && !inDouble) {
      // $'…' ANSI-C quoting: treat the content as quoted text.
      word.quoted = true;
      let j = at + 2;
      while (j < n && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
      word.text += src.slice(at + 2, j).replaceAll('$', LIT);
      return j + 1;
    }
    word.text += '$';
    return at + 1;
  };
  const readBacktick = (at) => {
    word ??= { text: '', quoted: false };
    let j = at + 1;
    while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
    sub(src.slice(at + 1, j));
    word.text += SUB;
    return j + 1;
  };

  while (i < n) {
    const c = src[i];

    if (c === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue; }
      word ??= { text: '', quoted: false };
      word.quoted = true;
      const nx = src[i + 1] ?? '';
      word.text += nx === '$' ? LIT : nx;
      i += 2;
      continue;
    }
    if (c === "'") {
      word ??= { text: '', quoted: false };
      word.quoted = true;
      let j = src.indexOf("'", i + 1);
      if (j < 0) j = n;
      word.text += src.slice(i + 1, j).replaceAll('$', LIT);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      word ??= { text: '', quoted: false };
      word.quoted = true;
      i++;
      while (i < n && src[i] !== '"') {
        const d = src[i];
        if (d === '\\') {
          const nx = src[i + 1];
          if (nx === undefined) { i++; break; }
          if (nx === '\n') { i += 2; continue; }
          if ('$"`\\'.includes(nx)) word.text += nx === '$' ? LIT : nx;
          else word.text += '\\' + nx;
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
      endCommand();
      i++;
      for (const h of heredocs) i = skipHeredocBody(src, i, h);
      heredocs = [];
      continue;
    }
    if (c === ';') { endCommand(); i++; continue; }
    if (c === '&') {
      if (src[i + 1] === '>') { i++; continue; } // `&>` redirect, handled as `>`
      endCommand();
      i += src[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === '|') {
      const prev = cur;
      endCommand();
      if (src[i + 1] !== '|') cur.pipeFrom = prev; // a real pipe (not `||`)
      i += src[i + 1] === '|' || src[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === ')') { endCommand(); i++; continue; }
    if (c === '(') {
      if (word && !word.quoted && word.text.endsWith('=')) {
        // array assignment `NAME=( … )` — part of the word
        const j = matchClose(src, i, '(', ')');
        word.text += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      flushWord();
      const eff = effectiveWords();
      const closeParen = /\s*\)/y;
      closeParen.lastIndex = i + 1;
      if (eff.length === 1 && /^[\w@%+.:,-]+$/.test(eff[0].text) && closeParen.test(src)) {
        cur.funcDef = true; // `name ( )`
        i = closeParen.lastIndex;
        endCommand();
        continue;
      }
      if (eff.length === 0) {
        const j = matchClose(src, i, '(', ')'); // subshell / (( … ))
        sub(src.slice(i + 1, j));
        i = j + 1;
        continue;
      }
      endCommand();
      i++;
      continue;
    }
    if (c === '<' || c === '>') {
      if (src[i + 1] === '(') {
        // process substitution <( … ) / >( … )
        word ??= { text: '', quoted: false };
        const j = matchClose(src, i + 1, '(', ')');
        sub(src.slice(i + 2, j));
        word.text += c + '(' + SUB + ')';
        i = j + 1;
        continue;
      }
      let fd = null;
      if (word && !word.quoted && /^\d+$/.test(word.text)) { fd = word.text; word = null; } // fd number
      else flushWord();
      let j = i + 1;
      while (j < n && (src[j] === '<' || src[j] === '>')) j++;
      const op = src.slice(i, j);
      let strip = false;
      let dup = false;
      if (src[j] === '&') { j++; dup = true; }
      else if (src[j] === '|' && op === '>') j++;
      else if (op === '<<' && src[j] === '-') { strip = true; j++; }
      if (op.startsWith('<<')) cur.stdinText = true; // heredoc or herestring
      if (op.startsWith('<<') && op !== '<<<') pendingHeredoc = { strip };
      else pendingRedirect = { op, fd, dup };
      i = j;
      continue;
    }

    word ??= { text: '', quoted: false };
    word.text += c;
    i++;
  }
  endCommand();
  return commands;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Canonicalise macOS aliases (`/var`→`/private/var`, `/tmp`→`/private/tmp`).
 * @param {string} p absolute path
 * @returns {string}
 */
function canon(p) {
  let q = path.posix.normalize(p);
  if (q.length > 1) q = q.replace(/\/+$/, '');
  if (q === '/var' || q.startsWith('/var/')) q = '/private' + q;
  if (q === '/tmp' || q.startsWith('/tmp/')) q = '/private' + q;
  return q;
}

/**
 * Is the absolute path inside a temp root? Always recognises `/tmp`,
 * `/private/tmp` and `/(private/)var/folders/*​/*​/T`, plus the given roots.
 * @param {string} p absolute path
 * @param {string[]} roots extra temp roots
 * @returns {boolean}
 */
function inTmp(p, roots) {
  const q = canon(p);
  if (q === '/private/tmp' || q.startsWith('/private/tmp/')) return true;
  if (/^\/private\/var\/folders\/[^/]+\/[^/]+\/T(\/|$)/.test(q)) return true;
  return roots.some((r) => {
    if (typeof r !== 'string' || !path.isAbsolute(r)) return false;
    const c = canon(r);
    if (c === '/') return false;
    return q === c || q.startsWith(c + '/');
  });
}

/**
 * Resolve a literal path word (expanding `~`, `$HOME`, `$TMPDIR`) against `cwd`.
 * @param {string} text word text
 * @param {string|null} cwd absolute cwd or null if unknown
 * @param {{home?: string, tmpdir?: string}} env
 * @returns {string|null} absolute path, or null when it cannot be determined
 */
function resolvePath(text, cwd, env) {
  let p = text;
  if (p === '~' || p.startsWith('~/')) {
    if (!env.home) return null;
    p = env.home + p.slice(1);
  } else if (p.startsWith('~')) {
    return null;
  }
  p = p.replace(/\$(?:\{(HOME|TMPDIR)\}|(HOME|TMPDIR)(?![A-Za-z0-9_]))/g, (m, a, b) => {
    const v = (a ?? b) === 'HOME' ? env.home : env.tmpdir;
    return v ?? m;
  });
  if (p.includes('$') || p.includes(SUB)) return null;
  if (!path.isAbsolute(p)) {
    if (!cwd) return null;
    p = path.join(cwd, p);
  }
  return path.resolve(p);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const isVarWord = (t) => /^\$(?:[A-Za-z_]\w*|\{|[0-9@*#?!$-])/.test(t);
const isAssign = (w) => !w.quoted && /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/.test(w.text);

/**
 * Walk parsed commands in order, tracking cwd through `cd`.
 * @param {Cmd[]} commands
 * @param {{cwd: string|null}} state mutated by `cd`
 * @param {{home?: string, tmpdir?: string, tmpRoots: string[], findings: object[]}} ctx
 */
function walk(commands, state, ctx) {
  /** @type {number[]} indices of open `{` group starts */
  const groups = [];
  commands.forEach((cmd, idx) => {
    for (const child of cmd.children) walk(child, { cwd: state.cwd }, ctx);
    if (cmd.funcDef) {
      ctx.findings.push({ effect: 'deny', reason: 'shell-function', message: MSG_FUNCTION });
    }
    // `{ … ; } > f`: the redirect sits on the closing `}` command.
    const first = cmd.words[0];
    if (first && !first.quoted && first.text === '{') groups.push(idx);
    if (first && !first.quoted && first.text === '}' && cmd.words.length === 1 && groups.length) {
      const start = groups.pop();
      const body = commands.slice(start, idx);
      if (body.every((c) => isTextOnlyCmd(c)) && body.some((c) => isTextCmd(c))) {
        checkFileWrite(cmd, state, ctx, true);
      }
    }
    // `( … ) > f`: a subshell is a command with no words and one child list.
    if (cmd.words.length === 0 && cmd.children.length === 1) {
      const body = cmd.children[0];
      if (body.length && body.every((c) => isTextOnlyCmd(c)) && body.some((c) => isTextCmd(c))) {
        checkFileWrite(cmd, state, ctx, true);
      }
    }
    checkFileWrite(cmd, state, ctx, false);
    checkBareRedirect(cmd, state, ctx);
    simple(cmd, state, ctx);
  });
}

/**
 * Is a redirect target a real file outside tmp? `/dev/*` and unresolvable targets
 * (unknown `$VAR`/cwd) are not (fail open).
 * @param {Word} word redirect target / file operand
 * @param {{cwd: string|null}} state
 * @param {{home?: string, tmpdir?: string, tmpRoots: string[]}} ctx
 * @returns {boolean}
 */
function outsideTmp(word, state, ctx) {
  const p = resolvePath(word.text, state.cwd, ctx);
  if (!p) return false;
  const q = canon(p);
  return !(q === '/dev' || q.startsWith('/dev/')) && !inTmp(q, ctx.tmpRoots);
}

/**
 * Flag a redirect with no command (`> f`, `: > f`, `X=1 >> f`) that creates or truncates a
 * file outside tmp. Groups (`{ …; } > f` — the `}` word) and subshells are not bare.
 * @param {Cmd} cmd
 * @param {{cwd: string|null}} state
 * @param {object} ctx
 */
function checkBareRedirect(cmd, state, ctx) {
  if (cmd.funcDef || cmd.children.length || !cmd.redirects.length) return;
  let k = 0;
  // Skip words that open a command (`do : > f`), not closers that carry a compound's
  // redirect (`done > f`, `} > f`).
  while (k < cmd.words.length && !cmd.words[k].quoted && OPENERS.has(cmd.words[k].text)) k++;
  while (k < cmd.words.length && isAssign(cmd.words[k])) k++;
  const rest = cmd.words.slice(k);
  if (rest.length && (rest[0].quoted || rest[0].text !== ':')) return;
  const writes = cmd.redirects.some((r) => !r.dup && /^>[>|]?$/.test(r.op) && outsideTmp(r.target, state, ctx));
  if (writes) ctx.findings.push({ effect: 'deny', reason: 'bare-redirect', message: MSG_BAREREDIRECT });
}

/**
 * Does `env ARGS` run a command with at least one `NAME=value` assignment?
 * `env`, `env -u X`, `env FOO=bar` (print the environment) do not.
 * @param {Word[]} args words after `env`
 * @returns {boolean}
 */
function envRunsWithAssignment(args) {
  let assigns = 0;
  let options = true;
  for (let a = 0; a < args.length; a++) {
    const w = args[a];
    if (options && !w.quoted && w.text === '--') { options = false; continue; }
    if (options && !w.quoted && w.text.startsWith('-')) {
      if (/^-[uCPS]$/.test(w.text)) a++; // option with a separate value
      continue;
    }
    options = false;
    if (isAssign(w)) { assigns++; continue; }
    return assigns > 0; // first command word
  }
  return false;
}

/**
 * Resolve the command word of a simple command (skipping grammar words,
 * assignments and wrappers such as `builtin`).
 * @param {Cmd} cmd
 * @returns {{name: string|null, args: Word[]}}
 */
function headOf(cmd) {
  const ws = cmd.words;
  let k = 0;
  while (k < ws.length && !ws[k].quoted && RESERVED.has(ws[k].text)) k++;
  while (k < ws.length && isAssign(ws[k])) k++;
  while (k < ws.length && !ws[k].quoted && WRAPPERS.has(ws[k].text)) k++;
  if (k >= ws.length) return { name: null, args: [] };
  return { name: ws[k].text, args: ws.slice(k + 1) };
}

/**
 * Does this command produce agent-authored text on stdout? `echo`/`printf`, or
 * `cat` (without file operands) fed by a heredoc/herestring.
 * @param {Cmd} cmd
 * @returns {boolean}
 */
function isTextCmd(cmd) {
  const { name, args } = headOf(cmd);
  if (name === 'echo' || name === 'printf') return true;
  if (name === 'cat') return cmd.stdinText && args.every((a) => a.text.startsWith('-'));
  return false;
}

/**
 * A command that may appear inside a `{ … }` / `( … )` group whose output is flagged:
 * text producers, bare grammar words (`{`, `}`) and empty commands.
 * @param {Cmd} cmd
 * @returns {boolean}
 */
function isTextOnlyCmd(cmd) {
  if (cmd.funcDef) return false;
  return headOf(cmd).name === null || isTextCmd(cmd);
}

/**
 * Flag agent-authored text written to a file outside tmp via a shell redirect or `tee`.
 * @param {Cmd} cmd
 * @param {{cwd: string|null}} state
 * @param {object} ctx
 * @param {boolean} group `cmd` is the redirect carrier of an all-text `{ }` / `( )` group
 */
function checkFileWrite(cmd, state, ctx, group) {
  const { name, args } = headOf(cmd);
  const outside = (word) => outsideTmp(word, state, ctx);
  const flag = () => ctx.findings.push({ effect: 'deny', reason: 'file-write', message: MSG_FILEWRITE });

  if (name === 'tee' && !group) {
    const files = args.filter((a) => !a.text.startsWith('-'));
    const fed = cmd.stdinText || (cmd.pipeFrom !== null && isTextCmd(cmd.pipeFrom));
    if (fed && files.some(outside)) flag();
    return;
  }
  const producer = group || (!cmd.funcDef && isTextCmd(cmd));
  if (!producer) return;
  const writes = cmd.redirects.some(
    (r) => !r.dup && (r.fd === null || r.fd === '1') && /^>[>|]?$/.test(r.op) && outside(r.target),
  );
  if (writes) flag();
}

/**
 * Inspect one simple command.
 * @param {Cmd} cmd
 * @param {{cwd: string|null}} state
 * @param {object} ctx
 */
function simple(cmd, state, ctx) {
  const ws = cmd.words;
  let k = 0;
  while (k < ws.length && !ws[k].quoted && RESERVED.has(ws[k].text)) k++;
  let assigns = 0;
  while (k < ws.length && isAssign(ws[k])) { k++; assigns++; }
  while (k < ws.length && !ws[k].quoted && WRAPPERS.has(ws[k].text)) k++;
  if (k >= ws.length) return;
  const head = ws[k];
  const args = ws.slice(k + 1);

  if (!head.quoted && head.text === 'function' && args.length > 0) {
    ctx.findings.push({ effect: 'deny', reason: 'shell-function', message: MSG_FUNCTION });
    return;
  }
  if (isVarWord(head.text)) {
    ctx.findings.push({
      effect: 'deny',
      reason: assigns > 0 ? 'variable-command-after-assignment' : 'variable-command',
      message: MSG_VARCMD,
    });
    return;
  }
  if (!head.quoted && head.text === 'env' && envRunsWithAssignment(args)) {
    ctx.findings.push({ effect: 'deny', reason: 'env-prefix', message: MSG_ENVPREFIX });
    return;
  }

  const name = head.text;
  if (name === 'cd' || name === 'pushd') {
    const target = args.find((a) => !/^-[LPe@]+$/.test(a.text));
    if (!target) state.cwd = ctx.home ?? null;
    else if (target.text === '-') state.cwd = null;
    else state.cwd = resolvePath(target.text, state.cwd, ctx);
    return;
  }
  if (name === 'popd') { state.cwd = null; return; }

  let script = null;
  if (SHELLS.has(path.basename(name))) {
    for (let a = 0; a < args.length; a++) {
      const t = args[a].text;
      if (t === '--') { script = args[a + 1] ?? null; break; }
      if (t.startsWith('-') || t.startsWith('+')) {
        if (/^-[A-Za-z]*c/.test(t)) return; // `-c '…'`: the config rules handle it
        if (/^[-+][oO]$/.test(t)) a++;
        continue;
      }
      script = args[a];
      break;
    }
    if (!script || script.text.startsWith('<(')) return;
  } else if (name === 'source' || name === '.') {
    // `source FILE` / `. FILE` run the file in the current shell.
    script = args[0]?.text === '--' ? args[1] : args[0];
    if (!script || script.text.startsWith('<(')) return;
  } else if (name.includes('/') || /\.sh$/.test(name)) {
    script = head; // executed directly
  } else {
    return;
  }
  const resolved = resolvePath(script.text, state.cwd, ctx);
  if (resolved && inTmp(resolved, ctx.tmpRoots)) {
    ctx.findings.push({ effect: 'ask', reason: 'tmp-script', message: MSG_TMPSCRIPT });
  }
}

/**
 * Analyse a shell command line.
 * @param {string} command raw command text
 * @param {{cwd?: string, tmpRoots?: string[], home?: string, tmpdir?: string}} [opts]
 *   `tmpdir` is the value of `$TMPDIR` (default: `tmpRoots[0]`, then `process.env.TMPDIR`).
 * @returns {{effect: 'deny'|'ask'|null, message?: string, reason?: string}}
 */
export function analyze(command, opts = {}) {
  const tmpRoots = opts.tmpRoots ?? [];
  const ctx = {
    home: opts.home,
    tmpdir: opts.tmpdir ?? tmpRoots[0] ?? process.env.TMPDIR,
    tmpRoots,
    findings: [],
  };
  const src = String(command ?? '');
  if (unquotedText(src).includes('[?(')) {
    ctx.findings.push({ effect: 'deny', reason: 'unquoted-filter', message: MSG_FILTER });
  }
  walk(parse(src), { cwd: opts.cwd ?? null }, ctx);
  const hit = ctx.findings.find((f) => f.effect === 'deny') ?? ctx.findings[0];
  return hit ? { effect: hit.effect, message: hit.message, reason: hit.reason } : { effect: null };
}

// ---------------------------------------------------------------------------
// Plugin wiring
// ---------------------------------------------------------------------------

/**
 * Temp roots of this machine (see `analyze` for the always-on patterns).
 * @returns {string[]}
 */
export function defaultTmpRoots() {
  const roots = new Set(['/tmp', '/private/tmp']);
  const add = (dir) => {
    if (!dir) return;
    roots.add(dir);
    if (path.basename(dir) === 'opencode') roots.add(path.dirname(dir));
  };
  const base = os.tmpdir();
  add(base);
  try { add(fs.realpathSync(base)); } catch { /* ignore */ }
  if (process.env.TMPDIR) {
    add(process.env.TMPDIR.replace(/\/+$/, ''));
    try { add(fs.realpathSync(process.env.TMPDIR)); } catch { /* ignore */ }
  }
  return [...roots];
}

const STASH_MAX = 500;
const STASH_TTL_MS = 2 * 60 * 1000;
const RANK = { allow: 0, ask: 1, deny: 2 };

/**
 * Plugin setup: register the stash and evaluate hooks.
 * @param {object} ctx OpenCode v2 plugin context
 * @returns {Promise<void>}
 */
async function setup(ctx) {
  // V1 also calls default.setup with a different context — do nothing there.
  if (!ctx?.tool || typeof ctx.tool.hook !== 'function' ||
      !ctx.permission || typeof ctx.permission.hook !== 'function') return;

  const stash = new Map(); // tool call id -> { command, workdir, sessionID, at }
  const dirs = new Map(); // sessionID -> directory
  let logged = false;
  const fail = (where, err) => {
    if (logged) return;
    logged = true;
    console.error(`[shell-style] ${where} failed (fail-open):`, err);
  };

  const sessionDir = async (sessionID) => {
    if (dirs.has(sessionID)) return dirs.get(sessionID);
    let dir;
    try {
      dir = (await ctx.session.get({ sessionID }))?.location?.directory;
    } catch (err) {
      if (!ctx.location?.directory) throw err;
    }
    dir ??= ctx.location?.directory;
    if (typeof dir !== 'string') throw new Error('session directory unavailable');
    if (dirs.size >= 200) dirs.delete(dirs.keys().next().value);
    dirs.set(sessionID, dir);
    return dir;
  };

  try {
    await ctx.tool.hook('execute.before', (e) => {
      try {
        if (e?.tool !== 'shell' || typeof e.input?.command !== 'string' || e.id == null) return;
        stash.delete(e.id);
        stash.set(e.id, {
          command: e.input.command,
          workdir: typeof e.input.workdir === 'string' ? e.input.workdir : undefined,
          sessionID: e.sessionID,
          at: Date.now(),
        });
        while (stash.size > STASH_MAX) stash.delete(stash.keys().next().value);
      } catch (err) {
        fail('execute.before', err);
      }
    });
  } catch (err) {
    fail('execute.before registration', err);
  }

  try {
    await ctx.permission.hook('evaluate', async (ev) => {
      try {
        if (ev?.action !== 'shell' || ev.source?.id == null) return;
        const entry = stash.get(ev.source.id);
        if (!entry || Date.now() - entry.at > STASH_TTL_MS) return;
        if (ev.effect === 'deny') return;

        let cwd;
        if (entry.workdir && path.isAbsolute(entry.workdir)) cwd = entry.workdir;
        else {
          const base = await sessionDir(entry.sessionID ?? ev.sessionID);
          cwd = entry.workdir ? path.resolve(base, entry.workdir) : base;
        }
        const res = analyze(entry.command, {
          cwd,
          tmpRoots: defaultTmpRoots(),
          home: os.homedir(),
          tmpdir: process.env.TMPDIR || os.tmpdir(),
        });
        if (!res.effect) return;
        const before = RANK[ev.effect] ?? 0;
        const after = RANK[res.effect];
        if (after < before) return;
        const changed = after > before;
        if (changed) ev.effect = res.effect;
        if (changed || !ev.message) ev.message = `shell-style: ${res.message}`;
      } catch (err) {
        fail('evaluate', err);
      }
    });
  } catch (err) {
    fail('evaluate registration', err);
  }
}

export default { id: 'shell-style', setup };
