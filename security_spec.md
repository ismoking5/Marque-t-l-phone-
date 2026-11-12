# KARITÉ D'OR — Security Specification

## 1. Data Invariants
1. **Identity Isolation**: A user can only read or update their own `/users/{userId}` document unless they are a verified administrator (`isAdmin()`).
2. **No Self-Promotion**: Users cannot create or update their `/users/{userId}` document with `role == 'admin'`, nor create documents in `/admins/{userId}`.
3. **Immutable Ownership & Timestamps**: `uid`, `userId`, `referrerUid`, and `createdAt` cannot be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
4. **Terminal State Locking**: Transactions with `status` in `['approved', 'rejected', 'completed']` cannot be altered by non-admin users.
5. **Catalog & Settings Governance**: Only verified admins may create, update, or delete `/projects/{projectId}` and `/settings/{settingId}`.
6. **Strict Schema & Size Guards**: Every document ID matches `^[a-zA-Z0-9_\-]+$` (`<= 128` chars); all strings have bounded `.size()` checks; no unapproved shadow fields allowed (`keys().hasOnly(...)`).
7. **List Query Enforcement**: Every `allow list` rule on PII or user-owned collections checks `resource.data.userId == request.auth.uid` or `resource.data.referrerUid == request.auth.uid` (or `isAdmin()`).

## 2. Dirty Dozen Adversarial Payloads
1. **Shadow Update on User Profile**: `{ ..., isVerified: true }` -> `PERMISSION_DENIED` (blocked by `hasOnly`).
2. **Self-Admin Escalation on Create**: `/users/{uid}` with `role: "admin"` -> `PERMISSION_DENIED`.
3. **Self-Admin Escalation on Update**: `/users/{uid}` updating `role` from `"user"` to `"admin"` -> `PERMISSION_DENIED`.
4. **Email Spoofing**: `request.auth.token.email == 'ismailasawadogo10@gmail.com'` with `email_verified: false` -> `PERMISSION_DENIED`.
5. **PII Blanket Read**: Non-admin user reading `/users/{otherUid}` -> `PERMISSION_DENIED`.
6. **Unscoped List Query on Transactions**: Non-admin listing `/transactions` without `where('userId', '==', uid)` -> `PERMISSION_DENIED`.
7. **ID Poisoning**: Document ID > 128 chars or containing spaces/slashes -> `PERMISSION_DENIED`.
8. **Value Poisoning**: Setting `balance` to a string or negative number -> `PERMISSION_DENIED`.
9. **Terminal Transaction Tampering**: User updating a `pending` or `completed` transaction status to `approved` -> `PERMISSION_DENIED`.
10. **Immortal Timestamp Tampering**: Client supplying a backdated `createdAt` != `request.time` -> `PERMISSION_DENIED`.
11. **Project Catalog Hijack**: Non-admin writing to `/projects/vip_1` -> `PERMISSION_DENIED`.
12. **Settings Hijack**: Non-admin updating `/settings/global` `referralRate` -> `PERMISSION_DENIED`.
