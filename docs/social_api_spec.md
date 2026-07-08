# Meta (Instagram + Facebook) publishing — owner setup spec

The admin portal can publish a scheduled post straight to the Med&X **Facebook Page**
and **Instagram Business account** through the Meta Graph API. The code is fully
wired; it just needs three owner-provided values. Until they are set, the publish
path stays in a safe **mock/dry-run** mode that logs the exact Graph calls it would
make and names, on screen, exactly what is still missing.

Set these in the admin portal at **PR & Media → Calendar → Meta publishing → Settings**.
They are stored in the shared database (`pr_meta_settings`), never in code.

## What the owner must provide

1. **Facebook Page access token (long-lived)**
   - From a Meta app (developers.facebook.com) with these permissions granted and
     the app connected to the Med&X Page:
     `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`,
     `instagram_content_publish`.
   - Use a **long-lived Page token** (60-day, refreshable), not a short-lived user token.
   - Get it via Graph API Explorer → generate a User token with the scopes above →
     exchange for a long-lived token → call `GET /me/accounts` and copy the Page's
     `access_token`.

2. **Facebook Page ID**
   - The numeric id of the Med&X Facebook Page (Page → About → Page transparency, or
     `GET /me/accounts`). Enables Facebook publishing.

3. **Instagram Business account ID**
   - The IG account must be a **Business/Creator** account **linked to the Page**.
   - Find it with `GET /{page-id}?fields=instagram_business_account`. Enables Instagram
     publishing.

## What happens once they are set

- **Kill switch**: real sends only go out when the *kill switch is ON* in the same
  panel. With it off, every publish request stays a dry-run.
- **Facebook**: one call — `POST /{page-id}/photos` (with a hosted image) or
  `POST /{page-id}/feed` (text only).
- **Instagram**: two calls — `POST /{ig-user-id}/media` (create a container from a
  hosted `image_url` + caption) then `POST /{ig-user-id}/media_publish` (publish the
  returned `creation_id`). Instagram requires an image or video; a text-only post is
  refused before any call is made.
- **Idempotency**: each successful publish writes a `drip_log` marker
  (`meta:<platform>:<calendar_id>`), so the same post can never be published twice.
- **Audit**: every publish and dry-run is recorded in `pr_meta_publish_log`.

## Graph API version

Calls target `https://graph.facebook.com/v21.0`. Bump the version in
`META_GRAPH_BASE` (admin `server.js`) when Meta deprecates it.

## Testing before going live

Use the **Dry-run newest post** button in the settings panel. It builds and shows the
exact ordered Graph calls (URLs + bodies, token redacted) without sending anything, so
request construction can be confirmed before the kill switch is ever turned on.
