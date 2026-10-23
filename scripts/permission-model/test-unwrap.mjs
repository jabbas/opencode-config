/**
 * Tests for permission-model/unwrap.js.
 *   node --test scripts/permission-model/test-unwrap.mjs
 *
 * Plugin directory: env PM_PLUGIN_DIR, default `../../plugins/permission-model` relative to this
 * file, falling back to `../../permission-model` (staging layout).
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
const pluginDir = candidates.find((d) => fs.existsSync(path.join(d, 'unwrap.js'))) ?? candidates[0];
const { parseCommand } = await import(pathToFileURL(path.join(pluginDir, 'parse.js')).href);
const { unwrap, expandVars } = await import(pathToFileURL(path.join(pluginDir, 'unwrap.js')).href);

const HOME = '/Users/tester';
const TMP = '/var/folders/zz/T';
const opts = { cwd: '/work/proj', home: HOME, tmpRoots: [TMP], env: { TMPDIR: `${TMP}/` } };
const inv = (cmd, o = opts) => unwrap(parseCommand(cmd), o);

test('timeout N is peeled', () => {
  const [i] = inv('timeout 60 cargo test');
  assert.equal(i.tool, 'cargo');
  assert.deepEqual(i.args, ['test']);
  assert.deepEqual(i.wrapped, ['timeout']);
  assert.equal(i.unresolved, false);
  assert.equal(i.contextSwitch, false);
  assert.equal(i.cwd, '/work/proj');
});

test('timeout with options and gtimeout', () => {
  const [a] = inv('timeout -s KILL -k 5 60 cargo test');
  assert.equal(a.tool, 'cargo');
  assert.deepEqual(a.wrapped, ['timeout']);
  const [b] = inv('gtimeout --preserve-status 5 make');
  assert.equal(b.tool, 'make');
  assert.deepEqual(b.wrapped, ['timeout']);
});

test('env -u X FOO=1 cmd', () => {
  const [i] = inv('env -u X FOO=1 opencode serve');
  assert.equal(i.tool, 'opencode');
  assert.deepEqual(i.args, ['serve']);
  assert.deepEqual(i.env, { FOO: '1' });
  assert.deepEqual(i.wrapped, ['env']);
});

test('env -i and env alone', () => {
  const [a] = inv('env -i PATH=/bin ls');
  assert.equal(a.tool, 'ls');
  assert.deepEqual(a.env, { PATH: '/bin' });
  const [b] = inv('env');
  assert.equal(b.tool, 'env');
  assert.deepEqual(b.wrapped, []);
});

test('time / nice / nohup / command / builtin / exec', () => {
  assert.deepEqual(inv('nice -n 10 make').map((i) => [i.tool, i.wrapped]), [['make', ['nice']]]);
  assert.deepEqual(inv('nohup server &').map((i) => [i.tool, i.wrapped]), [['server', ['nohup']]]);
  assert.deepEqual(inv('time -p make').map((i) => i.tool), ['make']);
  assert.deepEqual(inv('command -p ls').map((i) => [i.tool, i.wrapped]), [['ls', []]]);
  assert.deepEqual(inv('builtin cd /x').map((i) => i.tool), ['cd']);
  assert.deepEqual(inv('exec -a x node app.js').map((i) => i.tool), ['node']);
  assert.deepEqual(inv('command -v kubectl').map((i) => i.tool), ['command']);
});

test('stacked wrappers keep order outermost first', () => {
  const [i] = inv('timeout 5 nice -n 1 env A=1 kubectl get pods');
  assert.equal(i.tool, 'kubectl');
  assert.deepEqual(i.wrapped, ['timeout', 'nice', 'env']);
  assert.deepEqual(i.env, { A: '1' });
});

test('K=V assignments before the command go to env', () => {
  const [i] = inv('SECRETSPEC_E2E_KUBECONFIG=$TMPDIR/kc cargo test');
  assert.equal(i.tool, 'cargo');
  assert.equal(i.env.SECRETSPEC_E2E_KUBECONFIG, `${TMP}/kc`);
});

test('KUBECONFIG=$TMPDIR/... is expanded to a tmp path', () => {
  const [i] = inv('KUBECONFIG=$TMPDIR/e2e/134.kubeconfig kubectl delete crd x');
  assert.equal(i.tool, 'kubectl');
  assert.equal(i.env.KUBECONFIG, `${TMP}/e2e/134.kubeconfig`);
  assert.equal(i.unresolved, false);
});

test('${TMPDIR}, $HOME and ~ expand; unknown vars stay', () => {
  const [i] = inv('A=${TMPDIR}/x B=$HOME/y C=~/z D=$FOO/w tool');
  assert.deepEqual(i.env, { A: `${TMP}/x`, B: `${HOME}/y`, C: `${HOME}/z`, D: '$FOO/w' });
  assert.equal(expandVars('$HOME/.ssh', { home: HOME }), `${HOME}/.ssh`);
  assert.equal(expandVars('$HOMEX', { home: HOME }), '$HOMEX');
});

test('cd $TMPDIR tracks cwd for later commands', () => {
  const r = inv('cd $TMPDIR && sh w.sh');
  assert.equal(r.length, 2);
  assert.equal(r[0].cwd, '/work/proj');
  assert.equal(r[1].tool, 'sh');
  assert.equal(r[1].cwd, TMP);
});

test('cd with relative / ~ / bare / unknown variable', () => {
  assert.equal(inv('cd sub && ls')[1].cwd, '/work/proj/sub');
  assert.equal(inv('cd ../other && ls')[1].cwd, '/work/other');
  assert.equal(inv('cd ~ && ls')[1].cwd, HOME);
  assert.equal(inv('cd && ls')[1].cwd, HOME);
  assert.equal(inv('cd $HOME/src && ls')[1].cwd, `${HOME}/src`);
  assert.equal(inv('cd "$DIR" && rm -rf x')[1].cwd, null);
  assert.equal(inv('cd - && ls')[1].cwd, null);
  assert.equal(inv('cd $DIR/sub && cd /abs && ls')[2].cwd, '/abs');
});

test('relative cd with unknown cwd stays unknown', () => {
  const r = unwrap(parseCommand('cd sub && ls'), { ...opts, cwd: null });
  assert.equal(r[1].cwd, null);
});

test('cd inside a subshell does not leak out', () => {
  const r = inv('(cd sub && make) ; ls');
  assert.deepEqual(r.map((i) => [i.tool, i.cwd]), [
    ['cd', '/work/proj'],
    ['make', '/work/proj/sub'],
    ['ls', '/work/proj'],
  ]);
});

test("bash -c '…' parses the inside", () => {
  const r = inv("bash -c 'kubectl delete ns x'");
  assert.equal(r.length, 1);
  assert.equal(r[0].tool, 'kubectl');
  assert.deepEqual(r[0].args, ['delete', 'ns', 'x']);
  assert.deepEqual(r[0].wrapped, ['shell-c']);
});

test('timeout 5 bash -c keeps both wrappers (parser does not nest it)', () => {
  const r = inv("timeout 5 bash -c 'kubectl get ns; cd x && make'");
  assert.deepEqual(r.map((i) => i.tool), ['kubectl', 'cd', 'make']);
  assert.ok(r.every((i) => i.wrapped.join() === 'timeout,shell-c'));
  assert.equal(r[2].cwd, '/work/proj/x');
});

test('sh -c scopes cd to the script', () => {
  const r = inv("sh -c 'cd /x && ls' ; pwd");
  assert.deepEqual(r.map((i) => [i.tool, i.cwd]), [['cd', '/work/proj'], ['ls', '/x'], ['pwd', '/work/proj']]);
});

test('env assignments flow into sh -c inner commands', () => {
  const r = inv("AWS_PROFILE=x bash -c 'aws s3 ls'");
  assert.equal(r[0].tool, 'aws');
  assert.equal(r[0].env.AWS_PROFILE, 'x');
});

test('sh -c with dynamic script is unresolved', () => {
  const r = inv('bash -c "$CMD"');
  assert.ok(r.length >= 1);
  assert.ok(r.every((i) => i.unresolved));
});

test('sh script.sh is a plain invocation', () => {
  const [i] = inv('bash $TMPDIR/x.sh arg');
  assert.equal(i.tool, 'bash');
  assert.deepEqual(i.args, ['$TMPDIR/x.sh', 'arg']);
  assert.equal(i.unresolved, false);
  assert.deepEqual(i.wrapped, []);
});

test('xargs kubectl delete is unresolved', () => {
  const [i] = inv('echo a | xargs -I{} -n1 kubectl delete {}').slice(-1);
  assert.equal(i.tool, 'kubectl');
  assert.deepEqual(i.wrapped, ['xargs']);
  assert.equal(i.unresolved, true);
  const [j] = inv('xargs kubectl delete');
  assert.equal(j.unresolved, true);
  assert.deepEqual(j.wrapped, ['xargs']);
});

test('xargs option values are skipped', () => {
  const [i] = inv('xargs -P 4 -I X rm X');
  assert.equal(i.tool, 'rm');
});

test('eval is unresolved', () => {
  const [i] = inv('eval "x"');
  assert.equal(i.tool, 'eval');
  assert.equal(i.unresolved, true);
  assert.deepEqual(i.wrapped, ['eval']);
});

test('variable as tool is unresolved', () => {
  const r = inv('K="kubectl --context a"; $K get pods');
  assert.equal(r.length, 1);
  assert.equal(r[0].tool, '$K');
  assert.equal(r[0].unresolved, true);
});

test('unexpanded variables in the first 3 args are unresolved', () => {
  assert.equal(inv('kubectl delete $KIND $NS')[0].unresolved, true);
  assert.equal(inv('kubectl delete $(cat names)')[0].unresolved, true);
  assert.equal(inv('kubectl get pods -o json -n $NS')[0].unresolved, false); // only the first 3
});

test('safe variables and quoting do not make a command unresolved', () => {
  assert.equal(inv('ls $HOME $TMPDIR $PWD')[0].unresolved, false);
  assert.equal(inv('cat ${HOME}/x $USER')[0].unresolved, false);
  assert.equal(inv('kill $!')[0].unresolved, false);
  assert.equal(inv("echo '$FOO' '$(x)'")[0].unresolved, false);
  assert.equal(inv('$HOME/bin/tool run')[0].tool, `${HOME}/bin/tool`);
  assert.equal(inv('$HOME/bin/tool run')[0].unresolved, false);
});

test('kubectl config use-context sets contextSwitch for later simples', () => {
  const r = inv('kubectl config use-context prod && kubectl delete ns x');
  assert.equal(r.length, 2);
  assert.equal(r[0].contextSwitch, false);
  assert.equal(r[1].contextSwitch, true);
});

test('other context switches', () => {
  // a DYNAMIC value makes the target unknowable → context switch
  assert.equal(inv('export AWS_PROFILE=$P; aws s3 rm s3://b --recursive')[1].contextSwitch, true);
  assert.equal(inv('AWS_PROFILE=$P; aws s3 rm s3://b')[0].contextSwitch, true);
  assert.equal(inv('export KUBECONFIG=$(mktemp); kubectl get pods').at(-1).contextSwitch, true);
  assert.equal(inv('asp prod && aws s3 ls')[1].contextSwitch, true);
  assert.equal(inv('kubectx foo && kubectl get pods')[1].contextSwitch, true);
  assert.equal(inv('kubens foo && kubectl get pods')[1].contextSwitch, true);
  assert.equal(inv('kubectl --context a config set-context --current --namespace=x && kubectl get pods')[1].contextSwitch, true);
  assert.equal(inv('kubectl config set-cluster c; kubectl get pods')[1].contextSwitch, true);
});

test('a scoped AWS_PROFILE=… cmd does not switch context', () => {
  const r = inv('AWS_PROFILE=dev aws s3 ls; aws s3 ls');
  assert.deepEqual(r.map((i) => i.contextSwitch), [false, false]);
  assert.deepEqual(inv('kubectl config view; kubectl get pods').map((i) => i.contextSwitch), [false, false]);
});

test('literal export / assignment of KUBECONFIG and AWS_PROFILE is carried into later invocations (#7, #17)', () => {
  const r = inv('export KUBECONFIG=$TMPDIR/e2e/k && kubectl delete crd x && helm uninstall y');
  assert.equal(r[1].env.KUBECONFIG, `${TMP}/e2e/k`);
  assert.equal(r[2].env.KUBECONFIG, `${TMP}/e2e/k`);
  assert.deepEqual(r.map((i) => i.contextSwitch), [false, false, false]);
  const a = inv('export AWS_PROFILE=x-dev; aws ec2 describe-instances');
  assert.equal(a[1].env.AWS_PROFILE, 'x-dev');
  assert.equal(a[1].contextSwitch, false);
  assert.equal(inv('KUBECONFIG=/tmp/k; kubectl get pods')[0].env.KUBECONFIG, '/tmp/k');
  assert.equal(inv('declare -x AWS_PROFILE=p; aws s3 ls').at(-1).env.AWS_PROFILE, 'p');
  // a one-shot `K=V cmd` does not leak; unset forgets; a subshell / sh -c does not leak out
  assert.equal(inv('KUBECONFIG=/tmp/k kubectl get pods; kubectl get ns')[1].env.KUBECONFIG, undefined);
  assert.equal(inv('export KUBECONFIG=/tmp/k; unset KUBECONFIG; kubectl get ns').at(-1).env.KUBECONFIG, undefined);
  assert.equal(inv("bash -c 'export KUBECONFIG=/tmp/k'; kubectl get ns").at(-1).env.KUBECONFIG, undefined);
  // exported variables DO reach a child shell
  assert.equal(inv("export KUBECONFIG=/tmp/k; bash -c 'kubectl get ns'").at(-1).env.KUBECONFIG, '/tmp/k');
  // a dynamic value forgets the earlier literal and switches context
  const d = inv('export KUBECONFIG=/tmp/k; export KUBECONFIG=$X; kubectl get ns').at(-1);
  assert.equal(d.env.KUBECONFIG, undefined);
  assert.equal(d.contextSwitch, true);
});

test('literal variables assigned earlier in the same command are exposed as inv.vars (#13)', () => {
  const r = inv('D=$TMPDIR/x; E=$D/sub; bash $E/y.sh');
  assert.deepEqual(r.at(-1).vars, { D: `${TMP}/x`, E: `${TMP}/x/sub` });
  assert.equal(inv('bash y.sh')[0].vars, undefined);
  // a dynamic value is not recorded, and replaces an earlier literal
  assert.equal(inv('D=/a; D=$(date); bash $D/y.sh').at(-1).vars, undefined);
  // scoped to the command: a subshell does not leak
  assert.equal(inv('(D=/a); bash $D/y.sh').at(-1).vars, undefined);
});

test('$VAR inside [[ ]] / [ ] / test is a comparison operand, not an unresolved command (#10)', () => {
  assert.equal(inv('[[ "$TAG" =~ ^v([0-9]+)$ ]] && echo ok')[0].unresolved, false);
  assert.deepEqual(inv('[[ "$TAG" =~ ^v([0-9]+)$ ]]').map((i) => i.tool), ['[[']);
  assert.equal(inv('[ "$X" = y ]')[0].unresolved, false);
  assert.equal(inv('test -n "$X"')[0].unresolved, false);
  assert.equal(inv('echo "$X"')[0].unresolved, true);
});

test('switch inside sh -c propagates conservatively', () => {
  const r = inv("bash -c 'kubectl config use-context x'; kubectl delete ns y");
  assert.equal(r[r.length - 1].contextSwitch, true);
});

test('redirects, heredoc and raw are passed through', () => {
  const [i] = inv('echo hi > out.txt');
  assert.deepEqual(i.redirects.map((r) => r.op), ['>']);
  assert.equal(i.raw, 'echo hi > out.txt');
  const [h] = inv("cat > f <<'EOF'\nbody\nEOF");
  assert.equal(h.heredoc, true);
});

test('for/case/while headers and function definitions are skipped', () => {
  const r = inv('for i in a b; do echo $i; done');
  assert.deepEqual(r.map((i) => i.tool), ['echo']);
  const w = inv('while read x; do kubectl get pods; done');
  assert.ok(w.every((i) => i.tool !== 'while'));
});

test('substitution commands are emitted too', () => {
  const r = inv('kubectl get pods $(cat f)');
  assert.deepEqual(r.map((i) => i.tool), ['kubectl', 'cat']);
});

test('pipeTo: the next command of a pipe', () => {
  const r = inv('env | grep ^XDG');
  assert.deepEqual(r[0].pipeTo, ['grep', '^XDG']);
  assert.equal(r[1].pipeTo, undefined);
  assert.equal(r[1].stdinFrom, 'pipe');
  const chain = inv('env | grep -i ^X | head -3');
  assert.deepEqual(chain[0].pipeTo, ['grep', '-i', '^X']);
  assert.deepEqual(chain[1].pipeTo, ['head', '-3']);
  assert.equal(chain[2].pipeTo, undefined);
});

test('pipeTo: only for real pipes, skipping substitutions in between', () => {
  assert.equal(inv('env && grep ^X')[0].pipeTo, undefined);
  assert.equal(inv('env; grep ^X')[0].pipeTo, undefined);
  const r = inv('echo $(date) | cat');
  assert.deepEqual(r[0].pipeTo, ['cat']);
  const sh = inv("bash -c 'env | grep ^XDG'");
  const env = sh.find((i) => i.tool === 'env');
  assert.deepEqual(env.pipeTo, ['grep', '^XDG']);
});

test('empty input and garbage', () => {
  assert.deepEqual(inv(''), []);
  assert.deepEqual(unwrap([]), []);
});
