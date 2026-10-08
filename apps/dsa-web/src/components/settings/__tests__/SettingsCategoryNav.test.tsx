import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../../contexts/UiLanguageContext';
import type { SystemConfigCategorySchema, SystemConfigItem } from '../../../types/systemConfig';
import { SettingsCategoryNav } from '../SettingsCategoryNav';

const categories: SystemConfigCategorySchema[] = [
  { category: 'ai_model', title: 'AI model', description: 'Manage model credentials', displayOrder: 1, fields: [] },
  { category: 'notification', title: 'Notification', description: 'Manage delivery credentials', displayOrder: 2, fields: [] },
];
const itemsByCategory: Record<string, SystemConfigItem[]> = {
  ai_model: [{ key: 'LITELLM_MODEL', value: 'draft-model', rawValueExists: true, isMasked: false }],
  notification: [],
};

beforeEach(() => {
  localStorage.setItem('dsa.uiLanguage', 'zh');
});

it('keeps all available categories selectable with compact labels and actual field counts', () => {
  const onSelect = vi.fn();
  render(<UiLanguageProvider><SettingsCategoryNav categories={categories} itemsByCategory={itemsByCategory} activeCategory="ai_model" onSelect={onSelect} /></UiLanguageProvider>);
  const nav = screen.getByRole('navigation');
  const model = within(nav).getByRole('button', { name: 'AI 模型 1' });
  expect(model).toHaveAttribute('aria-current', 'page');
  expect(within(nav).queryByText('Manage model credentials')).not.toBeInTheDocument();

  const notifications = within(nav).getByRole('button', { name: '通知渠道 0' });
  expect(notifications).toBeEnabled();
  expect(notifications).not.toHaveAttribute('aria-current');
  fireEvent.click(notifications);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('notification');
});

it('reflects the selected category and updated counts without replacing the caller draft', () => {
  const onSelect = vi.fn();
  const view = render(<UiLanguageProvider><SettingsCategoryNav categories={categories} itemsByCategory={itemsByCategory} activeCategory="ai_model" onSelect={onSelect} /></UiLanguageProvider>);
  view.rerender(<UiLanguageProvider><SettingsCategoryNav categories={categories} itemsByCategory={{ ...itemsByCategory, notification: [itemsByCategory.ai_model[0]] }} activeCategory="notification" onSelect={onSelect} /></UiLanguageProvider>);

  expect(screen.getByRole('button', { name: '通知渠道 1' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'AI 模型 1' })).not.toHaveAttribute('aria-current');
  expect(itemsByCategory.ai_model[0].value).toBe('draft-model');
  expect(onSelect).not.toHaveBeenCalled();
});
