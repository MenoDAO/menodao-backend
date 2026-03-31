# Contributing to MenoDAO Backend

Thank you for your interest in contributing to MenoDAO! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and professional. We're building healthcare infrastructure that impacts real people's lives.

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- AWS CLI (for deployment)
- Git

### Local Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/MenoDAO/menodao-backend.git
   cd menodao-backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your local credentials
   ```

4. **Set up database**

   ```bash
   # Create a local PostgreSQL database
   createdb menodao_dev

   # Run migrations
   npx prisma migrate dev
   ```

5. **Start development server**
   ```bash
   npm run start:dev
   ```

The API will be available at `http://localhost:3000`

## Development Workflow

### Branch Strategy

- `main` - Production branch (protected)
- `dev` - Development branch (protected)
- `feature/*` - Feature branches
- `fix/*` - Bug fix branches

### Making Changes

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write clean, readable code
   - Follow existing code style
   - Add tests for new features
   - Update documentation

3. **Test your changes**

   ```bash
   npm run test
   npm run lint
   npm run build
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

   Use conventional commit messages:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting)
   - `refactor:` - Code refactoring
   - `test:` - Adding or updating tests
   - `chore:` - Maintenance tasks

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a Pull Request on GitHub

### Pull Request Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Ensure all tests pass
- Request review from maintainers
- Address review feedback promptly

## Code Style

- Use TypeScript for all new code
- Follow NestJS conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Avoid deep nesting

## Testing

- Write unit tests for business logic
- Write integration tests for API endpoints
- Aim for >80% code coverage
- Test edge cases and error conditions

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov
```

## Database Changes

When making database schema changes:

1. Create a migration

   ```bash
   npx prisma migrate dev --name your_migration_name
   ```

2. Update Prisma schema in `prisma/schema.prisma`
3. Test migration on local database
4. Include migration files in your PR

## API Documentation

- Document all endpoints using Swagger decorators
- Include request/response examples
- Document error responses
- Update API docs when changing endpoints

## Security

- Never commit sensitive credentials
- Use environment variables for configuration
- Validate all user inputs
- Follow OWASP security guidelines
- Report security vulnerabilities privately

See [SECURITY.md](SECURITY.md) for more details.

## Deployment

Deployments are automated via GitHub Actions:

- Push to `dev` → Deploys to dev environment
- Push to `main` → Deploys to production

Manual deployment commands:

```bash
# Deploy to dev
/deploy dev

# Deploy to production
/deploy prod
```

## Getting Help

- Check existing issues and discussions
- Ask questions in GitHub Discussions
- Join our community channels
- Read the documentation

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see LICENSE file).

## Recognition

Contributors will be recognized in:

- GitHub contributors page
- Release notes
- Project documentation

Thank you for contributing to MenoDAO! 🦷
