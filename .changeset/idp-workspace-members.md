---
"@willyim/idp": minor
---

Workspace membership in the management API: `GET`/`PUT /api/v1/apps/{app}/workspaces/{workspaceId}/members` and `DELETE …/members/{userId}`, with `SetWorkspaceMemberInput`, `WorkspaceRoleSchema` (`owner` | `admin` | `member`) and `WorkspaceMemberSchema` in `@willyim/idp/schemas`. These write the rows the workspaces claim carries; until now nothing could.
