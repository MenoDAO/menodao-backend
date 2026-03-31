# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MenoDAO Backend, please report it by emailing [security@menodao.org](mailto:security@menodao.org). Please do not create public GitHub issues for security vulnerabilities.

We will respond to your report within 48 hours and work with you to understand and resolve the issue promptly.

## Security Best Practices

### Environment Variables

**NEVER commit sensitive credentials to the repository.** All sensitive configuration should be stored in environment variables or AWS Secrets Manager.

1. Copy `.env.example` to `.env` for local development
2. Fill in your actual credentials in `.env`
3. `.env` is gitignored and will never be committed

### Production Secrets

Production credentials are stored in AWS Secrets Manager:

- Database credentials
- JWT secrets
- Payment provider API keys
- SMS provider credentials

### Database Security

- Production and development databases are completely separated
- Database passwords are rotated regularly
- All connections use SSL/TLS (`sslmode=require`)
- Database access is restricted by security groups

### API Security

- All authenticated endpoints require JWT tokens
- Admin and staff endpoints have role-based access control
- Rate limiting is enabled on all public endpoints
- CORS is configured to allow only trusted domains

### Payment Security

- Payment provider credentials are never exposed to clients
- All payment callbacks are validated
- Transaction data is encrypted at rest
- PCI DSS compliance guidelines are followed

## Dependency Security

We use automated tools to scan for vulnerabilities:

- `npm audit` runs on every build
- Dependabot alerts are enabled
- Critical vulnerabilities are patched within 24 hours

## Secure Development

- All code changes require pull request reviews
- CI/CD pipeline includes security checks
- Secrets are never logged or exposed in error messages
- Input validation is performed on all user inputs

## Compliance

MenoDAO follows industry best practices for:

- Data protection (GDPR-inspired)
- Healthcare data handling
- Financial transaction security
- User privacy

## Contact

For security concerns, contact: [security@menodao.org](mailto:security@menodao.org)
