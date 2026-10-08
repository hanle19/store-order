import 'express-async-errors'; // ±ØÐë×îÏÈ import£ºÎª Express 4 µÄËùÓÐ async Â·ÓÉ/ÖÐ¼ä¼þ²¹È«¾ÖÒì³£¶µµ×£¨×Ô¶¯×ª½»´íÎóÖÐ¼ä¼þ£¬±ÜÃâÎ´²¶»ñÒì³£µ¼ÖÂÇëÇó¹ÒÆð£©
import express from 'express';
import path from 'path';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import productRoutes from './routes/products.js';
import inventoryRoutes from './routes/inventory.js';
import orderRoutes from './routes/orders.js';
import aftersalesRoutes from './routes/aftersales.js';
import purchaseRoutes from './routes/purchases.js';
import targetRoutes from './routes/targets.js';
import dashboardRoutes from './routes/dashboard.js';
import analyticsRoutes from './routes/analytics.js';
import uploadRoutes from './routes/upload.js';
import productNameRoutes from './routes/productNames.js';
import financeRoutes from './routes/finance.js';
import excelRoutes from './routes/excel.js';
import knowledgeRoutes from './routes/knowledge.js';
import deliveryRoutes from './routes/delivery.js';
import operationLogRoutes from './routes/operation-logs.js';
import rollbackRoutes from './routes/rollback.js';
import deliveryPersonRoutes from './routes/delivery-persons.js';
import configRoutes from './routes/config.js';
import dailyRoutes from './routes/daily.js';
import customerRoutes from './routes/customers.js';
import wecomRoutes from './routes/wecom.js';
import systemRoutes from './routes/system.js';
import couponRoutes from './routes/coupons.js';
import bundleRoutes from './routes/bundles.js';
import storeRoutes from './routes/stores.js';
import { requestLogger, logError } from './middleware/requestLog.js';
import { startAutoBackup } from './utils/autoBackup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3333;

// ç¡®ä¿ä¸Šä¼ ç›®å½•å­˜åœ¨
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// CORS£ºÄ¬ÈÏÊÕ½ôÎª±¾µØ°×Ãûµ¥£¨²»ÔÙÔÊÐíÈÎÒâÀ´Ô´´øÆ¾Ö¤£©£»ÉèÖÃ CORS_ORIGINS »·¾³±äÁ¿¿ÉÏÞ¶¨°×Ãûµ¥£¨¶ººÅ·Ö¸ô£©
// CORS Ä¬ÈÏÊÕ½ôÎª±¾µØ°×Ãûµ¥£¨²»ÔÙÔÊÐíÈÎÒâÀ´Ô´´øÆ¾Ö¤£©¡£
// ²¿Êð NAS / ¹«Íø / ·ÉÊéÄÚÇ¶Ê±£¬ÓÃ CORS_ORIGINS »·¾³±äÁ¿ÏÔÊ½Ö¸¶¨ÔÊÐíÀ´Ô´£¨¶ººÅ·Ö¸ô£©¡£
// Í¬Ô´·ÃÎÊ£¨Ç°ºó¶ËÍ¬¶Ë¿Ú£©ÎÞÐè CORS£¬±¾²ßÂÔ²»Ó°Ïì±¾µØË«»÷ÔËÐÐ¡£
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3333', 'http://127.0.0.1:3333',
  'http://localhost:5173', 'http://127.0.0.1:5173',
];
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_CORS_ORIGINS;
app.use(cors({ origin: corsOrigins, credentials: true }));
// gzip Ñ¹Ëõ£º¾²Ì¬×ÊÔ´Óë API JSON °´ÐèÑ¹Ëõ£¨Ê×ÆÁ JS ´«ÊäÌå»ýÔ¼½µ 70%£©
app.use(compression());
app.use(express.json({ limit: '10mb' }));
// ÇëÇóÈÕÖ¾£ºÐ´ÔÚÂ·ÓÉÖ®Ç°£¬¼ÇÂ¼È«²¿ /api ÇëÇóµÄ·½·¨/Â·¾¶/×´Ì¬Âë/ºÄÊ±£¨¾²Ì¬×ÊÔ´×Ô¶¯Ìø¹ý£©
app.use(requestLogger);

// ä¸Šä¼ æ–‡ä»¶ç›®å½•ï¼šå›¾ç‰‡ç­‰é™æ€èµ„æºé€šè¿‡ /uploads å¯¹å¤–æä¾›
app.use('/uploads', express.static(uploadsDir));

// Ç°¶Ë¾²Ì¬ÎÄ¼þ£¨Ê¹ÓÃ¾ø¶ÔÂ·¾¶£¬±ÜÃâÒÀÀµÆô¶¯Ê±µÄ cwd£©
const publicDir = path.join(__dirname, '..', 'public');

initDb();

