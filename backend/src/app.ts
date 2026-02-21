import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler';

// Routes
import accountRoutes from './routes/accountRoutes';
import journalRoutes from './routes/journalRoutes';
import reportRoutes from './routes/reportRoutes';
import integrationRoutes from './routes/integrationRoutes';

const app = express();

// Güvenlik middleware'leri
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// İstek loglama
if (config.nodeEnv !== 'test') {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 1000, // Pencere başına max istek
  message: { success: false, error: 'Çok fazla istek gönderildi. Lütfen bekleyin.' },
});
app.use('/api/', limiter);

// Swagger API dokümantasyonu
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TDHP Muhasebe Sistemi API',
      version: '0.1.0',
      description:
        'TDHP uyumlu muhasebe sistemi REST API. Fatura programları entegrasyon desteği ile.',
      contact: {
        name: 'TDHP-Muhasebe-Core',
      },
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: 'Geliştirme sunucusu',
      },
    ],
    tags: [
      { name: 'Hesaplar', description: 'TDHP Hesap Planı yönetimi' },
      { name: 'Yevmiye Fişleri', description: 'Yevmiye fişi işlemleri' },
      { name: 'Raporlar', description: 'Mizan, bilanço, gelir tablosu raporları' },
      { name: 'Entegrasyonlar', description: 'Fatura programı entegrasyonları' },
    ],
  },
  apis: ['./src/routes/*.ts'],
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'TDHP Muhasebe API Dokümantasyonu',
}));

// API endpoint'leri sağlık kontrolü
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      dbType: config.dbType,
    },
  });
});

// Route'lar
app.use('/api/accounts', accountRoutes);
app.use('/api/journal-entries', journalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/integrations', integrationRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint bulunamadı',
  });
});

// Global hata yakalama
app.use(errorHandler);

export default app;
