import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = {
  profileRow: null as any,
  updateCalls: [] as any[],
};

function selectChain() {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(mockState.profileRow ? [mockState.profileRow] : []),
  };
  return chain;
}

function updateChain() {
  const chain: any = {
    set: (updates: any) => {
      mockState.updateCalls.push(updates);
      return chain;
    },
    where: () => Promise.resolve(),
  };
  return chain;
}

vi.mock('../db/index.js', () => ({
  db: {
    select: () => selectChain(),
    update: () => updateChain(),
  },
}));

const mockVerifyWithCache = vi.fn();
vi.mock('./CertCacheService.js', () => ({
  CertCacheService: { verifyWithCache: (...args: any[]) => mockVerifyWithCache(...args) },
}));

import { CertService } from './CertService.js';

const INSPECTOR_ID = 'inspector-1';

// Regression coverage for the confirmed B5 bug: the inspector-facing
// "Re-verify" button called the public GET /certs/verify/:achiNumber, which
// checked WordPress live but only ever cached the result — it never wrote
// inspector_profiles, so a genuinely-certified inspector (confirmed live
// against WordPress) stayed stuck at 'candidate' in the app forever, no
// matter how many times they re-verified.
describe('CertService.reverifySelf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.profileRow = null;
    mockState.updateCalls = [];
  });

  it('promotes candidate -> certified when WordPress confirms active/certified', async () => {
    mockState.profileRow = { achiNumber: 'ACHI-2026-00001' };
    mockVerifyWithCache.mockResolvedValue({
      valid: true,
      status: 'active',
      issued: '2026-03-01',
      expires: '2027-03-01',
      name: 'Casper',
    });

    const result = await CertService.reverifySelf(INSPECTOR_ID);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.promoted).toBe(true);
      expect(result.valid).toBe(true);
    }
    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0]).toMatchObject({
      achiStatus: 'certified',
      achiIssuedAt: new Date('2026-03-01'),
      achiExpiresAt: new Date('2027-03-01'),
    });
  });

  it('does not touch inspector_profiles when WordPress reports suspended', async () => {
    mockState.profileRow = { achiNumber: 'ACHI-2026-00002' };
    mockVerifyWithCache.mockResolvedValue({ valid: false, status: 'suspended' });

    const result = await CertService.reverifySelf(INSPECTOR_ID);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.promoted).toBe(false);
      expect(result.status).toBe('suspended');
    }
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('does not touch inspector_profiles when WordPress reports expired', async () => {
    mockState.profileRow = { achiNumber: 'ACHI-2026-00003' };
    mockVerifyWithCache.mockResolvedValue({ valid: false, status: 'expired' });

    const result = await CertService.reverifySelf(INSPECTOR_ID);

    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.promoted).toBe(false);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('does not touch inspector_profiles on a transient WordPress error (no false downgrade)', async () => {
    mockState.profileRow = { achiNumber: 'ACHI-2026-00004' };
    mockVerifyWithCache.mockResolvedValue({ valid: false, status: 'error' });

    const result = await CertService.reverifySelf(INSPECTOR_ID);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.promoted).toBe(false);
      expect(result.status).toBe('error');
    }
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('errors without calling WordPress when the inspector has no ACHI number', async () => {
    mockState.profileRow = { achiNumber: null };

    const result = await CertService.reverifySelf(INSPECTOR_ID);

    expect('error' in result).toBe(true);
    expect(mockVerifyWithCache).not.toHaveBeenCalled();
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it('reads the ACHI number from the caller\'s own profile, never trusts a client-supplied one', async () => {
    mockState.profileRow = { achiNumber: 'ACHI-2026-00001' };
    mockVerifyWithCache.mockResolvedValue({ valid: true, status: 'certified' });

    await CertService.reverifySelf(INSPECTOR_ID);

    expect(mockVerifyWithCache).toHaveBeenCalledWith('ACHI-2026-00001');
  });
});
