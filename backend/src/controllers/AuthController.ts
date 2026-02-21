import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/mongoose/User';
import { config } from '../config';
import { sendSuccess, sendError } from '../utils/api-response';
import { v4 as uuidv4 } from 'uuid';
import { repositoryFactory } from '../repositories/RepositoryFactory';

const auditLogRepo = repositoryFactory.getAuditLogRepository();

function signToken(payload: object): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

export class AuthController {
  /** Kullanıcı girişi */
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        sendError(res, 'E-posta ve şifre zorunludur', 400);
        return;
      }

      const user = await UserModel.findOne({ email, aktif: true }).select('+password');
      if (!user) {
        sendError(res, 'Geçersiz e-posta veya şifre', 401);
        return;
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        sendError(res, 'Geçersiz e-posta veya şifre', 401);
        return;
      }

      const token = signToken({ userId: user._id, role: user.rol });

      // Son giriş tarihini güncelle
      user.sonGiris = new Date();
      await user.save();

      // Audit log
      await auditLogRepo.create({
        logId: uuidv4(),
        kullaniciId: String(user._id),
        islemTipi: 'LOGIN',
        ilgiliTablo: 'users',
        ilgiliKayitId: String(user._id),
        ipAdresi: req.ip || null,
        aciklama: `Kullanıcı girişi: ${user.email}`,
      });

      sendSuccess(res, {
        token,
        user: {
          id: user._id,
          email: user.email,
          ad: user.ad,
          soyad: user.soyad,
          rol: user.rol,
        },
      }, 'Giriş başarılı');
    } catch (error) {
      next(error);
    }
  }

  /** Kullanıcı kaydı */
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, ad, soyad, rol } = req.body;

      if (!email || !password || !ad || !soyad) {
        sendError(res, 'Tüm alanlar zorunludur', 400);
        return;
      }

      const existing = await UserModel.findOne({ email });
      if (existing) {
        sendError(res, 'Bu e-posta adresi zaten kayıtlı', 409);
        return;
      }

      const user = await UserModel.create({
        email,
        password,
        ad,
        soyad,
        rol: rol || 'muhasebeci',
      });

      const token = signToken({ userId: user._id, role: user.rol });

      sendSuccess(res, {
        token,
        user: {
          id: user._id,
          email: user.email,
          ad: user.ad,
          soyad: user.soyad,
          rol: user.rol,
        },
      }, 'Kayıt başarılı', 201);
    } catch (error) {
      next(error);
    }
  }

  /** Mevcut kullanıcı bilgisi */
  static async me(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await UserModel.findById(req.userId);
      if (!user) {
        sendError(res, 'Kullanıcı bulunamadı', 404);
        return;
      }
      sendSuccess(res, {
        id: user._id,
        email: user.email,
        ad: user.ad,
        soyad: user.soyad,
        rol: user.rol,
        sonGiris: user.sonGiris,
      });
    } catch (error) {
      next(error);
    }
  }
}
