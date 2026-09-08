import axios from 'axios';

const messages: Record<string, [string, string]> = {
  quota_exhausted: ['剩余额度不足以安全启动下一次模型调用。仍可浏览报告和演示。', 'Not enough tokens to safely start the next model call. Reports and demos remain available.'],
  global_quota_exhausted: ['今日全站试用额度已用完，请明天再试。个人额度不会每日重置。', 'The shared daily trial limit has been reached. Try tomorrow; your personal quota does not reset daily.'],
  trial_disabled: ['真实试用暂未开放或此身份已停用，可以继续体验演示。', 'Live trials are disabled or this identity was suspended. You can still explore the demo.'],
  invite_invalid: ['邀请码无效、过期或已经领取。请检查邮箱或联系管理员。', 'Invite is invalid, expired or already claimed. Check your email or contact the administrator.'],
  credentials_invalid: ['邮箱或密码错误。', 'Email or password incorrect.'],
  trial_login_required: ['请先登录独立试用账户。', 'Sign in to your separate trial account first.'],
  already_enrolled: ['此邮箱已领取额度，不能重新发放。', 'This email has already enrolled. Its quota cannot be reissued.'],
  rate_limited: ['尝试过于频繁，请五分钟后重试。', 'Too many attempts. Try again in five minutes.'],
  run_in_progress: ['已有任务在后台运行，请等待完成。', 'A task is already running in the background. Please wait.'],
  model_unavailable: ['管理员尚未配置可用于试用的官方 DeepSeek 模型。', 'The administrator has not configured a supported official DeepSeek route.'],
  usage_unverified: ['模型用量无法核实，本次预留额度暂不退回，已停止后续调用。', 'Provider usage could not be verified. Reserved tokens remain charged and further calls were stopped.'],
  upstream_failed: ['模型或数据服务失败。无法确认用量的调用会保守保留预扣额度。', 'The model or data service failed. Calls with uncertain usage retain their prepaid token reservation.'],
  interrupted: ['任务中断。为避免重复计费，系统不会自动重跑。', 'The task was interrupted. It will not automatically rerun and incur duplicate charges.'],
  invalid_input: ['请检查输入格式。', 'Check the input format.'],
  password_length: ['密码须为 8–128 位。', 'Password must contain 8–128 characters.'],
};
export function trialError(error: unknown, l: (zh: string, en: string) => string) {
  const code = typeof error === 'string' ? error : axios.isAxiosError(error) ? error.response?.data?.error : '';
  return typeof code === 'string' && messages[code] ? l(...messages[code]) : l('暂时无法完成操作，请稍后重试。', 'Unable to complete this action. Please try again.');
}
