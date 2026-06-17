// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { isNewer } from '../../src/server/update-check.js';

describe('isNewer', () => {
  it('detects a higher patch', () => expect(isNewer('0.1.2', '0.1.1')).toBe(true));
  it('detects a higher minor', () => expect(isNewer('0.2.0', '0.1.9')).toBe(true));
  it('detects a higher major', () => expect(isNewer('1.0.0', '0.9.9')).toBe(true));
  it('is false for the same version', () => expect(isNewer('0.1.1', '0.1.1')).toBe(false));
  it('is false for an older version', () => expect(isNewer('0.1.0', '0.1.1')).toBe(false));
  it('ignores a pre-release suffix on latest', () =>
    expect(isNewer('0.1.1-beta', '0.1.1')).toBe(false));
  it('handles missing patch segments', () => expect(isNewer('0.2', '0.1.9')).toBe(true));
});
