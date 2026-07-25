# ConnectChat Pro v6.7.3 — group invitations and administration

## Permissions

- Group owner: invite, add and remove members; promote or demote admins.
- Group admin: invite, add and remove ordinary members.
- Group member: chat and participate in calls, without management controls.
- The owner cannot be removed.
- An admin cannot remove another admin; the owner manages admin roles.

Removing a member affects only that group. It never deletes the person's
ConnectChat account.

## Invitations

Invited users see a pending invitation in Groups and can Accept or Decline.
Group owners and admins can also use **Add now** when acceptance is not needed.

## Required one-time Supabase step

Open Supabase → SQL Editor and run:

`v6.7.3-group-invitations-migration.sql`

The migration adds only the invitation table. Existing groups, members,
messages and accounts remain unchanged.
