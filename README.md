# MenoDAO Backend API

> Decentralized dental healthcare platform for Kenya - Backend API

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](https://opensource.org/licenses/AGPL-3.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

MenoDAO is a community-driven dental health membership platform that combines Web3 technology with accessible healthcare delivery in Kenya. This repository contains the NestJS backend API that powers the platform.

## 🌟 Features

- 🔐 **SMS OTP Authentication** - Secure phone-based login with SasaPay M-Pesa integration
- 👥 **Member Management** - Profile, subscription, and history management
- 💳 **M-Pesa Payments** - SasaPay STK Push integration for seamless payments
- 📋 **Claims System** - Submit and track dental treatment claims
- 🏥 **Clinic Management** - Partner clinic registration and approval workflow
- 👨‍⚕️ **Staff Portal** - Clinic staff authentication and patient check-in
- 🔧 **Admin Dashboard** - Platform administration and analytics
- ⛓️ **Blockchain Integration** - NFT minting for membership tiers
- 📊 **Audit Trail** - Full transparency via blockchain transaction logs

## 🏗️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) with TypeScript
- **Database**: PostgreSQL with [Prisma ORM](https://www.prisma.io/)
- **Authentication**: JWT with role-based access control
- **Payments**: SasaPay M-Pesa API
- **SMS**: Configurable SMS provider
- **Blockchain**: Polygon (ethers.js)
- **API Docs**: Swagger/OpenAPI
- **Infrastructure**: AWS ECS, RDS, Secrets Manager
- **CI/CD**: GitHub Actions

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- npm or yarn

### Installation

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
   # Edit .env with your configuration
   ```

4. **Set up database**

   ```bash
   # Create database
   createdb menodao_dev

   # Run migrations
   npx prisma migrate dev

   # Generate Prisma client
   npx prisma generate
   ```

5. **Start development server**
   ```bash
   npm run start:dev
   ```

The API will be available at `http://localhost:3000`

### View API Documentation

Open `http://localhost:3000/api` for interactive Swagger documentation.

## 📚 Documentation

- [Contributing Guide](CONTRIBUTING.md) - How to contribute to the project
- [Security Policy](SECURITY.md) - Security best practices and reporting
- [Database Separation](DATABASE_SEPARATION.md) - Dev/Prod database setup
- [API Documentation](http://localhost:3000/api) - Interactive Swagger docs

## 🔑 Environment Variables

See [.env.example](.env.example) for all required environment variables. Key variables include:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT token signing
- `SASAPAY_*` - SasaPay payment provider credentials
- `SMS_PROVIDER_*` - SMS provider configuration
- `NODE_ENV` - Environment (development/production)

**⚠️ Never commit `.env` files to version control!**

## 🏗️ Project Structure

```
src/
├── admin/          # Admin dashboard endpoints
├── auth/           # Authentication & authorization
├── blockchain/     # Blockchain integration
├── claims/         # Claims management
├── clinics/        # Clinic registration & management
├── contributions/  # Payment processing
├── members/        # Member profiles
├── notifications/  # SMS notifications
├── payments/       # Payment service layer
├── prisma/         # Database client
├── procedures/     # Dental procedures catalog
├── sasapay/        # SasaPay M-Pesa integration
├── sms/            # SMS service
├── staff/          # Staff portal endpoints
├── subscriptions/  # Membership packages
└── visits/         # Patient check-ins & visits
```

## API Endpoints

### Authentication

- `POST /auth/request-otp` - Request OTP code
- `POST /auth/verify-otp` - Verify OTP and get token
- `GET /auth/me` - Get current user

### Members

- `GET /members/profile` - Get full profile
- `PATCH /members/profile` - Update profile
- `GET /members/contributions` - Contribution history
- `GET /members/claims` - Claims history
- `GET /members/transactions` - Blockchain transactions

### Subscriptions

- `GET /subscriptions/packages` - Available packages
- `GET /subscriptions/current` - Current subscription
- `POST /subscriptions/subscribe` - Subscribe to package
- `POST /subscriptions/upgrade` - Upgrade package

### Contributions

- `GET /contributions/summary` - Payment summary
- `POST /contributions/pay` - Initiate payment
- `POST /contributions/webhook` - Payment callback

### Claims

- `GET /claims` - List claims
- `POST /claims` - Submit claim

### Camps

- `GET /camps` - Upcoming camps
- `GET /camps/nearby` - Find nearby camps
- `POST /camps/:id/register` - Register for camp
- `GET /camps/my-registrations` - My registrations

### Blockchain

- `GET /blockchain/transactions` - Public audit log
- `GET /blockchain/transactions/:txHash` - Transaction details

## SMS Provider Integration

The SMS service is designed to work with any HTTP-based SMS provider. Update `src/sms/sms.service.ts` to match your provider's API:

```typescript
const response = await axios.post(
  providerUrl,
  {
    to: phoneNumber,
    message: message,
    sender_id: senderId,
    // Add any other fields your provider requires
  },
  {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Add any other headers your provider requires
    },
  },
);
```

## Smart Contracts

The backend integrates with two smart contracts on Polygon:

1. **MenoDAO NFT Contract** - Membership badge NFTs (Bronze, Silver, Gold)
2. **Treasury Contract** - Contribution recording and claim disbursements

Deploy your contracts and update the addresses in `.env`.

## 🧪 Testing

```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e
```

## 🚢 Deployment

Deployments are automated via GitHub Actions:

- **Dev Environment**: Push to `dev` branch → Deploys to `https://dev-api.menodao.org`
- **Production**: Push to `main` branch → Deploys to `https://api.menodao.org`

Manual deployment via PR comments:

```
/deploy dev    # Deploy to development
/deploy prod   # Deploy to production
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with ❤️ for the Kenyan dental healthcare community
- Powered by Web3 technology for transparency and trust
- Special thanks to all contributors and supporters

## 📞 Contact

- Website: [https://menodao.org](https://menodao.org)
- Twitter: [@MenoDAO](https://twitter.com/MenoDAO)
- Email: hello@menodao.org

## 🔒 Security

For security concerns, please email security@menodao.org. See [SECURITY.md](SECURITY.md) for more details.

---

Made with 🦷 by the MenoDAO community
