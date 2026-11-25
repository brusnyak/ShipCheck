# ShipCheck Firestore Security Specification

## 1. Data Invariants
1. User profiles at `/users/{userId}` can only be read, created, or updated by the verified authenticated user matching `userId`.
2. Projects at `/projects/{projectId}` must always belong to an existing authenticated owner (`ownerId == request.auth.uid`), with immutable `ownerId` and `createdAt`.
3. ScanReports at `/scanReports/{reportId}` must strictly enforce `ownerId == request.auth.uid` on writes, lock mutations once `status` is `COMPLETED` or `FAILED`, and only permit `list`/`get` when `isPublic == true` or `ownerId == request.auth.uid`.
4. ScanIssues at `/scanReports/{reportId}/issues/{issueId}` derive parent ownership via `get(/databases/$(database)/documents/scanReports/$(reportId)).data.ownerId == request.auth.uid` on creation/deletion, and inherit parent visibility on read.

## 2. Adversarial Payloads ("Dirty Dozen")
1. Unauthenticated read on `/users/user_1` -> PERMISSION_DENIED.
2. Authenticated non-owner read on `/users/other_user` -> PERMISSION_DENIED.
3. Unverified email write (`email_verified: false`) on `/projects/proj_1` -> PERMISSION_DENIED.
4. Spoofed `ownerId` on `/projects/proj_1` creation -> PERMISSION_DENIED.
5. Shadow field (`isAdmin: true`) injected in `/projects/proj_1` -> PERMISSION_DENIED.
6. Oversized document ID (200 chars) on `/projects/{id}` -> PERMISSION_DENIED.
7. Invalid `targetUrl` (`javascript:alert(1)`) on `/projects/proj_1` -> PERMISSION_DENIED.
8. Client-spoofed `createdAt` timestamp (not `request.time`) -> PERMISSION_DENIED.
9. Immutable `ownerId` mutation during `/projects/proj_1` update -> PERMISSION_DENIED.
10. Blanket list query on `/projects` by unauthenticated user -> PERMISSION_DENIED.
11. Mutating a `COMPLETED` `/scanReports/rep_1` score or status -> PERMISSION_DENIED.
12. Creating an orphaned `/scanReports/missing_parent/issues/iss_1` -> PERMISSION_DENIED.
