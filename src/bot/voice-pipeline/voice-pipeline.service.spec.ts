import { VoicePipelineService } from './voice-pipeline.service';

describe('voice transcription confidence', () => {
  it.each([
    { text: 'I want extraction', confidence: 0.68 },
    {
      text: 'I want extraction',
      confidence: 0.92,
      words: [{ confidence: 0.31 }],
    },
    { text: 'I want extraction' },
    { text: 'um...', confidence: 0.98 },
  ])('asks for a fresh message before routing %j', async (transcription) => {
    const service = new VoicePipelineService(
      { clinic: { findMany: jest.fn().mockResolvedValue([]) } } as never,
      {} as never,
      { transcribeAudio: jest.fn().mockResolvedValue(transcription) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const route = jest.spyOn(service, 'processTextPipeline');
    const result = await service.processVoicePipeline(
      Buffer.from('test audio'),
    );

    expect(result.error).toBe('LOW_CONFIDENCE_TRANSCRIPTION');
    expect(result.patientMessage).toContain('send a clearer recording');
    expect(result.transcript).toBe('');
    expect(route).not.toHaveBeenCalled();
  });
});
