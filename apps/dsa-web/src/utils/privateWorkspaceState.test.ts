import { expect, it } from 'vitest';
import { clearPrivateWorkspaceStorage } from './privateWorkspaceState';

it('removes old private drafts but preserves language and unrelated storage', () => {
  localStorage.setItem('dsa.research-task-draft.v1', 'private');
  localStorage.setItem('dsa_chat_session_id', 'private-session');
  sessionStorage.setItem('investcrew.private', 'private');
  localStorage.setItem('dsa.uiLanguage', 'en');
  localStorage.setItem('unrelated-app', 'preserve');
  clearPrivateWorkspaceStorage();
  expect(localStorage.getItem('dsa.research-task-draft.v1')).toBeNull();
  expect(localStorage.getItem('dsa_chat_session_id')).toBeNull();
  expect(sessionStorage.getItem('investcrew.private')).toBeNull();
  expect(localStorage.getItem('dsa.uiLanguage')).toBe('en');
  expect(localStorage.getItem('unrelated-app')).toBe('preserve');
});
