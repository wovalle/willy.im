-- better-auth 1.6 wrote these JSON columns encoded twice ('"[\"openid\"]"') and parsed
-- them twice on read. 1.7 parses once and gets a string: authorize 500s with
-- "registered.find is not a function" and old refresh tokens can't be used. Unwrap
-- the outer layer where the inner text is a JSON array or object; rows 1.7 wrote
-- (encoded once) don't match the WHERE and stay as they are.
UPDATE `oauth_client` SET `redirect_uris` = json_extract(`redirect_uris`, '$')
WHERE json_valid(`redirect_uris`) AND json_type(`redirect_uris`) = 'text'
  AND json_valid(json_extract(`redirect_uris`, '$')) AND json_type(json_extract(`redirect_uris`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_client` SET `post_logout_redirect_uris` = json_extract(`post_logout_redirect_uris`, '$')
WHERE json_valid(`post_logout_redirect_uris`) AND json_type(`post_logout_redirect_uris`) = 'text'
  AND json_valid(json_extract(`post_logout_redirect_uris`, '$')) AND json_type(json_extract(`post_logout_redirect_uris`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_client` SET `scopes` = json_extract(`scopes`, '$')
WHERE json_valid(`scopes`) AND json_type(`scopes`) = 'text'
  AND json_valid(json_extract(`scopes`, '$')) AND json_type(json_extract(`scopes`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_client` SET `grant_types` = json_extract(`grant_types`, '$')
WHERE json_valid(`grant_types`) AND json_type(`grant_types`) = 'text'
  AND json_valid(json_extract(`grant_types`, '$')) AND json_type(json_extract(`grant_types`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_client` SET `response_types` = json_extract(`response_types`, '$')
WHERE json_valid(`response_types`) AND json_type(`response_types`) = 'text'
  AND json_valid(json_extract(`response_types`, '$')) AND json_type(json_extract(`response_types`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_client` SET `contacts` = json_extract(`contacts`, '$')
WHERE json_valid(`contacts`) AND json_type(`contacts`) = 'text'
  AND json_valid(json_extract(`contacts`, '$')) AND json_type(json_extract(`contacts`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_client` SET `metadata` = json_extract(`metadata`, '$')
WHERE json_valid(`metadata`) AND json_type(`metadata`) = 'text'
  AND json_valid(json_extract(`metadata`, '$')) AND json_type(json_extract(`metadata`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_client` SET `client_credentials_scopes` = json_extract(`client_credentials_scopes`, '$')
WHERE json_valid(`client_credentials_scopes`) AND json_type(`client_credentials_scopes`) = 'text'
  AND json_valid(json_extract(`client_credentials_scopes`, '$')) AND json_type(json_extract(`client_credentials_scopes`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_access_token` SET `scopes` = json_extract(`scopes`, '$')
WHERE json_valid(`scopes`) AND json_type(`scopes`) = 'text'
  AND json_valid(json_extract(`scopes`, '$')) AND json_type(json_extract(`scopes`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_access_token` SET `resources` = json_extract(`resources`, '$')
WHERE json_valid(`resources`) AND json_type(`resources`) = 'text'
  AND json_valid(json_extract(`resources`, '$')) AND json_type(json_extract(`resources`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_refresh_token` SET `scopes` = json_extract(`scopes`, '$')
WHERE json_valid(`scopes`) AND json_type(`scopes`) = 'text'
  AND json_valid(json_extract(`scopes`, '$')) AND json_type(json_extract(`scopes`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_refresh_token` SET `resources` = json_extract(`resources`, '$')
WHERE json_valid(`resources`) AND json_type(`resources`) = 'text'
  AND json_valid(json_extract(`resources`, '$')) AND json_type(json_extract(`resources`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_consent` SET `scopes` = json_extract(`scopes`, '$')
WHERE json_valid(`scopes`) AND json_type(`scopes`) = 'text'
  AND json_valid(json_extract(`scopes`, '$')) AND json_type(json_extract(`scopes`, '$')) IN ('array', 'object');
--> statement-breakpoint
UPDATE `oauth_consent` SET `resources` = json_extract(`resources`, '$')
WHERE json_valid(`resources`) AND json_type(`resources`) = 'text'
  AND json_valid(json_extract(`resources`, '$')) AND json_type(json_extract(`resources`, '$')) IN ('array', 'object');
