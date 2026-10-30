// Unit tests for plugins/shell-style.js — run: node --test scripts/test-shell-style.mjs
// (SHELL_STYLE_PLUGIN=/abs/path.js tests a dev copy instead of the live plugin.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const target = process.env.SHELL_STYLE_PLUGIN
  ? pathToFileURL(process.env.SHELL_STYLE_PLUGIN).href
  : new URL('../plugins/shell-style.js', import.meta.url).href;
const { default: plugin, analyze } = await import(target);

const PROJ = '/Users/x/Projects/p';
const TMP = '/Users/x/faketmp';
const base = { cwd: PROJ, tmpRoots: [TMP], tmpdir: TMP, home: '/Users/x' };
const eff = (cmd, over = {}) => analyze(cmd, { ...base, ...over }).effect;

test('deny: shell functions and variable command words', () => {
  const cases = [
    `ACCEPT='x'\nhead_code() { curl -s "https://r/v2/$1"; }\nfor r in a b; do echo "$(head_code $r v)"; done`,
    'function f { ls; }; f',
    'function f() { ls; }',
    'k(){ kubectl "$@"; }; k get pods',
    'k ( ) {\n kubectl get; }',
    'GITHUB_OUTPUT=$o RELEASE_TYPE=$1 $sh $TMPDIR/w.sh',
    'for sh in sh dash; do X=1 $sh w.sh; done',
    'X=1 $K get',
    'echo $(f() { ls; }; f)',
  ];
  for (const c of cases) assert.equal(eff(c), 'deny', c);
});

