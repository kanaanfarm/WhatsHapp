# ConnectChat Pro Enterprise v6.3.1

Profile photos are stored in the configured Supabase bucket and linked to the
user account, not to one browser or device.

When a photo is uploaded or removed:

- all connected clients receive a profile-update event;
- contact lists and the active conversation refresh;
- the signed-in user's navigation avatar, account card, workspace overview and
  profile page synchronize with the server value;
- returning to the application tab or window triggers another server refresh,
  covering devices that were temporarily offline.

The same photo therefore appears after login on laptops and mobile devices in
any country where the deployed ConnectChat server and Supabase project are
reachable.
