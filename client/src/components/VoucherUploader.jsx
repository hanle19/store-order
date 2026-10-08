import { Upload, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import api from '../api';

// 通用凭证上传组件（付款凭证 / 到货凭证共用）
// 受控：value 为图片 URL 数组；onChange(urls: string[]) 回传
// 后端 /upload/images?target=voucher 会自动等比缩放并压缩到 ≤100KB
export default function VoucherUploader({ value = [], onChange, maxCount = 9, disabled = false }) {
  const urls = Array.isArray(value)
    ? value
    : (value ? String(value).split(',').filter(Boolean) : []);

  const fileList = urls.map((url, i) => ({
    uid: `v-${i}-${url}`,
    name: url.split('/').pop(),
    status: 'done',
    url,
  }));

  const customRequest = async ({ file, onSuccess, onError, onProgress }) => {
    const fd = new FormData();
    fd.append('images', file);
    try {
      const res = await api.post('/upload/images?target=voucher', fd, {
        onUploadProgress: (e) => onProgress({ percent: Math.round((e.loaded / e.total) * 100) }),
      });
      const newUrls = res.data?.urls || [];
      if (!newUrls.length) throw new Error('未返回图片');
      onChange([...urls, ...newUrls]);
      onSuccess(res.data);
    } catch (e) {
      message.error('凭证上传失败');
      onError(e);
    }
  };

  const handleRemove = (file) => {
    onChange(urls.filter((u) => u !== file.url));
  };

  const handlePreview = (file) => {
    if (file.url) window.open(file.url, '_blank');
  };

  return (
    <Upload
      listType="picture-card"
      fileList={fileList}
      customRequest={customRequest}
      onRemove={handleRemove}
      onPreview={handlePreview}
      disabled={disabled}
      accept="image/*"
    >
      {fileList.length >= maxCount || disabled ? null : (
        <div>
          <PlusOutlined />
          <div style={{ marginTop: 4 }}>上传凭证</div>
        </div>
      )}
    </Upload>
  );
}
