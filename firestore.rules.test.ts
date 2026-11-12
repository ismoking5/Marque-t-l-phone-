/**
 * Dirty Dozen security rule verification specifications for KARITÉ D'OR.
 * Covers all 12 adversarial payloads documented in security_spec.md.
 */
export const DIRTY_DOZEN_PAYLOADS = [
  { name: 'Shadow Update on User Profile', collection: 'users', payload: { isVerified: true }, expected: 'PERMISSION_DENIED' },
  { name: 'Self-Admin Escalation on Create', collection: 'users', payload: { role: 'admin' }, expected: 'PERMISSION_DENIED' },
  { name: 'Self-Admin Escalation on Update', collection: 'users', payload: { role: 'admin' }, expected: 'PERMISSION_DENIED' },
  { name: 'Email Spoofing without Verification', collection: 'projects', payload: { email_verified: false }, expected: 'PERMISSION_DENIED' },
  { name: 'PII Blanket Read', collection: 'users', payload: { targetUid: 'other_user' }, expected: 'PERMISSION_DENIED' },
  { name: 'Unscoped List Query on Transactions', collection: 'transactions', payload: { query: 'all' }, expected: 'PERMISSION_DENIED' },
  { name: 'ID Poisoning (>128 chars)', collection: 'projects', payload: { id: 'x'.repeat(200) }, expected: 'PERMISSION_DENIED' },
  { name: 'Value Poisoning (negative balance)', collection: 'users', payload: { balance: -500 }, expected: 'PERMISSION_DENIED' },
  { name: 'Terminal Transaction Tampering', collection: 'transactions', payload: { status: 'approved' }, expected: 'PERMISSION_DENIED' },
  { name: 'Immortal Timestamp Tampering', collection: 'investments', payload: { createdAt: '2020-01-01T00:00:00Z' }, expected: 'PERMISSION_DENIED' },
  { name: 'Project Catalog Hijack', collection: 'projects', payload: { minInvestment: 1 }, expected: 'PERMISSION_DENIED' },
  { name: 'Settings Hijack', collection: 'settings', payload: { referralRate: 50 }, expected: 'PERMISSION_DENIED' },
] as const;
