import { useLocation } from 'react-router-dom';

export function useCryptoAssetClass() {
  const { search } = useLocation();
  return new URLSearchParams(search).get('asset') === 'crypto';
}
