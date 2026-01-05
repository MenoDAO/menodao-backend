# MenoDAO Backend API

NestJS backend for the MenoDAO dental health membership platform.

## Features

- 🔐 **SMS OTP Authentication** - Secure phone-based login with custom SMS provider
- 👥 **Member Management** - Profile, subscription, and history management
- 💳 **Contribution Payments** - M-Pesa/Card payments with onramp API integration
- 📋 **Claims System** - Submit and track dental treatment claims
- 🏕️ **Camp Management** - Find dental camps with geolocation
- ⛓️ **Blockchain Integration** - NFT minting, on-chain contributions & disbursements
- 📊 **Audit Trail** - Full transparency via blockchain transaction logs

## Tech Stack

- **Framework**: NestJS with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with Passport
- **Blockchain**: Polygon (ethers.js)
- **API Docs**: Swagger/OpenAPI

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example env file and configure:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/menodao"

# JWT
JWT_SECRET="your-secure-secret-key"
JWT_EXPIRES_IN="7d"

# SMS Provider (Your custom provider)
SMS_PROVIDER_URL="https://your-sms-api.com/send"
SMS_PROVIDER_API_KEY="your-api-key"
SMS_SENDER_ID="MenoDAO"

# Blockchain (Polygon)
POLYGON_RPC_URL="https://polygon-rpc.com"
PRIVATE_KEY="your-wallet-private-key"
NFT_CONTRACT_ADDRESS="0x..."
TREASURY_CONTRACT_ADDRESS="0x..."

# Onramp/Payment API
ONRAMP_API_URL="https://your-payment-provider.com/api"
ONRAMP_API_KEY="your-api-key"
```

### 3. Set Up Database

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed initial data (optional)
npx prisma db seed
```

### 4. Run the Server

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

### 5. View API Docs

Open http://localhost:3001/api/docs for Swagger documentation.

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
const response = await axios.post(providerUrl, {
  to: phoneNumber,
  message: message,
  sender_id: senderId,
  // Add any other fields your provider requires
}, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
    // Add any other headers your provider requires
  },
});
```

## Smart Contracts

The backend integrates with two smart contracts on Polygon:

1. **MenoDAO NFT Contract** - Membership badge NFTs (Bronze, Silver, Gold)
2. **Treasury Contract** - Contribution recording and claim disbursements

Deploy your contracts and update the addresses in `.env`.

## Development

```bash
# Run tests
npm run test

# Run e2e tests
npm run test:e2e

# Lint
npm run lint
```

## License

MIT
