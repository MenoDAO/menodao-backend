import {
  fallbackClassification,
  isSymptomOnlyMessage,
} from './intent-fallback';

describe('fallbackClassification', () => {
  it('routes a slot question to availability, not booking', () => {
    const result = fallbackClassification(
      'What open slots are available at Mikindani clinic this week?',
    );
    expect(result.intent).toBe('AVAILABILITY_INQUIRY');
    expect(result.action).toBe('GET_AVAILABILITY');
  });

  it('routes a specific booking request to the booking flow', () => {
    const result = fallbackClassification(
      'Book me a cleaning tomorrow at 10am',
    );
    expect(result.intent).toBe('BOOKING_SESSION');
    expect(result.action).toBe('START_BOOKING');
  });

  it('separates existing-appointment changes from new bookings', () => {
    const result = fallbackClassification('Please cancel my appointment');
    expect(result.intent).toBe('APPOINTMENT_MANAGEMENT');
    expect(result.action).toBeNull();
  });

  it('recognises pricing and coverage questions', () => {
    const result = fallbackClassification(
      'How much is a filling, and does Gold cover it?',
    );
    expect(result.intent).toBe('PRICING_AND_COVERAGE');
  });

  it('recognises clinic directions', () => {
    const result = fallbackClassification('Where is your Mikindani clinic?');
    expect(result.intent).toBe('CLINIC_INFO');
  });

  it('keeps active symptoms in clinical intake', () => {
    const result = fallbackClassification('My gum is bleeding and swollen');
    expect(result.intent).toBe('CLINICAL_INTAKE');
  });

  it('treats a sore tooth as triage, never as a booking request', () => {
    const result = fallbackClassification('my tooth is sore');
    expect(result.intent).toBe('CLINICAL_INTAKE');
    expect(result.action).toBeNull();
  });

  it('still allows an explicit booking when a symptom is mentioned', () => {
    const result = fallbackClassification(
      'My tooth is sore, book me a check-up tomorrow',
    );
    expect(result.intent).toBe('BOOKING_SESSION');
    expect(result.action).toBe('START_BOOKING');
  });

  it('escalates an explicit request for a person', () => {
    const result = fallbackClassification('Can I talk to a human please?');
    expect(result.intent).toBe('HUMAN_HANDOFF');
    expect(result.action).toBe('ESCALATE_TO_HUMAN');
  });

  it('flags a staff phone lookup as a privileged request', () => {
    const result = fallbackClassification('Look up member 0712 345 678');
    expect(result.intent).toBe('ADMIN_DATA_REQUEST');
    expect(result.action).toBe('GET_MEMBER_RECORDS');
    expect(result.entities?.memberPhone).toContain('0712');
  });
});

describe('isSymptomOnlyMessage', () => {
  it('recognises English and Swahili symptom descriptions', () => {
    expect(isSymptomOnlyMessage('my tooth is sore')).toBe(true);
    expect(isSymptomOnlyMessage('jino linaniuma')).toBe(true);
  });

  it('does not treat an explicit booking request as symptom-only', () => {
    expect(
      isSymptomOnlyMessage('my tooth is sore, I want to book an appointment'),
    ).toBe(false);
  });
});
