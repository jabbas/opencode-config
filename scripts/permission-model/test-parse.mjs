/**
 * Tests for permission-model/parse.js.
 *   node --test scripts/permission-model/test-parse.mjs
 *
 * The plugin directory is taken from env PM_PLUGIN_DIR; by default
 * `../../plugins/permission-model` relative to this file (repo layout), falling back to
 * `../../permission-model` (staging layout under $TMPDIR/opencode/pm-dev).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.PM_PLUGIN_DIR,
  path.resolve(here, '../../plugins/permission-model'),
  path.resolve(here, '../../permission-model'),
].filter(Boolean);
const pluginDir = candidates.find((d) => fs.existsSync(path.join(d, 'parse.js'))) ?? candidates[0];
const { parseCommand, stripQuotes } = await import(pathToFileURL(path.join(pluginDir, 'parse.js')).href);

const words = (cmd) => parseCommand(cmd).map((s) => s.words);

test('splits on separators', () => {
  const r = parseCommand('a; b && c | d');
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((s) => s.words[0]), ['a', 'b', 'c', 'd']);
  assert.equal(r[3].stdinFrom, 'pipe');
  assert.equal(r[2].stdinFrom, undefined);
});

test('splits on || & and newline', () => {
  assert.deepEqual(words('a || b & c\nd'), [['a'], ['b'], ['c'], ['d']]);
});

test('heredoc body is not commands', () => {
  const r = parseCommand("cat > f <<'EOF'\nfn main() {}\nrm -rf /\nEOF");
  assert.equal(r.length, 1);
  assert.equal(r[0].heredoc, true);
  assert.equal(r[0].stdinFrom, 'heredoc');
  assert.deepEqual(r[0].words, ['cat']);
  assert.deepEqual(r[0].redirects, [{ op: '>', target: 'f' }]);
});

test('commands after a heredoc terminator are parsed', () => {
  const r = parseCommand('cat <<EOF | kubectl apply -f -\nbody; rm x\nEOF\necho done');
  assert.deepEqual(r.map((s) => s.words[0]), ['cat', 'kubectl', 'echo']);
  assert.equal(r[1].stdinFrom, 'pipe');
});

test('heredoc inside $( ) with unbalanced quotes', () => {
  const r = parseCommand('git commit -m "$(cat <<\'EOF\'\nfix: it\'s (broken\nEOF\n)"; echo after');
  assert.deepEqual(r.map((s) => s.words[0]), ['git', 'cat', 'echo']);
  assert.equal(r[1].nested, 'subst');
  assert.equal(r[1].heredoc, true);
});

test('herestring', () => {
  const r = parseCommand('grep x <<< "a b"');
  assert.equal(r.length, 1);
  assert.equal(r[0].stdinFrom, 'herestring');
  assert.equal(r[0].heredoc, false);
  assert.deepEqual(r[0].words, ['grep', 'x']);
});

test('substitution is nested', () => {
  const r = parseCommand('echo $(kubectl get ns)');
  assert.equal(r.length, 2);
  assert.equal(r[0].nested, undefined);
  assert.deepEqual(r[0].words, ['echo', '$(kubectl get ns)']);
  assert.deepEqual(r[0].dynamic, [false, true]);
  assert.equal(r[1].nested, 'subst');
  assert.deepEqual(r[1].words, ['kubectl', 'get', 'ns']);
});

test('backticks, process substitution and subshell are nested', () => {
  assert.deepEqual(parseCommand('echo `date`').map((s) => s.nested), [undefined, 'subst']);
  const ps = parseCommand("sh <(yq '.a' f.yml)");
  assert.deepEqual(ps.map((s) => s.nested), [undefined, 'subst']);
  assert.deepEqual(ps[0].words, ['sh', "<(yq '.a' f.yml)"]);
  assert.deepEqual(parseCommand('(cd x; ls)').map((s) => s.nested), ['subst', 'subst']);
});

test('substitution inside double quotes is nested, single quotes are not', () => {
  assert.equal(parseCommand('echo "x $(date) y"').length, 2);
  assert.equal(parseCommand("echo 'x $(date) y'").length, 1);
  assert.equal(parseCommand('echo "$(a "$(b)")"').length, 3);
});

test('sh -c script is nested as shell-c', () => {
  const r = parseCommand("sh -c 'kubectl delete ns x; ls'");
  assert.deepEqual(r.map((s) => s.words[0]), ['sh', 'kubectl', 'ls']);
  assert.deepEqual(r.map((s) => s.nested), [undefined, 'shell-c', 'shell-c']);
  assert.equal(parseCommand('bash -lc "echo hi"')[1].nested, 'shell-c');
  assert.equal(parseCommand('bash script.sh -c').length, 1);
});

test('quotes kept', () => {
  const r = parseCommand('kubectl get pods -o \'jsonpath={.items[?(@.x=="y")]}\'');
  assert.equal(r.length, 1);
  assert.equal(r[0].words.length, 5);
  assert.equal(r[0].words[4], 'jsonpath={.items[?(@.x=="y")]}');
  assert.equal(parseCommand('echo "a b" \'c d\' e\\ f')[0].words.join('|'), 'echo|a b|c d|e f');
  assert.equal(parseCommand('echo "a;b && c"').length, 1);
  assert.equal(parseCommand('echo ""')[0].words.length, 2);
});

test('assignments', () => {
  const r = parseCommand('A=1 B=$x cmd arg');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].assigns, [
    { name: 'A', value: '1' },
    { name: 'B', value: '$x', dynamic: true },
  ]);
  assert.deepEqual(r[0].words, ['cmd', 'arg']);
  assert.deepEqual(parseCommand('C="a b" d')[0].assigns, [{ name: 'C', value: 'a b' }]);
  const bare = parseCommand('export K=v; K="kubectl --context x"; $K get');
  assert.deepEqual(bare[1].assigns, [{ name: 'K', value: 'kubectl --context x' }]);
  assert.deepEqual(bare[1].words, []);
  assert.deepEqual(bare[2].words, ['$K', 'get']);
  assert.deepEqual(bare[2].dynamic, [true, false]);
  // a quoted "A=1" is a command word, not an assignment
  assert.deepEqual(parseCommand('"A=1" cmd')[0].assigns, []);
});

test('redirects', () => {
  const r = parseCommand('cmd > out 2>&1');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].words, ['cmd']);
  assert.deepEqual(r[0].redirects, [
    { op: '>', target: 'out' },
    { op: '2>&1', target: '1' },
  ]);
  assert.deepEqual(parseCommand('a >> f 2>/dev/null < in')[0].redirects, [
    { op: '>>', target: 'f' },
    { op: '2>', target: '/dev/null' },
    { op: '<', target: 'in' },
  ]);
  assert.deepEqual(parseCommand('a &> all')[0].redirects, [{ op: '&>', target: 'all' }]);
  assert.deepEqual(parseCommand('echo x > $TMPDIR/f')[0].redirects, [
    { op: '>', target: '$TMPDIR/f', dynamic: true },
  ]);
  assert.deepEqual(parseCommand('echo x 2 > f')[0].words, ['echo', 'x', '2']);
});

test('shell function definitions', () => {
  const r = parseCommand("head_code() { curl -s \"$1\"; }; head_code x");
  assert.equal(r[0].funcDef, true);
  assert.deepEqual(r[0].words, ['head_code']);
  assert.deepEqual(r.map((s) => s.words[0]), ['head_code', 'curl', 'head_code']);
});

test('grammar words are dropped from words', () => {
  assert.deepEqual(words('for f in a b; do kubectl get $f; done'), [
    ['for', 'f', 'in', 'a', 'b'],
    ['kubectl', 'get', '$f'],
  ]);
  assert.deepEqual(words('if ! grep x f; then echo no; fi'), [['grep', 'x', 'f'], ['echo', 'no']]);
  assert.deepEqual(words('time make test'), [['make', 'test']]);
});

test('arithmetic is not a command', () => {
  assert.equal(parseCommand('echo $((1+2))').length, 1);
  assert.equal(parseCommand('(( i++ ))').length, 1);
});

test('substitution hidden in ${…} becomes a nested command', () => {
  const r = parseCommand('echo ${x:-$(rm y)}');
  assert.deepEqual(r.map((s) => s.words), [['echo', '${x:-$(rm y)}'], ['rm', 'y']]);
  assert.deepEqual(r[0].dynamic, [false, true]);
  assert.equal(r[1].nested, 'subst');
  // also inside double quotes, and with backticks
  assert.ok(parseCommand('echo "${x:-$(rm y)}"').some((s) => s.words[0] === 'rm' && s.nested === 'subst'));
  assert.ok(parseCommand('echo ${x:-`rm y`}').some((s) => s.words[0] === 'rm' && s.nested === 'subst'));
});

test('substitution hidden in arithmetic becomes a nested command', () => {
  const r = parseCommand('echo $((1+$(rm y)))');
  assert.deepEqual(r.map((s) => s.words), [['echo', '$((1+$(rm y)))'], ['rm', 'y']]);
  assert.deepEqual(r[0].dynamic, [false, true]);
  assert.equal(r[1].nested, 'subst');
  const cmd = parseCommand('(( i = $(rm y) + 1 ))');
  assert.ok(cmd.some((s) => s.words[0] === 'rm' && s.nested === 'subst'));
  assert.equal(cmd[0].dynamic[0], true);
  // plain arithmetic stays a single command
  assert.equal(parseCommand('echo $((1+2))').length, 1);
});

test('substitution hidden in an array assignment becomes a nested command', () => {
  const r = parseCommand('A=( $(rm y) ) cmd');
  assert.deepEqual(r.map((s) => s.words), [['cmd'], ['rm', 'y']]);
  assert.deepEqual(r[0].assigns, [{ name: 'A', value: '( $(rm y) )', dynamic: true }]);
  assert.equal(r[1].nested, 'subst');
  // a literal array is not dynamic
  assert.deepEqual(parseCommand('A=(a b) cmd')[0].assigns, [{ name: 'A', value: '(a b)' }]);
});

test('heredocExpands: unquoted delimiter expands, quoted does not', () => {
  const yes = parseCommand('cat <<EOF\n$(rm x)\nEOF');
  assert.equal(yes.length, 1); // body is still data
  assert.equal(yes[0].heredoc, true);
  assert.equal(yes[0].heredocExpands, true);
  for (const cmd of ["cat <<'EOF'\n$(rm x)\nEOF", 'cat <<"EOF"\n$(rm x)\nEOF', 'cat <<\\EOF\n$(rm x)\nEOF']) {
    const r = parseCommand(cmd);
    assert.equal(r[0].heredoc, true, cmd);
    assert.equal(r[0].heredocExpands, false, cmd);
  }
  assert.equal(parseCommand('cat <<-EOF\n\t$x\n\tEOF')[0].heredocExpands, true);
  assert.equal(parseCommand('echo hi')[0].heredocExpands, false);
  assert.equal(parseCommand('grep x <<< "$y"')[0].heredocExpands, false);
});

test('comments are skipped, # inside a word is kept', () => {
  assert.deepEqual(words('ls # rm -rf /\npwd'), [['ls'], ['pwd']]);
  assert.deepEqual(words('echo a#b'), [['echo', 'a#b']]);
});

test('raw text of each command', () => {
  const r = parseCommand('a  x ;  b y | c');
  assert.deepEqual(r.map((s) => s.raw), ['a  x', 'b y', 'c']);
  assert.equal(parseCommand("cat <<EOF\nx\nEOF")[0].raw, 'cat <<EOF');
});

test('never throws on broken input', () => {
  for (const bad of ['echo "unterminated', "echo 'x", 'echo $(', 'echo `x', 'cat <<EOF\nno end', '((', ')', '| |', '>', '\\', '$', '']) {
    assert.doesNotThrow(() => parseCommand(bad), bad);
  }
  assert.deepEqual(parseCommand(''), []);
  assert.deepEqual(parseCommand(undefined), []);
});

test('deep nesting does not blow the stack', () => {
  const deep = '$('.repeat(60) + 'ls' + ')'.repeat(60);
  assert.doesNotThrow(() => parseCommand(`echo ${deep}`));
});

test('stripQuotes', () => {
  assert.equal(stripQuotes("'a b'"), 'a b');
  assert.equal(stripQuotes('"a\\"b"'), 'a"b');
  assert.equal(stripQuotes('a\\ b'), 'a b');
  assert.equal(stripQuotes('x"y z"\'w\''), 'xy zw');
  assert.equal(stripQuotes('plain'), 'plain');
});

test('200 KB heredoc parses in < 250 ms', () => {
  const body = 'line of heredoc data with $(cmd) and "quotes" and `ticks`; rm -rf /\n'.repeat(4000);
  assert.ok(body.length > 200 * 1024);
  const cmd = `cat > f <<'EOF'\n${body}EOF\necho after`;
  const t0 = performance.now();
  const r = parseCommand(cmd);
  const ms = performance.now() - t0;
  assert.deepEqual(r.map((s) => s.words[0]), ['cat', 'echo']);
  assert.ok(ms < 250, `took ${ms.toFixed(1)} ms`);
});

test('200 KB heredoc inside $( ) parses in < 250 ms', () => {
  const body = 'data ) ( \' " ` $(x)\n'.repeat(12000);
  const cmd = `git commit -m "$(cat <<'EOF'\n${body}EOF\n)"`;
  const t0 = performance.now();
  const r = parseCommand(cmd);
  const ms = performance.now() - t0;
  assert.deepEqual(r.map((s) => s.words[0]), ['git', 'cat']);
  assert.ok(ms < 250, `took ${ms.toFixed(1)} ms`);
});

test('session-commands fixture: every command parses to well-formed Simples', () => {
  const file = path.join(here, 'fixtures', 'session-commands.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(list.length >= 40, `only ${list.length} entries`);
  for (const e of list) {
    assert.deepEqual(Object.keys(e).sort(), ['agent', 'command', 'cwd', 'id'], e.id);
    const r = parseCommand(e.command);
    assert.ok(r.length >= 1, `${e.id}: no commands`);
    for (const s of r) {
      assert.ok(Array.isArray(s.words) && s.words.every((w) => typeof w === 'string'), e.id);
      assert.equal(s.dynamic.length, s.words.length, e.id);
      assert.equal(typeof s.raw, 'string', e.id);
    }
  }
});

test('session-commands fixture: spot checks', () => {
  const byId = Object.fromEntries(
    JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'session-commands.json'), 'utf8')).map((e) => [e.id, e.command]),
  );
  // K="kubectl …"; $K get → variable command word
  const k = parseCommand(byId['sc-028']);
  assert.equal(k[1].words[0], '$K');
  assert.equal(k[1].dynamic[0], true);
  // heredoc with $(not run) is data
  assert.equal(parseCommand(byId['sc-031']).length, 1);
  // kubectl --context admin@k8s get pods -A
  assert.deepEqual(parseCommand(byId['sc-018'])[0].words, ['kubectl', '--context', 'admin@k8s', 'get', 'pods', '-A']);
  // sh -c nested
  assert.ok(parseCommand(byId['sc-045']).some((s) => s.nested === 'shell-c' && s.words[0] === 'kubectl'));
  // function definition
  assert.ok(parseCommand(byId['sc-029']).some((s) => s.funcDef === true));
});
