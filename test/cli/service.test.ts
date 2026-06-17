// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { AGENT_LABEL, logFilePath, plistPath, renderPlist } from '../../src/cli/service.js';

describe('renderPlist', () => {
  const xml = renderPlist({
    label: AGENT_LABEL,
    nodePath: '/usr/local/bin/node',
    scriptPath: '/opt/tokpet/dist/index.js',
    logPath: '/home/u/.tokpet/logs/tokpet.log',
  });
  it('embeds the label', () => expect(xml).toContain(`<string>${AGENT_LABEL}</string>`));
  it('passes node, script and the start subcommand', () => {
    expect(xml).toContain('<string>/usr/local/bin/node</string>');
    expect(xml).toContain('<string>/opt/tokpet/dist/index.js</string>');
    expect(xml).toContain('<string>start</string>');
  });
  it('runs at load and keeps alive', () => {
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });
  it('routes stdout and stderr to the log path', () => {
    expect(xml).toMatch(
      /<key>StandardOutPath<\/key>\s*<string>\/home\/u\/\.tokpet\/logs\/tokpet\.log<\/string>/,
    );
    expect(xml).toMatch(
      /<key>StandardErrorPath<\/key>\s*<string>\/home\/u\/\.tokpet\/logs\/tokpet\.log<\/string>/,
    );
  });
  it('does not force TOKPET_NO_OPEN so first-run auto-open stays enabled', () => {
    expect(xml).not.toContain('TOKPET_NO_OPEN');
  });
  it('escapes XML metacharacters in interpolated paths', () => {
    const escaped = renderPlist({
      label: AGENT_LABEL,
      nodePath: '/usr/local/bin/node',
      scriptPath: '/opt/A & B/dist/index.js',
      logPath: '/home/u/.tokpet/logs/tokpet.log',
    });
    expect(escaped).toContain('<string>/opt/A &amp; B/dist/index.js</string>');
    expect(escaped).not.toContain('A & B/dist');
  });
});

describe('paths', () => {
  it('plist lives in ~/Library/LaunchAgents', () =>
    expect(plistPath('/home/u')).toBe('/home/u/Library/LaunchAgents/com.tokpet.tokpet.plist'));
  it('log lives under ~/.tokpet/logs', () =>
    expect(logFilePath('/home/u')).toBe('/home/u/.tokpet/logs/tokpet.log'));
});