// °²È«ÌáÊ¾£ºauth.js ÔÚÈ±Ê§ JWT_SECRET Ê±»á×Ô¶¯Éú³É²¢³Ö¾Ã»¯µ½ server/.jwt_secret£¬
// ¸ÃÃÜÔ¿Ëæ»úÇÒÖØÆô²»±ä£¬token ²»¿É±»Î±Ôì£¬ÏµÍ³°²È«¡£½öµ±Á¬³Ö¾Ã»¯ÃÜÔ¿¶¼È±Ê§£¨¼«¶ËÇé¿ö£©
// ²ÅÌáÊ¾·çÏÕ¡£ÒÔÏÂ¸æ¾¯ÎÄ°¸Ðè±£Ö¤ UTF-8 Õý³£ÏÔÊ¾¡£
const jwtSecretFile = path.join(__dirname, '..', '.jwt_secret');
if (!process.env.JWT_SECRET && !fs.existsSync(jwtSecretFile)) {
  console.warn('[Security] Î´ÉèÖÃ»·¾³±äÁ¿ JWT_SECRET ÇÒÎ´·¢ÏÖ³Ö¾Ã»¯ÃÜÔ¿ÎÄ¼þ .jwt_secret£¬ÒÑ×Ô¶¯Éú³ÉËæ»úÃÜÔ¿²¢³Ö¾Ã»¯£»²¿Êðµ½¹«Íø/·ÉÅ£Ç°½¨ÒéÍ¨¹ý»·¾³±äÁ¿ÏÔÊ½ÉèÖÃ JWT_SECRET¡£');
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
// aftersalesRoutes ÐëÔÚ orderRoutes Ö®Ç°¹ÒÔØ£ºËü¶¨ÒåÁËµ¥¶Î×ÖÃæÂ·ÓÉ
// /returns Óë /aftersales£¨È«¾ÖÍË/»»ÓëÊÛºó¿´°å£©¡£Èô orderRoutes ÔÚºó£¬
// Æä GET /:id »áÌ°À·Æ¥Åä /api/orders/returns£¨°Ñ returns µ±×÷¶©µ¥ id£©£¬
// µ¼ÖÂÈ«¾ÖÁÐ±í½Ó¿Ú²»¿É´ï¡£aftersalesRoutes µÄÆäÓàÂ·ÓÉ¾ùÎª 2~3 ¶Î£¬²»»áÕÚ±Î orderRoutes¡£
app.use('/api/orders', aftersalesRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/product-names', productNameRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/excel', excelRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/operation-logs', operationLogRoutes);
app.use('/api/rollback', rollbackRoutes);
app.use('/api/delivery-persons', deliveryPersonRoutes);
app.use('/api/config', configRoutes);
app.use('/api/daily', dailyRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/wecom', wecomRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/bundles', bundleRoutes);
app.use('/api/stores', storeRoutes);

// å‰ç«¯é™æ€æ–‡ä»?
app.use(express.static(publicDir, {
  setHeaders: (res, filePath) => {
    // ´ø hash µÄ×ÊÔ´£¨/assets/* »ò *-<hash>.<ext>£©³¤Ð§»º´æ£»Î´¹þÏ£×ÊÔ´£¨index.html£©½ûÖ¹»º´æ
    const isHashedAsset = /[\\/]assets[\\/]/.test(filePath) || /-[A-Za-z0-9_-]{8,}\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot)$/.test(filePath);
    if (isHashedAsset) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

// SPA fallbackï¼šéž APIã€éž uploads è·¯å¾„è¿”å›ž index.html
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// å…¨å±€é”™è¯¯å¤„ç†ä¸­é—´ä»¶ï¼ˆå…œåº•æœªæ•èŽ·å¼‚å¸¸ï¼Œé¿å…è¿›ç¨‹å´©æºƒï¼›ä¸å‘å®¢æˆ·ç«¯æ³„éœ²å†…éƒ¨ç»†èŠ‚ï¼?
app.use((err, req, res, next) => {
  logError('server', err, req);
  console.error('[Server] æœªæ•èŽ·é”™è¯?:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'æœåŠ¡å™¨å†…éƒ¨é”™è¯¯ï¼Œè¯·ç¨åŽé‡è¯?' });
});

// é˜²æ­¢æœªå¤„ç†çš„ Promise æ‹’ç» / å¼‚å¸¸å¯¼è‡´è¿›ç¨‹é€€å‡?
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  console.error('[Server] æœªå¤„ç†çš„ Promise æ‹’ç»:', reason);
});
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err instanceof Error ? err : new Error(String(err)));
  console.error('[Server] æœªæ•èŽ·å¼‚å¸?:', err);
});

// ×Ô¶¯¶¨Ê±±¸·Ý£ºÃ¿ÈÕÒ»´Î + Æô¶¯²¹±¸£¬×î¶à±£Áô 30 ·Ý£¨AUTO_BACKUP=off ¿É¹Ø±Õ£©
startAutoBackup();

app.listen(PORT, '::', () => {
  console.log(`[Server] æ™šå®‰å®¶å±…é—¨åº—ç³»ç»Ÿå·²å¯åŠ?: http://0.0.0.0:${PORT}`);
});
