import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  password: string;
  ad: string;
  soyad: string;
  rol: 'admin' | 'muhasebeci' | 'izleyici';
  aktif: boolean;
  sonGiris: Date | null;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'E-posta zorunludur'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Şifre zorunludur'],
      minlength: [6, 'Şifre en az 6 karakter olmalıdır'],
      select: false,
    },
    ad: {
      type: String,
      required: [true, 'Ad zorunludur'],
    },
    soyad: {
      type: String,
      required: [true, 'Soyad zorunludur'],
    },
    rol: {
      type: String,
      enum: ['admin', 'muhasebeci', 'izleyici'],
      default: 'muhasebeci',
    },
    aktif: {
      type: Boolean,
      default: true,
    },
    sonGiris: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Şifre kayıt öncesi hash'le
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Şifre karşılaştırma metodu
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
