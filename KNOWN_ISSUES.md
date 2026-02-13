# Known Issues

Last updated: February 11, 2026

These issues are acknowledged and currently non-blocking. They are intentionally not fixed yet.

## Credential and Trust UI

1. Credential API failure can leave badge in loading state
   - File: `web/src/app/page.tsx:623`
   - Detail: If `/api/credential` returns `{ success: false }`, agent fallback info is not set and the badge can stay on `Loading...`.
   - Impact: Partial/misleading trust UI state until refresh or code fix.
   - Priority: `P2`

2. Failed credential loads are cached for process lifetime
   - File: `web/src/lib/credential-loader.ts:518`
   - Detail: `getCredential()` caches the first failure result, so transient or startup errors persist until server restart.
   - Impact: `/api/credential` may keep returning failure after credentials are later added.
   - Priority: `P2`

3. Risk rating color mapping does not normalize case
   - File: `web/src/components/VerifiedBadge.tsx:401`
   - Detail: Color checks look for lowercase terms (`low`, `moderate`, `high`) while `overallRating` may be uppercase (for example `LOW RISK`).
   - Impact: Risk severity can render with neutral text color instead of intended severity color.
   - Priority: `P3`
