import { Provider, Game, FileAsset } from './types';

export const getMimeType = (type: FileAsset['type']) => {
  switch (type) {
    case 'image': return 'image/png';
    case 'video': return 'video/mp4';
    case 'pdf': return 'application/pdf';
    case 'zip': return 'application/zip';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
};

// Dados agora são gerenciados pelo Supabase
export const mockProviders: Provider[] = [];