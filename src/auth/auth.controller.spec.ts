import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockAuthService = {
    requestOtp: jest.fn(),
    verifyOtp: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);

    jest.clearAllMocks();
  });

  describe('requestOtp', () => {
    it('should call authService.requestOtp with phone number', async () => {
      const dto = { phoneNumber: '+254712345678' };
      mockAuthService.requestOtp.mockResolvedValue({ message: 'OTP sent successfully' });

      const result = await controller.requestOtp(dto);

      expect(authService.requestOtp).toHaveBeenCalledWith('+254712345678');
      expect(result).toEqual({ message: 'OTP sent successfully' });
    });
  });

  describe('verifyOtp', () => {
    it('should call authService.verifyOtp with phone and code', async () => {
      const dto = { phoneNumber: '+254712345678', code: '123456' };
      const mockResponse = {
        accessToken: 'jwt-token',
        member: { id: '1', phoneNumber: '+254712345678' },
      };
      mockAuthService.verifyOtp.mockResolvedValue(mockResponse);

      const result = await controller.verifyOtp(dto);

      expect(authService.verifyOtp).toHaveBeenCalledWith('+254712345678', '123456');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getMe', () => {
    it('should return the authenticated user from request', async () => {
      const mockUser = {
        id: 'member-1',
        phoneNumber: '+254712345678',
        fullName: 'Test User',
      };
      const req = { user: mockUser };

      const result = await controller.getMe(req);

      expect(result).toEqual(mockUser);
    });
  });
});
