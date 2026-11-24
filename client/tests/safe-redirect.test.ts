import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isSafeRedirectPath, isGithubInstallUrl } from '../src/lib/safeRedirect';
import { isAuthLandingPath, isSafeReturnPath } from '../src/lib/authReturn';

describe('learner navigation', () => {
  it('allows relative app destinations and compares only the callback path', () => {
    expect(isSafeReturnPath).toBe(isSafeRedirectPath);
    expect(isSafeReturnPath('/coding/javascript?sort=date#progress')).toBe(true);
    expect(isSafeReturnPath('/learn?x=1')).toBe(true);
    expect(isSafeReturnPath('/learn/../account')).toBe(false);
    expect(isSafeReturnPath('https://example.org/')).toBe(false);
    expect(isAuthLandingPath('/Auth/Confirmed/?next=/coding')).toBe(true);
    expect(isAuthLandingPath('/auth/confirmed-next')).toBe(false);
  });
  it('recognizes the GitHub App installation page', () => {
    expect(isGithubInstallUrl('https://github.com/apps/devshark-garden/installations/new?state=abc')).toBe(true);
    expect(isGithubInstallUrl('https://example.org/apps/devshark-garden/installations/new')).toBe(false);
    expect(isGithubInstallUrl('https://github.com/about')).toBe(false);
  });
});

// Review an added destination alongside the function that validates it.
// Traverse TS/TSX syntax so comments and data strings never count as calls.
const destinations: Record<string, string> = {
  'components/coding/GithubGardenCard.tsx': 'startGithubConnect',
  'components/coding/GithubSettingsPage.tsx': 'startGithubConnect',
  'lib/billing.ts': 'isStripeHostedUrl',
};
const returns = ['components/auth/AuthPages.tsx', 'lib/authLanding.ts', 'lib/authReturn.ts', 'lib/signInDialog.ts'];
const routeParameter = new Set(['next', 'redirect', 'returnTo', 'return']);
const returnStorage = new Set(['devshark:auth-return', 'devshark:signin-dialog-resume']);
const locationCall = /^(?:(?:window|self|globalThis|document)\.)?location\.(?:assign|replace)$/;
const locationWrite = /^(?:(?:window|self|globalThis|document)\.)?location(?:\.href)?$/;
const openWindow = /^(?:window|self|globalThis)\.open$/;

function nameOf(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return nameOf(node.expression);
  if (ts.isPropertyAccessExpression(node)) return nameOf(node.expression) + '.' + node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return nameOf(node.expression) + '.' + node.argumentExpression.text;
  }
  return '';
}

it('inventories full-page navigation and every reader of a return address in client/src', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const seenDestinations: string[] = [];
  const seenReaders: string[] = [];
  let githubApiValidated = false;
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(path => /\.[jt]sx?$/.test(path));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
    const imports: string[] = [];
    const strings = new Map<string, string>();
    const calls = new Set<string>();
    let reader = false;
    let leaves = 0;
    function inspect(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteralLike(node.initializer)) {
        strings.set(node.name.text, node.initializer.text);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        const callee = nameOf(node.expression);
        const arg = node.arguments[0];
        const key = arg && (ts.isStringLiteralLike(arg) ? arg.text : ts.isIdentifier(arg) ? strings.get(arg.text) : undefined);
        calls.add(callee);
        if (locationCall.test(callee) || openWindow.test(callee)) leaves++;
        if (callee === 'takeAuthReturn' || (key && (
          (callee.endsWith('.get') && routeParameter.has(key)) || (callee.endsWith('.getItem') && returnStorage.has(key))
        ))) reader = true;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && locationWrite.test(nameOf(node.left))) leaves++;
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
    const path = file.replaceAll('\\', '/');
    if (leaves) {
      for (let i = 0; i < leaves; i++) seenDestinations.push(path);
      expect(calls.has(destinations[path]), `${path} must use its reviewed destination validator`).toBe(true);
    }
    if (reader) {
      seenReaders.push(path);
      expect(imports.some(specifier => /\/(?:safeRedirect|authReturn)$/.test(specifier)), `${path} must use the shared return-path contract`).toBe(true);
    }
    if (path === 'coding/api.ts') githubApiValidated = calls.has('isGithubInstallUrl');
  }
  expect(seenDestinations.sort()).toEqual(Object.keys(destinations).sort());
  expect(seenReaders.sort()).toEqual(returns);
  expect(githubApiValidated).toBe(true);
});
