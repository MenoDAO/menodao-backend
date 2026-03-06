import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

console.log('=== SMS Configuration Check ===\n');

const smsProvider = process.env.SMS_PROVIDER || 'mock';
console.log(`SMS Provider: ${smsProvider}`);

if (smsProvider === 'mock') {
  console.log(
    '\n⚠️  WARNING: Using MOCK provider - SMS messages will NOT be sent!',
  );
  console.log('   Messages will only be logged to the console.');
  console.log(
    '\n📝 To enable real SMS delivery, configure one of the following:\n',
  );
  console.log('Option 1: Twilio');
  console.log('  - Set SMS_PROVIDER=twilio');
  console.log('  - Set TWILIO_ACCOUNT_SID');
  console.log('  - Set TWILIO_AUTH_TOKEN');
  console.log('  - Set TWILIO_PHONE_NUMBER');
  console.log('  - Run: npm install twilio\n');
  console.log('Option 2: AWS SNS');
  console.log('  - Set SMS_PROVIDER=aws-sns');
  console.log('  - Set AWS_REGION');
  console.log('  - Set AWS_ACCESS_KEY_ID');
  console.log('  - Set AWS_SECRET_ACCESS_KEY');
  console.log('  - Run: npm install aws-sdk\n');
} else if (smsProvider === 'twilio') {
  console.log('\n✅ Twilio provider configured');
  console.log(
    `   Account SID: ${process.env.TWILIO_ACCOUNT_SID ? '✓ Set' : '✗ Missing'}`,
  );
  console.log(
    `   Auth Token: ${process.env.TWILIO_AUTH_TOKEN ? '✓ Set' : '✗ Missing'}`,
  );
  console.log(
    `   Phone Number: ${process.env.TWILIO_PHONE_NUMBER || '✗ Missing'}`,
  );

  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_PHONE_NUMBER
  ) {
    console.log(
      '\n⚠️  WARNING: Twilio credentials incomplete - will fall back to mock provider',
    );
  }
} else if (smsProvider === 'aws-sns' || smsProvider === 'sns') {
  console.log('\n✅ AWS SNS provider configured');
  console.log(`   Region: ${process.env.AWS_REGION || '✗ Missing'}`);
  console.log(
    `   Access Key ID: ${process.env.AWS_ACCESS_KEY_ID ? '✓ Set' : '✗ Missing'}`,
  );
  console.log(
    `   Secret Access Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✓ Set' : '✗ Missing'}`,
  );

  if (
    !process.env.AWS_REGION ||
    !process.env.AWS_ACCESS_KEY_ID ||
    !process.env.AWS_SECRET_ACCESS_KEY
  ) {
    console.log(
      '\n⚠️  WARNING: AWS SNS credentials incomplete - will fall back to mock provider',
    );
  }
}

console.log('\n=== End of Configuration Check ===');
