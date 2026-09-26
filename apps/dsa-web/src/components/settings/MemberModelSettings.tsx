import { useEffect, useState } from 'react';
import apiClient from '../../api';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import { Button, Input } from '../common';
import { SettingsSectionCard } from './SettingsSectionCard';
import { accountErrorMessage } from '../../utils/accountError';

type ModelSettings = { provider: string; model: string; configured: boolean; providers: { id: string; name: string }[] };
export function MemberModelSettings() {
  const { localize: l } = useUiLanguage();
  const [settings, setSettings] = useState<ModelSettings>();
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  function apply(data: ModelSettings) { setSettings(data); setProvider(data.provider || data.providers?.[0]?.id || ''); setModel(data.model || ''); setKey(''); }
  useEffect(() => {
    let active = true;
    apiClient.get<ModelSettings>('/api/v1/workspace/model-settings').then(({ data }) => { if (active) apply(data); })
      .catch(err => { if (active) setError(err); });
    return () => { active = false; };
  }, [revision]);
  return <SettingsSectionCard title={l('个人 LLM API', 'Personal LLM API')} description={l('保存后，所有生成式模型调用优先使用个人 API，不扣平台额度。调用失败不会切换到平台密钥。', 'Once saved, all generative model calls use your API without consuming platform allowance. Failed calls never fall back to platform keys.')}>
    <p className="mb-5 text-sm leading-6 text-secondary-text">{l('支持下列服务商的官方 API。填写控制台中的模型 ID，无需添加服务商前缀。密钥保存在服务器的私有工作区，仅用于你的调用，不会回显；部署管理员可访问服务器文件。', 'Use an official API from a provider below. Enter the model ID from its console without a provider prefix. Your key is stored in your private workspace on the server, used only for your calls and never returned to the browser; deployment administrators can access server files.')}</p>
    {settings && <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(undefined); setSaved(false);
      try { const { data } = await apiClient.put<ModelSettings>('/api/v1/workspace/model-settings', { provider, model, apiKey: key }); apply(data); setSaved(true); }
      catch (err) { setError(err); } finally { setBusy(false); }
    }}>
      <label className="block text-sm font-medium">{l('模型服务商', 'Model provider')}
        <select className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3" value={provider} required disabled={busy} onChange={event => { setProvider(event.target.value); setKey(''); setSaved(false); }}>
          {(settings.providers || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <Input label={l('模型 ID', 'Model ID')} value={model} onChange={event => { setModel(event.target.value); setSaved(false); }} required maxLength={160} disabled={busy} />
      <Input label="API Key" type="password" autoComplete="off" value={key} onChange={event => { setKey(event.target.value); setSaved(false); }} maxLength={4096} disabled={busy} required={!settings.configured || provider !== settings.provider} hint={l('同一服务商留空则保留已保存的密钥。更换服务商需要重新填写。', 'Leave blank to keep the saved key for the same provider. Enter a new key when changing providers.')} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" isLoading={busy}>{l('保存个人 API', 'Save personal API')}</Button>
        {settings.configured && <Button type="button" variant="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setError(undefined); setSaved(false);
          try { const { data } = await apiClient.delete<ModelSettings>('/api/v1/workspace/model-settings'); apply(data); }
          catch (err) { setError(err); } finally { setBusy(false); }
        }}>{l('移除个人 API', 'Remove personal API')}</Button>}
      </div>
      <p className="text-xs leading-5 text-secondary-text">{l('移除后，有平台额度的账户使用平台模型；无额度的账户需重新配置个人 API 才能调用模型。已发出的调用不受影响。', 'After removal, accounts with platform allowance use the platform model; accounts without allowance must configure an API before calling models. Calls already sent are unaffected.')}</p>
    </form>}
    {!settings && error == null && <p role="status">{l('加载中…', 'Loading…')}</p>}
    {error != null && <p role="alert" className="mt-3 text-sm text-danger">{accountErrorMessage(error, l)} {!settings && <button className="underline" onClick={() => { setError(undefined); setRevision(value => value + 1); }}>{l('重新加载模型设置', 'Reload model settings')}</button>}</p>}
    {saved && <p role="status" className="mt-3 text-sm">{l('个人 API 已保存。下一次模型调用将使用此配置。', 'Personal API saved. Your next model call will use this configuration.')}</p>}
  </SettingsSectionCard>;
}