test('deny messages', () => {
  assert.match(analyze('f(){ ls; }', base).message, /Don't define shell functions/);
  assert.match(analyze('X=1 $K get', base).message, /command word is a variable/);
});

test('deny: unquoted jsonpath / custom-columns filter expressions', () => {
  const cases = [
    'kubectl get pipelinerun -n ci --context admin@k8s -o custom-columns=NAME:.metadata.name,REV:.spec.params[?(@.name==\\"revision\\")].value',
    'kubectl get pods -o jsonpath={.items[?(@.status.phase=="Running")].metadata.name}',
    'echo $(kubectl get pods -o jsonpath={.items[?(@.x=="y")].name})',
  ];
  for (const c of cases) assert.equal(eff(c), 'deny', c);
  assert.match(analyze(cases[1], base).message, /Quote the jsonpath/);
});

test('null: quoted or absent filter expressions', () => {
  const cases = [
    `kubectl get pipelinerun -o 'custom-columns=NAME:.metadata.name,REV:.spec.params[?(@.name=="revision")].value'`,
    `kubectl get pods -o "jsonpath={.items[?(@.x=='y')].name}"`,
    `jq '.[] | select(.a)' f`,
    `echo '[?('`,
    `cat <<'EOF'\n[?(\nEOF`,
    'ls # [?(',
  ];
  for (const c of cases) assert.equal(eff(c), null, c);
});

test('ask: scripts from tmp', () => {
  assert.equal(eff('cd $TMPDIR && sh w.sh'), 'ask');
  assert.equal(eff('sh "$TMPDIR/wersja.sh"'), 'ask');
  assert.equal(eff('GITHUB_OUTPUT=/dev/stdout dash $TMPDIR/w.sh'), 'ask');
  assert.equal(eff('sh w.sh', { cwd: TMP }), 'ask');
  assert.equal(eff('./run.sh', { cwd: TMP }), 'ask');
  assert.equal(eff('bash /private/var/folders/6_/abc/T/opencode/x.sh'), 'ask');
  assert.equal(eff('bash /var/folders/6_/abc/T/x.sh'), 'ask');
  assert.equal(eff('sh /tmp/x.sh'), 'ask');
  assert.equal(eff('bash -e -o pipefail /private/tmp/x.sh'), 'ask');
  assert.equal(eff('cd ~/faketmp2 && sh x.sh', { tmpRoots: [TMP] }), null);
  assert.equal(eff('cd /Users/x/faketmp && sh x.sh'), 'ask');
  assert.equal(eff('(cd $TMPDIR && ls); sh w.sh'), null);
  assert.match(analyze('sh $TMPDIR/w.sh', base).message, /script from \$TMPDIR/);
});

test('ask: source / dot of tmp scripts', () => {
  assert.equal(eff('source $TMPDIR/env.sh'), 'ask');
  assert.equal(eff('. "$TMPDIR/x.sh"'), 'ask');
  assert.equal(eff('cd $TMPDIR && . ./x.sh'), 'ask');
  assert.equal(eff('cd $TMPDIR && source x.sh'), 'ask');
  assert.equal(eff('source /tmp/x.sh'), 'ask');
  assert.equal(eff('FOO=1 . /private/tmp/x.sh'), 'ask');
  assert.equal(eff('source -- $TMPDIR/x.sh'), 'ask');
  assert.equal(eff('. ./x.sh', { cwd: TMP }), 'ask');
  assert.match(analyze('source $TMPDIR/env.sh', base).message, /script from \$TMPDIR/);
});

test('null: source / dot of non-tmp files and plain dots', () => {
  const cases = [
    'source .venv/bin/activate',
    '. ~/.zshrc',
    'source ~/.bashrc',
    '. ./x.sh',
    'ls .',
    'find . -name x',
    'git add .',
    'cd .',
    'cd . && ls .',
    'source',
    '.',
    'source <(kubectl completion bash)',
    '. <(echo hi)',
  ];
  for (const c of cases) assert.equal(eff(c), null, c);
});

test('null: ordinary commands are untouched', () => {
  const cases = [
    `awk 'function f(x){return x} {print f($1)}' f`,
    'echo "a() {"',
    `jq '.a | select(.b) | {c}' f.json`,
    `cat <<EOF\nf() { x; }\nEOF`,
    `cat <<-EOF\n\tf() { x; }\n\tEOF\nls`,
    'sh tools/build.sh',
    'LUA=/x/lua bash tools/build-dist.sh $TMPDIR/out',
    `sh <(yq '.a' .github/workflows/ci.yml)`,
    `bash -c 'ls'`,
    'bash -ec "ls"',
    'echo $HOME',
    'kill $!',
    'rm -rf $TMPDIR/x',
    'kubectl --context admin@k8s get pods',
    'X=$(pwd) make',
    'cd $TMPDIR && ls && cat a.txt',
    'ls # f() { x; }',
    'git log --oneline | head -5',
    'echo hi > $TMPDIR/out.txt 2>&1',
    'arr=(1 2 3); echo ${arr[@]}',
    'if [ -f x ]; then echo ok; fi',
    'for f in *.go; do echo "$f"; done',
    'sh "$@"',
    'sh',
    '',
  ];
  for (const c of cases) assert.equal(eff(c), null, c);
});

test('deny: agent-authored text written to a file outside tmp', () => {
  const cases = [
    'mkdir -p .superpowers/sdd/plan-2 && {\necho "# Raport"\necho\necho "- Commit: x"\n} > .superpowers/sdd/plan-2/report.md',
    `cat > src/lib.rs <<'EOF'\nfn main() {}\nEOF`,
    `cat <<'EOF' > f.rs\nfn main() { }\nEOF`,
    'echo hello > README.md',
    "printf 'a\\nb\\n' >> notes.txt",
    'echo hi >| notes.txt',
    'echo hi &> out.log',
    'builtin echo hi > README.md',
    'echo hi > /Users/x/Projects/p/a.md',
    'echo hi > ~/notes.md',
    'echo hi > $HOME/notes.md',
    'echo "$(date)" > stamp.txt',
    'cd /Users/x/Projects/q && echo hi > a.md',
    `cat <<EOF > .github/workflows/x.yml\nname: x\nEOF`,
    `cat >> f <<-EOF\n\tx\n\tEOF`,
    'cat > f <<< "x"',
    `tee docs/a.md <<EOF\nx\nEOF`,
    `tee -a docs/a.md <<< "x"`,
    'echo hi | tee docs/a.md',
    `cat <<EOF | tee out.txt\nx\nEOF`,
    '{ echo a; echo b; } > f.txt',
    '( echo a; printf b ) > f.txt',
    `{ cat <<EOF\nx\nEOF\n} > f.txt`,
    'for f in a b; do echo $f > out.txt; done',
  ];
  for (const c of cases) assert.equal(eff(c), 'deny', c);
  assert.match(analyze('echo hello > README.md', base).message, /Write files with the write\/edit tool/);
});

test('null: tool output, tmp and device redirects are not flagged', () => {
  const cases = [
    'cargo test > log.txt',
    'git diff > x.patch',
    `yq '.a' f > out.yaml`,
    'jq . a > b',
    'curl -o f https://x',
    'echo x > $TMPDIR/a',
    'echo x >> /tmp/a',
    'echo x > /private/tmp/a',
    `echo x > ${TMP}/a`,
    'cd $TMPDIR && echo x > a',
    'echo x > /dev/null',
    'echo x > /dev/stderr',
    'printf x >&2',
    'echo x 2>&1',
    'echo x 2> err.log',
    `cat <<EOF | kubectl apply -f -\nx\nEOF`,
    'cat a b > c',
    'cat a.txt | tee out.txt',
    'cargo test | tee log.txt',
    'echo x | tee $TMPDIR/a',
    'echo x | tee',
    'echo "echo hi > f"',
    `cat <<'EOF'\necho hi > f\nEOF`,
    `cat <<EOF > $TMPDIR/a\nx\nEOF`,
    '{ echo a; ls; } > f.txt',
    '( cd x; echo a ) > f.txt',
    '{ echo a; } > $TMPDIR/f.txt',
    'echo hi > $UNKNOWN/a', // unresolvable target: fail open
    'for f in a b; do echo $f > out-$f.txt; done',
    'cd "$DIR" && echo hi > a.md', // unknown cwd
    'echo hi',
    'cat < in.txt',
    'cat <<EOF\nx\nEOF',
  ];
  for (const c of cases) assert.equal(eff(c), null, c);
});

test('deny: `env VAR=… cmd` prefix', () => {
  const cases = [
    'env HOME=$PWD/home KUBECONFIG=/nonexistent ansible-playbook site.yaml',
    'env DOCKER_CONFIG=$TMPDIR/anon cosign verify x',
    'env -i PATH=/usr/bin ls',
    'env -u FOO BAR=1 make test',
    'env -- X=1 make',
    'X=1 env Y=2 make',
    'nohup env X=1 sleep 5',
    'cd x && env A=b npm test',
    'echo "$(env X=1 date)"',
    'for f in a b; do env N=$f make; done',
  ];
  for (const c of cases) assert.equal(eff(c), 'deny', c);
  assert.match(analyze(cases[0], base).message, /`env VAR=…` prefix/);
});

test('null: env / printenv without a prefixed command', () => {
  const cases = [
    'env',
    'env | grep ^XDG',
    'env | sort',
    'env -0',
    'env -u FOO',
    'env FOO=bar',
    'printenv',
    'printenv HOME',
    'X=1 make',
    'echo env X=1 make',
    "grep 'env X=1 cmd' f",
    `cat <<'EOF'\nenv X=1 make\nEOF`,
  ];
  for (const c of cases) assert.equal(eff(c), null, c);
});

test('deny: bare redirections with no command', () => {
  const cases = [
    ': > A.log',
    ':> A.log',
    ': >> notes.txt',
    '>file',
    '> out.txt',
    '>> out.txt',
    '>| out.txt',
    'ls; > out.txt',
    'cd /Users/x/Projects/q && : > a.md',
    'for n in a b; do : > out.txt; done',
  ];
  for (const c of cases) assert.equal(eff(c), 'deny', c);
  assert.match(analyze(': > A.log', base).message, /redirect with no command/);
});

test('null: bare redirects to tmp/dev, input redirects and redirects after a real command', () => {
  const cases = [
    ': > $TMPDIR/a.log',
    '> /dev/null',
    ': > /tmp/x',
    '< in.txt',
    'cargo test > log.txt',
    'git diff > x.patch',
    'make 2>&1 > build.log',
    'ls > out.txt',
    ': > $UNKNOWN/a', // unresolvable target: fail open
    'cd "$DIR" && : > a', // unknown cwd
    ':',
    ': "comment"',
    'true',
    'echo ": > f"',
    'for f in a b; do ls $f; done > out.txt',
    'if true; then ls; fi > out.txt',
    'while read l; do echo "$l"; done < in.txt',
    '{ ls; date; } > f.txt',
    '( ls ) > f.txt',
  ];
  for (const c of cases) assert.equal(eff(c), null, c);
});

test('analyze is robust to odd input', () => {
  for (const c of ['"unterminated', "'x", '$(', '`', '((', 'a() ', '<<', 'cat <<EOF', '${', 'echo $((1+2))']) {
    assert.doesNotThrow(() => analyze(c, base), c);
  }
  assert.doesNotThrow(() => analyze('ls'));
});

// ---- plugin wiring ---------------------------------------------------------

async function setupPlugin({ sessionGet } = {}) {
  const hooks = {};
  const ctx = {
    tool: { hook: (n, f) => { hooks['tool:' + n] = f; } },
    permission: { hook: (n, f) => { hooks['perm:' + n] = f; } },
    session: { get: sessionGet ?? (async () => ({ location: { directory: PROJ } })) },
  };
  await plugin.setup(ctx);
  return hooks;
}
const run = (hooks, id, command, effect, extra = {}) => {
  hooks['tool:execute.before']({ tool: 'shell', sessionID: 'ses1', id, input: { command, ...extra } });
  const ev = { sessionID: 'ses1', action: 'shell', resources: [command], source: { type: 'tool', id }, effect };
  return Promise.resolve(hooks['perm:evaluate'](ev)).then(() => ev);
};

test('plugin shape', () => {
  assert.equal(plugin.id, 'shell-style');
  assert.equal(typeof plugin.setup, 'function');
});

test('wiring: allow -> deny with prefixed message', async () => {
  const h = await setupPlugin();
  const ev = await run(h, 'c1', 'k(){ kubectl "$@"; }; k get', 'allow');
  assert.equal(ev.effect, 'deny');
  assert.match(ev.message, /^shell-style: Don't define shell functions/);
});

test('wiring: ask -> deny for deny results', async () => {
  const h = await setupPlugin();
  assert.equal((await run(h, 'c2', 'X=1 $K get', 'ask')).effect, 'deny');
});

test('wiring: allow -> ask for tmp script, ask stays ask', async () => {
  const h = await setupPlugin();
  const ev = await run(h, 'c3', 'sh /tmp/x.sh', 'allow');
  assert.equal(ev.effect, 'ask');
  assert.match(ev.message, /^shell-style: This runs a script/);
  assert.equal((await run(h, 'c4', 'sh /tmp/x.sh', 'ask')).effect, 'ask');
});

test('wiring: env prefix and bare redirect -> deny with prefixed message', async () => {
  const h = await setupPlugin();
  const ev = await run(h, 'c13', 'env HOME=$PWD/home make', 'allow');
  assert.equal(ev.effect, 'deny');
  assert.match(ev.message, /^shell-style: Drop the `env VAR=…` prefix/);
  const ev2 = await run(h, 'c14', ': > A.log', 'ask');
  assert.equal(ev2.effect, 'deny');
  assert.match(ev2.message, /^shell-style: A redirect with no command/);
});

test('wiring: incoming deny is never changed', async () => {
  const h = await setupPlugin();
  const ev = await run(h, 'c5', 'f(){ ls; }', 'deny');
  assert.equal(ev.effect, 'deny');
  assert.equal(ev.message, undefined);
});

test('wiring: ordinary commands unchanged', async () => {
  const h = await setupPlugin();
  const ev = await run(h, 'c6', 'git status', 'allow');
  assert.equal(ev.effect, 'allow');
  assert.equal(ev.message, undefined);
});

test('wiring: stash miss and non-shell actions -> no change', async () => {
  const h = await setupPlugin();
  const ev = { sessionID: 's', action: 'shell', resources: ['x'], source: { type: 'tool', id: 'nope' }, effect: 'allow' };
  await h['perm:evaluate'](ev);
  assert.equal(ev.effect, 'allow');
  h['tool:execute.before']({ tool: 'shell', sessionID: 's', id: 'c7', input: { command: 'f(){ ls; }' } });
  const ev2 = { sessionID: 's', action: 'read', resources: ['x'], source: { type: 'tool', id: 'c7' }, effect: 'allow' };
  await h['perm:evaluate'](ev2);
  assert.equal(ev2.effect, 'allow');
  h['tool:execute.before']({ tool: 'read', sessionID: 's', id: 'c8', input: { command: 'f(){ ls; }' } });
  const ev3 = { sessionID: 's', action: 'shell', resources: ['x'], source: { type: 'tool', id: 'c8' }, effect: 'allow' };
  await h['perm:evaluate'](ev3);
  assert.equal(ev3.effect, 'allow');
});

test('wiring: relative workdir resolves against session dir', async () => {
  const h = await setupPlugin({ sessionGet: async () => ({ location: { directory: '/private/tmp' } }) });
  assert.equal((await run(h, 'c9', 'sh w.sh', 'allow')).effect, 'ask');
  assert.equal((await run(h, 'c10', 'sh w.sh', 'allow', { workdir: '/Users/x/Projects/p' })).effect, 'allow');
});

test('wiring: hook exception -> fail-open, no throw', async () => {
  const origErr = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a);
  try {
    const h = await setupPlugin({ sessionGet: async () => { throw new Error('boom'); } });
    const ev = await run(h, 'c11', 'sh w.sh', 'allow'); // needs session dir -> throws
    assert.equal(ev.effect, 'allow');
    await run(h, 'c12', 'sh w.sh', 'allow');
    assert.equal(logged.length, 1, 'logged once');
    assert.match(String(logged[0][0]), /\[shell-style\]/);
    // a throwing event object must not throw either
    const bad = { get action() { throw new Error('x'); } };
    await assert.doesNotReject(async () => h['perm:evaluate'](bad));
  } finally {
    console.error = origErr;
  }
});

test('setup ignores foreign contexts', async () => {
  await assert.doesNotReject(() => plugin.setup({}));
  await assert.doesNotReject(() => plugin.setup(undefined));
});
