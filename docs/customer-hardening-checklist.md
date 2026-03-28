# Customer-Grade Hardening Checklist (Deferred)

## Security

- Add MFA (TOTP/WebAuthn)
- Add API key scope UI and rotation policies
- Add WAF and DDoS protections
- Replace local seeded users with proper DB-backed auth

## Reliability

- Add persistent jobs with retries and dead-letter queue
- Add node heartbeat monitoring and automated failover
- Add backup integrity checks and restore test automation

## Compliance and Audit

- Add immutable audit exports
- Add data retention policies per tenant
- Add GDPR delete/export automation

## Operations

- Add SLO dashboards and alerting
- Add runbooks for node outage and backup restore
- Add staged release pipeline and rollback automation
