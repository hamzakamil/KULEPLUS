/**
 * Platform admin (platform_owner) bootstrap script.
 *
 * Kullanım:  npm run bootstrap:admin -- <email> <password> <name>
 *
 * Argon2id parola hash'ler ve platform_users.is_platform_owner = true olarak kaydeder.
 * İkinci bir owner denemesini DB unique index'i (uq_platform_owner) reddeder.
 */
import 'dotenv/config';
import argon2 from '@node-rs/argon2';
import { getPool, closePool } from '@kuleplus/db';
import { AppError, newId } from '@kuleplus/shared';

const ARGON2_CONFIG = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Kullanım: npm run bootstrap:admin -- <email> <password> <name>');
    process.exit(1);
  }

  const [emailArg, passwordArg, nameArg] = args;

  if (!emailArg.includes('@') || emailArg.length < 5) {
    throw new Error('Geçerli bir e-posta adresi girin');
  }
  if (passwordArg.length < 6 || passwordArg.length > 8) {
    throw new Error('Parola 6 ile 8 karakter arasında olmalıdır');
  }

  const pool = getPool('app');

  try {
    const passwordHash = await argon2.hash(passwordArg, ARGON2_CONFIG);
    const now = new Date();
    const userId = newId();
    const platformUserId = newId();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO users (id, email, password_hash, password_changed_at, status, created_at, updated_at, version)
         VALUES ($1, $2, $3, $4, 'active', $4, $4, 1)`,
        [userId, emailArg.toLowerCase(), passwordHash, now],
      );

      await client.query(
        `INSERT INTO platform_users (id, user_id, is_platform_owner, status, created_at, updated_at)
         VALUES ($1, $2, true, 'active', $3, $3)`,
        [platformUserId, userId, now],
      );

      await client.query(
        `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, new_values, created_at)
         VALUES ($1, NULL, $2, 'platform_owner_bootstrap', 'platform_user', $3, $4, $5)`,
        [
          newId(),
          userId,
          platformUserId,
          JSON.stringify({ email: emailArg.toLowerCase(), name: nameArg }),
          now,
        ],
      );

      await client.query('COMMIT');
      console.log('Admin hesabı oluşturuldu:');
      console.log('  Email:', emailArg);
      console.log('  Password:', passwordArg);
      console.log('  Platform User ID:', platformUserId);
      console.log('  User ID:', userId);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && error.message.includes('uq_platform_owner')) {
        throw new AppError(
          'CONFLICT',
          'Zaten aktif bir platform_owner var. Yeni bir owner oluşturamazsınız.',
        );
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
