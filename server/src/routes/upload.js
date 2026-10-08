import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// upload.js 在 src/routes/ 目录下，需要往上跳两层才能到 server/
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ========== 图片自动裁剪 / 压缩 ==========
// 不同业务对尺寸要求不同，由前端通过 ?target=xxx 指定：
//   product   → 商品图：比例 1:1，分辨率 800×800（cover 裁剪填满）
//   knowledge → 知识图：比例 3:4，分辨率 600×800（cover 裁剪填满）
//   voucher   → 凭证图：不限比例，按最大框 1280×1280 等比缩放（contain 不裁剪，避免切掉单据内容）
// 统一转为 JPEG 并循环降质，保证单文件 ≤ 100KB；扩展名强制改为 .jpg。
const IMG_TARGETS = {
  product:   { w: 800,  h: 800,  fit: 'cover' },
  knowledge: { w: 600,  h: 800,  fit: 'cover' },
  voucher:   { w: 1280, h: 1280, fit: 'contain' },
};
const MAX_BYTES = 100 * 1024;

function targetFor(req) {
  const t = req.query.target;
  if (t === 'knowledge') return 'knowledge';
  if (t === 'product') return 'product';
  if (t === 'voucher') return 'voucher';
  return null; // 未指定：原样返回，不处理
}

// 将一张已落盘的原图，按目标尺寸裁剪/缩放 + 转 JPEG + 压到 ≤100KB，写到新的 .jpg 文件
async function processAndSave(filePath, target) {
  const t = IMG_TARGETS[target] || IMG_TARGETS.product;
  const fit = t.fit || 'cover';
  const { w, h } = t;
  // 先把原图读进内存，避免 sharp 持有文件句柄导致 Windows 下「同路径边读边写」冲突
  const inputBuf = fs.readFileSync(filePath);

  const encode = (quality) => sharp(inputBuf)
    .rotate()                                  // 按 EXIF 自动正方向（手机照片）
    .flatten({ background: '#ffffff' })        // 透明底填白，避免黑底
    .resize(w, h, { fit, position: 'centre' }) // 按目标 fit 缩放/裁剪到最大框
    .jpeg({ quality, mozjpeg: true, force: true });

  let quality = 82;
  let buf = await encode(quality).toBuffer();
  while (buf.length > MAX_BYTES && quality > 40) {
    quality -= 8;
    buf = await encode(quality).toBuffer();
  }
  // 兜底：极端情况下仍超限，缩小尺寸再压一次
  if (buf.length > MAX_BYTES) {
    buf = await sharp(inputBuf)
      .rotate().flatten({ background: '#ffffff' })
      .resize(Math.round(w * 0.8), Math.round(h * 0.8), { fit, position: 'centre' })
      .jpeg({ quality: 40, mozjpeg: true, force: true })
      .toBuffer();
  }

  // 写到新的 .jpg 文件名，再删除原图（避免覆盖正在被读取的同一文件）
  const outName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const outPath = path.join(path.dirname(filePath), outName);
  fs.writeFileSync(outPath, buf);
  try { fs.unlinkSync(filePath); } catch (_) { /* 原图句柄偶发未释放，忽略，留待下次清理 */ }
  return `/uploads/${outName}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片文件(jpg/png/gif/webp)'));
    }
  }
});

const router = Router();
router.use(authMiddleware);

// 多图上传 (最多9张)，支持 ?target=product|knowledge 自动裁剪压缩
router.post('/images', upload.array('images', 9), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请选择图片' });
    }
    const target = targetFor(req);
    const urls = [];
    for (const f of req.files) {
      urls.push(target ? await processAndSave(f.path, target) : `/uploads/${f.filename}`);
    }
    res.json({ urls, message: `上传成功 ${urls.length} 张图片` });
  } catch (e) {
    console.error('[upload/images] 处理失败:', e);
    res.status(400).json({ error: e.message || '图片处理失败' });
  }
});

// 单图上传，支持 ?target=product|knowledge 自动裁剪压缩
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片' });
    }
    const target = targetFor(req);
    const url = target ? await processAndSave(req.file.path, target) : `/uploads/${req.file.filename}`;
    res.json({ url, message: '上传成功' });
  } catch (e) {
    res.status(400).json({ error: e.message || '图片处理失败' });
  }
});

// ========== 视频上传 ==========
// 视频文件较大，单独一套 multer：200MB 上限，仅接受常见视频格式
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const name = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('仅支持视频文件(mp4 / webm / mov / mkv / avi)'));
    }
  }
});

// 知识讲解视频上传（仅管理员，知识管理为管理员功能）
router.post('/video', roleMiddleware('admin'), videoUpload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请选择视频文件' });
  }
  res.json({ url: `/uploads/${req.file.filename}`, message: '上传成功' });
});

// 统一错误处理（文件过大 / 格式不符等，返回 400 而非 500）
router.use((err, req, res, next) => {
  if (err) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? '文件过大（视频最大 200MB，图片最大 10MB）'
      : (err.message || '上传失败');
    return res.status(400).json({ error: msg });
  }
  next();
});

export default router;
