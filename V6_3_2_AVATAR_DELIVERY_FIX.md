# ConnectChat Pro Enterprise v6.3.2

## Corrected online status

The signed-in user's own profile always displays **Online**. Contact presence
continues to use the live socket connection and last-seen value.

## Reliable profile photos on other devices

Profile images no longer depend on a browser opening a long-lived Supabase
signed URL. The interface receives a versioned ConnectChat address and the
authenticated application server retrieves the private image from Supabase.

This provides:

- the same photo on laptops and mobiles;
- no expired storage link in the browser;
- cache invalidation whenever a new photo is uploaded;
- authenticated access through the deployed ConnectChat origin;
- profile photos in contacts, the active chat, account controls, Workspace
  Overview, profile pages and user statuses.

No additional database migration is required.
