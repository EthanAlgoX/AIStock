import axios from 'axios';
import { getParsedApiError } from '../api/error';

const errors: Record<string, [string, string]> = {
  invite_invalid: ['邀请码无效、已使用或已过期。请确认受邀邮箱或联系管理员。', 'The invitation is invalid, used or expired. Check your invited email or contact the administrator.'],
  admin_required: ['此操作仅限平台管理员。', 'This operation is restricted to platform administrators.'],
  email_change_requires_verification: ['修改邮箱需要重新验证，请联系管理员。', 'Changing your email requires verification. Contact the administrator.'],
  credentials_invalid: ['邮箱或密码错误。', 'Email or password incorrect.'],
  setup_token_invalid: ['初始化凭证无效或已过期，请在部署主机上重新生成。', 'Setup token is invalid or expired. Generate a new token on the deployment host.'],
  registration_closed: ['此实例已有管理员，请刷新页面后登录。', 'This instance already has an administrator. Refresh and sign in.'],
  account_required: ['请先完成管理员账户设置。', 'Complete administrator account setup first.'],
  email_invalid: ['请输入有效的邮箱地址。', 'Enter a valid email address.'],
  password_mismatch: ['两次输入的密码不一致。', 'Passwords do not match.'],
  password_length: ['密码长度须为 8–128 位。', 'Password must contain 8–128 characters.'],
  rate_limited: ['尝试次数过多，请五分钟后重试。', 'Too many attempts. Try again in five minutes.'],
  https_required: ['服务器模式需要 HTTPS，请检查反向代理配置。', 'Server mode requires HTTPS. Check the reverse proxy configuration.'],
  session_unavailable: ['账户变更可能已保存，请刷新页面并重新登录。', 'Account changes may have been saved. Refresh and sign in again.'],
};

export function accountErrorMessage(error: unknown, l: (zh: string, en: string) => string): string {
  const code = axios.isAxiosError(error) ? error.response?.data?.error : '';
  if (typeof code === 'string' && errors[code]) return l(...errors[code]);
  const parsed = getParsedApiError(error);
  if (parsed.status === 429) return l(...errors.rate_limited);
  if (parsed.status === 401) return l(...errors.credentials_invalid);
  return l('暂时无法完成操作，请检查连接后重试。', 'Unable to complete this action. Check the connection and try again.');
}
