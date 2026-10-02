-- better-auth oauth-provider 1.7 only accepts client credentials sent the way a
-- client registered (1.6 accepted either). Every first-party confidential client
-- either authenticates through @willyim/idp (0.1.0–0.7.0), which posts client_id
-- + client_secret in the form body, or never calls the token endpoint. Register
-- them all as client_secret_post so token exchange and refresh keep working.
-- invoices, icomag, micuarto, kasso, bender, luchy, calque
UPDATE `oauth_client` SET `token_endpoint_auth_method` = 'client_secret_post'
WHERE `client_id` IN (
	'QLacBtRABnNfSghBvJQQLbHFPRMkPzwW',
	'5lH4t0BFEEfq0eXfsgSpMppurssvMqQ9',
	'qpG03iC8UOejpXewtYp6Ymxu1pmSLDxN',
	'vYpB7QvehyWr0hJ1mUeCrqR8AOAlxcRb',
	'gwKjnyfWdEAVrerJMVZMkCLQCnPMGCBh',
	'LZLNWJfyHZQxzQAHwAIWatbefcBoXUQh',
	'GeYsSDmpKShKKvPzGVwMvyCBLPxPuErK'
) AND `token_endpoint_auth_method` = 'client_secret_basic';
