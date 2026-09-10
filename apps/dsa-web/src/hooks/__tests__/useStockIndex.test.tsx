import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStockIndex } from '../useStockIndex';
import { loadStockIndex } from '../../utils/stockIndexLoader';

vi.mock('../../utils/stockIndexLoader', () => ({
  loadStockIndex: vi.fn(),
}));

describe('useStockIndex', () => {
  beforeEach(() => {
    vi.mocked(loadStockIndex).mockReset();
    vi.mocked(loadStockIndex).mockResolvedValue({
      data: [],
      fallback: false,
      loaded: true,
    });
  });

  it('retries after a failed load without losing the mounted hook', async () => {
    vi.mocked(loadStockIndex).mockResolvedValueOnce({data: [], loaded: false, fallback: true});
    const { result } = renderHook(() => useStockIndex(true));
    await waitFor(() => expect(result.current.fallback).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.fallback).toBe(false));
    expect(loadStockIndex).toHaveBeenCalledTimes(2);
  });

  it('does not load the index until enabled', async () => {
    const { rerender } = renderHook(
      ({ enabled }) => useStockIndex(enabled),
      { initialProps: { enabled: false } },
    );

    expect(loadStockIndex).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(loadStockIndex).toHaveBeenCalledOnce());
  });
});
