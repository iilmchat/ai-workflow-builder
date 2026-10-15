import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller.js';
import { AuthService, type AuthResult } from './auth.service.js';

/** Стабильные данные тестового пользователя. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'user@example.com';
const TOKEN = 'signed.jwt.token';
const CREATED_AT = '2024-01-01T00:00:00.000Z';

const authResult: AuthResult = {
  accessToken: TOKEN,
  user: { id: USER_ID, email: EMAIL, createdAt: new Date(CREATED_AT) },
};

describe('AuthController', () => {
  let app: INestApplication;
  let service: {
    registerAsync: ReturnType<typeof vi.fn>;
    loginAsync: ReturnType<typeof vi.fn>;
    getMeAsync: ReturnType<typeof vi.fn>;
  };
  let verifyAsync: ReturnType<typeof vi.fn>;
  let authDisabled: boolean;

  beforeEach(async () => {
    authDisabled = false;
    verifyAsync = vi.fn(() => Promise.resolve({ sub: USER_ID, email: EMAIL }));

    service = {
      registerAsync: vi.fn(() => Promise.resolve(authResult)),
      loginAsync: vi.fn(() => Promise.resolve(authResult)),
      getMeAsync: vi.fn(() =>
        Promise.resolve({ id: USER_ID, email: EMAIL, createdAt: new Date(CREATED_AT) }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: service },
        { provide: JwtService, useValue: { verifyAsync } },
        {
          provide: ConfigService,
          useValue: { get: vi.fn(() => authDisabled) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('POST /auth/register', () => {
    it('отвечает 201 и отдаёт токен', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: EMAIL, password: 'test1234' })
        .expect(201);

      expect(response.body).toEqual(
        expect.objectContaining({ accessToken: TOKEN }),
      );
      expect(service.registerAsync).toHaveBeenCalledWith({
        email: EMAIL,
        password: 'test1234',
      });
    });

    it('отвечает 400 на некорректный email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'test1234' })
        .expect(400);

      expect(service.registerAsync).not.toHaveBeenCalled();
    });

    it('отвечает 400 на короткий пароль', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: EMAIL, password: 'short' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('отвечает 200 и отдаёт токен', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: 'test1234' })
        .expect(200);

      expect(response.body).toEqual(expect.objectContaining({ accessToken: TOKEN }));
    });

    it('отвечает 401 при неверном пароле', async () => {
      service.loginAsync.mockRejectedValue(
        new UnauthorizedException('Неверный email или пароль'),
      );

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: 'wrong-password' })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('отвечает 401 без заголовка Authorization (AUTH_DISABLED=false)', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
      expect(service.getMeAsync).not.toHaveBeenCalled();
    });

    it('отвечает 401 при невалидном токене', async () => {
      verifyAsync.mockRejectedValue(new Error('invalid token'));

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer broken')
        .expect(401);
    });

    it('отвечает 200 с валидным токеном', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({ id: USER_ID, email: EMAIL }),
      );
      expect(service.getMeAsync).toHaveBeenCalledWith(USER_ID);
    });

    it('отвечает 200 без токена при AUTH_DISABLED=true (системный пользователь)', async () => {
      authDisabled = true;

      await request(app.getHttpServer()).get('/auth/me').expect(200);
      expect(service.getMeAsync).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001',
      );
    });
  });
});
