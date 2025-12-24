export interface FileAsset {
  id: string;
  name: string;
  type: 'image' | 'video' | 'pdf' | 'zip' | 'json' | 'generic';
  mimeType: string;
  size: string;
  updatedAt: string;
  thumbnailUrl?: string;
  driveUrl: string;
  downloadUrl: string;
}

export interface AssetFolder {
  id: string;
  name: string;
  fileCount: number;
  type: 'backgrounds' | 'characters' | 'logos' | 'elements' | 'screenshots' | 'generic';
  files: FileAsset[];
  driveUrl: string;
}

export interface Game {
  id: string;
  name: string;
  providerId: string;
  type: 'Slot Video' | 'Table Game' | 'Live Casino';
  version: string;
  size: string;
  status: 'active' | 'maintenance' | 'inactive';
  createdAt: string; // ISO Date string
  folders: AssetFolder[];
  icon: string; // Material symbol name
  colorFrom: string;
  colorTo: string;
  driveUrl?: string;
}

export interface Provider {
  id: string;
  name: string;
  gameCount: number;
  games: Game[];
}

export type UserRole = 'admin' | 'common' | 'guest';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
}

export type ViewState =
  | { type: 'home' }
  | { type: 'settings' }
  | { type: 'provider'; providerId: string }
  | { type: 'game'; providerId: string; gameId: string }
  | { type: 'folder'; providerId: string; gameId: string; folderId: string };