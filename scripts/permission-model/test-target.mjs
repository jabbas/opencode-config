/**
 * Tests for permission-model/target.js (target resolver, spec §4.6).
 *   node --test scripts/permission-model/test-target.mjs
 *
 * Plugin directory: env PM_PLUGIN_DIR, default `../../plugins/permission-model` relative to this
 * file, falling back to `../../permission-model` (staging layout). `readFile` is injected, so the
 * real ~/.kube/config is never touched.
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
const pluginDir = candidates.find((d) => fs.existsSync(path.join(d, 'target.js'))) ?? candidates[0];
const load = (f) => import(pathToFileURL(path.join(pluginDir, f)).href);
const { parseCommand } = await load('parse.js');
const { unwrap } = await load('unwrap.js');
const { DEFAULTS } = await load('config.js');
const { resolveTarget, matchPattern, inTmp } = await load('target.js');

const HOME = '/Users/tester';
const TMP = '/var/folders/zz/T';
const cfg = DEFAULTS;
const reads = [];
const readFile = (p) => {
  reads.push(p);
  return p === `${HOME}/.kube/config` ? 'apiVersion: v1\ncurrent-context: admin@k8s\nkind: Config\n' : undefined;
};
const base = { home: HOME, tmpRoots: [TMP], readFile, env: {} };
const target = (cmd, over = {}, config = cfg) => {
  const o = { ...base, ...over };
  const invs = unwrap(parseCommand(cmd), { cwd: '/work', home: o.home, tmpRoots: o.tmpRoots, env: { TMPDIR: TMP } });
  return resolveTarget(invs[invs.length - 1], config, o);
};

test('matchPattern: * any (incl. /), ? one char, full match', () => {
  assert.equal(matchPattern('kind-x', 'kind-*'), true);
  assert.equal(matchPattern('kind', 'kind-*'), false);
  assert.equal(matchPattern('a/b/c', '*c'), true);
  assert.equal(matchPattern('ab', 'a?'), true);
  assert.equal(matchPattern('abc', 'a?'), false);
  assert.equal(matchPattern('a.b', 'a.b'), true);
  assert.equal(matchPattern('axb', 'a.b'), false);
  assert.equal(matchPattern('x-prod', '*-prod'), true);
  assert.equal(matchPattern('x-prod2', '*-prod'), false);
});

test('kubectl --context kind-* → dev', () => {
  const t = target('kubectl --context kind-x get pods');
  assert.equal(t.kind, 'k8s');
  assert.equal(t.name, 'kind-x');
  assert.equal(t.cls, 'dev');
  assert.match(t.source, /context/);
});

test('--context=X form and helm --kube-context', () => {
  assert.equal(target('kubectl --context=kind-y get pods').name, 'kind-y');
  const h = target('helm --kube-context admin@k8s history x');
  assert.deepEqual([h.kind, h.name, h.cls], ['k8s', 'admin@k8s', 'home']);
  assert.equal(target('helm history x --kube-context=admin@k8s').cls, 'home');
});

test('no flag → current-context of ~/.kube/config (home)', () => {
  const t = target('kubectl get pods');
  assert.deepEqual([t.kind, t.name, t.cls], ['k8s', 'admin@k8s', 'home']);
  assert.match(t.source, /kube/);
});

test('prod, unknown and missing kubeconfig', () => {
  assert.equal(target('kubectl --context prod-eu1 get').cls, 'prod');
  assert.equal(target('kubectl --context eu1-prod get').cls, 'prod');
  assert.equal(target('kubectl --context foo get').cls, 'unknown');
  assert.equal(target('kubectl get pods', { readFile: () => undefined }).cls, 'unknown');
  assert.equal(target('kubectl get pods', { readFile: () => 'kind: Config\n' }).cls, 'unknown');
});

test('--kubeconfig in tmp → dev without reading it', () => {
  reads.length = 0;
  const t = target('kubectl --kubeconfig $TMPDIR/kc get');
  assert.equal(t.cls, 'dev');
  assert.equal(t.kind, 'k8s');
  assert.deepEqual(reads, []);
  assert.equal(target(`kubectl --kubeconfig=${TMP}/e2e/kc get`).cls, 'dev');
});

test('KUBECONFIG in the command env behaves like --kubeconfig', () => {
  assert.equal(target('KUBECONFIG=$TMPDIR/e2e/134.kubeconfig kubectl delete crd x').cls, 'dev');
  const t = target('KUBECONFIG=/other/kc kubectl get pods', {
    readFile: (p) => (p === '/other/kc' ? 'current-context: "x-prod"\n' : undefined),
  });
  assert.deepEqual([t.name, t.cls], ['x-prod', 'prod']);
});

test('--kubeconfig outside tmp: current-context is read from that file, every time', () => {
  let content = 'current-context: kind-a\n';
  const rf = (p) => (p === '/other/kc' ? content : undefined);
  assert.equal(target('kubectl --kubeconfig /other/kc get', { readFile: rf }).cls, 'dev');
  content = 'current-context: admin@k8s\n';
  assert.equal(target('kubectl --kubeconfig /other/kc get', { readFile: rf }).cls, 'home');
  assert.equal(target('kubectl --kubeconfig /missing get', { readFile: rf }).cls, 'unknown');
});

test('--context wins over the kubeconfig current-context', () => {
  assert.equal(target('kubectl --kubeconfig /other/kc --context kind-q get', { readFile: () => 'current-context: x-prod' }).cls, 'dev');
});

test('flux and kubeseal resolve like kubectl', () => {
  assert.equal(target('flux reconcile ks x --context kind-z').cls, 'dev');
  assert.equal(target('flux get ks').cls, 'home');
  assert.equal(target('kubeseal --context foo < s.yaml').cls, 'unknown');
});

test('variable in the context name → unknown', () => {
  assert.equal(target('kubectl --context $CTX get pods').cls, 'unknown');
});

test('aws: default profile → unknown', () => {
  const t = target('aws s3 ls');
  assert.deepEqual([t.kind, t.name, t.cls], ['aws', 'default', 'unknown']);
  assert.match(t.source, /default/);
});

test('aws --profile / env profiles', () => {
  const d = target('aws --profile work-dev ec2 describe-instances');
  assert.deepEqual([d.kind, d.name, d.cls], ['aws', 'work-dev', 'dev']);
  assert.equal(target('aws ec2 describe-instances --profile=work-dev').cls, 'dev');
  const p = target('AWS_PROFILE=x-prod aws s3 rm s3://b');
  assert.deepEqual([p.name, p.cls], ['x-prod', 'prod']);
  const s = target('aws s3 ls', { env: { AWS_PROFILE: 'srv-test' } });
  assert.deepEqual([s.name, s.cls], ['srv-test', 'dev']);
  // the flag beats the command env, which beats the server env
  assert.equal(target('AWS_PROFILE=a-prod aws --profile b-dev s3 ls', { env: { AWS_PROFILE: 'c-prod' } }).name, 'b-dev');
  assert.equal(target('AWS_PROFILE=a-dev aws s3 ls', { env: { AWS_PROFILE: 'c-prod' } }).name, 'a-dev');
  assert.equal(target('aws --profile $P s3 ls').cls, 'unknown');
});

test('talosctl: nodes / context', () => {
  const t = target('talosctl -n 10.1.250.11 usage');
  assert.deepEqual([t.kind, t.name, t.cls], ['talos', '10.1.250.11', 'unknown']);
  assert.equal(target('talosctl --nodes 10.1.250.11 usage').name, '10.1.250.11');
  assert.equal(target('talosctl --nodes=10.1.250.11 usage').name, '10.1.250.11');
  const c = target('talosctl --context admin@k8s get members');
  assert.deepEqual([c.name, c.cls], ['admin@k8s', 'home']);
  const listed = target('talosctl -n 10.1.250.11 usage', {}, { ...cfg, targets: { ...cfg.targets, home: ['admin@k8s', '10.1.250.*'] } });
  assert.equal(listed.cls, 'home');
  const none = target('talosctl version');
  assert.deepEqual([none.kind, none.cls], ['talos', 'unknown']);
});

test('cloud CLIs are always prod', () => {
  for (const cmd of ['gh pr create', 'wrangler deploy', 'cf zones list', 'jk run ls', 'ant apply', 'crane ls x', 'docker push img', 'podman push img', 'podman image push img', 'stitch generate']) {
    const t = target(cmd);
    assert.deepEqual([cmd, t.kind, t.cls], [cmd, 'cloud', 'prod']);
  }
  assert.equal(target('docker build .').kind, 'local');
  assert.equal(target('podman run x').kind, 'local');
});

test('git push/fetch/pull/clone → git home', () => {
  const t = target('git push origin main');
  assert.deepEqual([t.kind, t.name, t.cls], ['git', 'origin', 'home']);
  assert.equal(target('git push').name, 'origin');
  assert.equal(target('git fetch upstream').name, 'upstream');
  assert.equal(target('git -C /x pull --rebase').name, 'origin');
  assert.equal(target('git push --force-with-lease fork main').name, 'fork');
  assert.equal(target('git clone https://github.com/a/b').kind, 'git');
  assert.equal(target('git status').kind, 'local');
  assert.equal(target('git commit -m x').kind, 'local');
});

test('local tools', () => {
  for (const cmd of ['cargo test', 'make deploy', 'ls', 'kind create cluster', 'bash $TMPDIR/x.sh']) {
    const t = target(cmd);
    assert.deepEqual([cmd, t.kind, t.cls], [cmd, 'local', 'local']);
  }
});

test('contextSwitch → unknown for external targets', () => {
  const invs = unwrap(parseCommand('kubectl config use-context kind-a && kubectl delete ns x'), { cwd: '/w', home: HOME, tmpRoots: [TMP], env: {} });
  const t = resolveTarget(invs[1], cfg, base);
  assert.equal(t.kind, 'k8s');
  assert.equal(t.cls, 'unknown');
  const a = unwrap(parseCommand('export AWS_PROFILE=x-dev; aws s3 rm s3://b'), { cwd: '/w', home: HOME, tmpRoots: [TMP], env: {} });
  assert.equal(resolveTarget(a[1], cfg, base).cls, 'unknown');
  const g = unwrap(parseCommand('asp x; git push'), { cwd: '/w', home: HOME, tmpRoots: [TMP], env: {} });
  assert.equal(resolveTarget(g[1], cfg, base).cls, 'unknown');
  const l = unwrap(parseCommand('asp x; cargo test'), { cwd: '/w', home: HOME, tmpRoots: [TMP], env: {} });
  assert.equal(resolveTarget(l[1], cfg, base).cls, 'local');
});

test('unresolved tool → none / unknown', () => {
  const t = target('$K get pods');
  assert.deepEqual([t.kind, t.cls], ['none', 'unknown']);
});

test('absolute tool paths resolve by basename', () => {
  assert.equal(target('/usr/local/bin/kubectl --context kind-a get').cls, 'dev');
});

test('class resolution order (R7): kind-* → dev, stricter list wins, nothing → unknown', () => {
  const both = { ...cfg, targets: { ...cfg.targets, dev: [...cfg.targets.dev, 'dev-*', '*-non-prod'] } };
  assert.equal(target('kubectl --context dev-reproduce-prod-bug get', {}, both).cls, 'dev'); // only dev-* matches
  // `work-non-prod` matches dev `*-non-prod` AND default prod `*-prod` → the stricter class wins (see report)
  assert.equal(target('kubectl --context work-non-prod get', {}, both).cls, 'prod');
  // …unless the user drops the generic prod pattern
  const narrowProd = { ...both, targets: { ...both.targets, prod: ['prod-*', 'prd-*'] } };
  assert.equal(target('kubectl --context work-non-prod get', {}, narrowProd).cls, 'dev');
  assert.equal(target('kubectl --context prod-eu1 get').cls, 'prod'); // default prod-*
  assert.equal(target('kubectl --context prd-eu1 get').cls, 'prod');
  assert.equal(target('kubectl --context foo get').cls, 'unknown');
  // really matching several lists: prod > home > dev
  const multi = { ...cfg, targets: { home: ['x-*'], dev: ['x-*', '*-a'], prod: ['*-a'] } };
  assert.equal(target('kubectl --context x-a get', {}, multi).cls, 'prod');
  assert.equal(target('kubectl --context x-b get', {}, multi).cls, 'home');
  assert.equal(target('kubectl --context y-a get', {}, multi).cls, 'prod');
  // kind-* is dev before any list is consulted
  assert.equal(target('kubectl --context kind-prod get', {}, multi).cls, 'dev');
});

test('no hard-coded prod word: a configured-away name is no longer prod', () => {
  const none = { ...cfg, targets: { home: [], dev: [], prod: [] } };
  assert.equal(target('kubectl --context eu1-prod get', {}, none).cls, 'unknown');
});

test('tmp kubeconfig + --context: kind-x → dev, x-prod → prod (R8)', () => {
  assert.equal(target('kubectl --kubeconfig $TMPDIR/kc --context kind-x get').cls, 'dev');
  const p = target('kubectl --kubeconfig $TMPDIR/kc --context x-prod get');
  assert.deepEqual([p.name, p.cls], ['x-prod', 'prod']);
  assert.equal(target('kubectl --kubeconfig $TMPDIR/kc --context whatever get').cls, 'dev');
});

test('server KUBECONFIG with no explicit kube target → unknown (R9)', () => {
  const env = { KUBECONFIG: '/srv/kc' };
  const t = target('kubectl get pods', { env });
  assert.deepEqual([t.kind, t.cls], ['k8s', 'unknown']);
  assert.equal(target('helm list', { env }).cls, 'unknown');
  // explicit targets still win
  assert.equal(target('kubectl --context kind-a get', { env }).cls, 'dev');
  assert.equal(target('kubectl --kubeconfig $TMPDIR/kc get', { env }).cls, 'dev');
  assert.equal(target('KUBECONFIG=$TMPDIR/kc kubectl get', { env }).cls, 'dev');
  assert.equal(target('kubectl --context admin@k8s get', { env }).cls, 'home');
  // not set → default ~/.kube/config
  assert.equal(target('kubectl get pods', { env: {} }).cls, 'home');
});

test('inTmp: roots, /var↔/private/var, /tmp↔/private/tmp, .. escapes', () => {
  assert.equal(inTmp(`${TMP}/a/b`, [TMP]), true);
  assert.equal(inTmp(TMP, [TMP]), true);
  assert.equal(inTmp(`/private${TMP}/a`, [TMP]), true);
  assert.equal(inTmp(`${TMP}/a`, [`/private${TMP}`]), true);
  assert.equal(inTmp('/private/tmp/x', ['/tmp']), true);
  assert.equal(inTmp('/tmp/x', ['/private/tmp']), true);
  assert.equal(inTmp(`${TMP}x/a`, [TMP]), false); // prefix of a sibling
  assert.equal(inTmp(`${TMP}/../etc/passwd`, [TMP]), false);
  assert.equal(inTmp('/home/x', [TMP]), false);
  assert.equal(inTmp('/tmp/x', []), false);
});

test('custom patterns from config', () => {
  const custom = { ...cfg, targets: { home: [], dev: ['sandbox*'], prod: ['live*'] } };
  assert.equal(target('kubectl --context sandbox-1 get', {}, custom).cls, 'dev');
  assert.equal(target('kubectl --context live-1 get', {}, custom).cls, 'prod');
  assert.equal(target('kubectl --context admin@k8s get', {}, custom).cls, 'unknown');
});
