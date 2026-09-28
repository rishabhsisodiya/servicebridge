# Secret rotation

## Partner API keys

Partner API keys (`/settings/partner-keys`) are stored as SHA-256 hashes — the raw
key is shown once at creation and can never be recovered. To rotate a key:

1. Create the replacement key (same name, same scopes) and hand it to the partner.
2. Once the partner confirms the new key works, revoke the old one.

Revocation is immediate: the next request with the old key gets a 401. Revoking a
key does not delete the audit entries that reference it.

## Application encryption keys (`APP_ENCRYPTION_KEYS`)

ERP credentials and other secrets are encrypted with AES-256-GCM. To rotate the
application key, put the new key first in `APP_ENCRYPTION_KEYS`, then run:

```sh
cd backend && npm run secrets:reencrypt
```

This re-encrypts every stored secret with the new key. The old key must stay in
the list until the re-encrypt completes.
