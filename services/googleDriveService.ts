const API_KEY = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY;

export const extractFolderId = (url: string) => {
    if (!url) return null;
    // Standard folders URL
    const folderMatch = url.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];

    // ID parameter in URL (e.g. ?id=...)
    const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idParamMatch) return idParamMatch[1];

    // If it's just the ID itself
    if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return url;

    return null;
};

export const getFolderMetadata = async (folderId: string) => {
    if (!API_KEY || API_KEY === 'PLACEHOLDER_API_KEY') return null;
    try {
        const url = `https://www.googleapis.com/drive/v3/files/${folderId}?key=${API_KEY}&fields=id,name,mimeType,capabilities`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error('Metadata Check Error:', data.error);
            return null;
        }
        return data;
    } catch (e) {
        return null;
    }
};

export const fetchDriveFiles = async (folderId: string, typeFilter?: 'folder' | 'file') => {
    if (!API_KEY || API_KEY === 'PLACEHOLDER_API_KEY') {
        console.warn('Google Drive API Key missing');
        return [];
    }

    try {
        let allFiles: any[] = [];
        let pageToken: string | null = null;
        let hasMore = true;

        // Base query - Fetch EVERYTHING in the folder, filter later to be safe
        const query = `'${folderId}' in parents and trashed = false`;

        while (hasMore) {
            const url = new URL('https://www.googleapis.com/drive/v3/files');
            url.searchParams.append('q', query);
            url.searchParams.append('fields', 'nextPageToken, files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink,shortcutDetails)');
            url.searchParams.append('key', API_KEY);
            url.searchParams.append('supportsAllDrives', 'true');
            url.searchParams.append('includeItemsFromAllDrives', 'true');
            url.searchParams.append('pageSize', '1000');

            if (pageToken) {
                url.searchParams.append('pageToken', pageToken);
            }

            const response = await fetch(url.toString());
            const data = await response.json();

            if (data.error) {
                console.error('❌ Google Drive API Error Details:', JSON.stringify(data.error, null, 2));
                return allFiles; // Return what we have so far
            }

            const mappedFiles = (data.files || []).map((file: any) => ({
                id: file.id,
                name: file.name,
                type: (file.mimeType === 'application/vnd.google-apps.folder' ||
                    (file.mimeType === 'application/vnd.google-apps.shortcut' && file.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder'))
                    ? 'folder'
                    : mapMimeToType(file.mimeType),
                mimeType: file.mimeType,
                targetId: file.shortcutDetails?.targetId || null, // EXPOSE THE TARGET ID
                size: formatBytes(file.size),
                updatedAt: new Date(file.modifiedTime).toLocaleDateString('pt-BR'),
                thumbnailUrl: file.thumbnailLink,
                driveUrl: file.webViewLink,
                downloadUrl: `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`
            }));

            allFiles = [...allFiles, ...mappedFiles];

            if (data.nextPageToken) {
                pageToken = data.nextPageToken;
            } else {
                hasMore = false;
            }
        }

        return allFiles;
    } catch (error) {
        console.error('Error fetching drive files:', error);
        return [];
    }
};

export const searchAllDriveFiles = async (queryName: string, parentIds?: string[]) => {
    if (!API_KEY || API_KEY === 'PLACEHOLDER_API_KEY' || !queryName.trim()) {
        return [];
    }

    try {
        let query = `name contains '${queryName.replace(/'/g, "\\'")}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;

        if (parentIds && parentIds.length > 0) {
            // Limit to first 20 parents to avoid query length issues
            const limitedParents = parentIds.slice(0, 25);
            const parentQuery = limitedParents.map(id => `'${id}' in parents`).join(' or ');
            query += ` and (${parentQuery})`;
        }

        const url = new URL('https://www.googleapis.com/drive/v3/files');
        url.searchParams.append('q', query);
        url.searchParams.append('fields', 'files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink)');
        url.searchParams.append('key', API_KEY);
        url.searchParams.append('supportsAllDrives', 'true');
        url.searchParams.append('includeItemsFromAllDrives', 'true');
        url.searchParams.append('pageSize', '30');

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.error) {
            // If it's a 403, it's likely the "global search" restriction of API Keys
            if (data.error.code === 403) {
                console.warn('⚠️ Google Drive: Busca global de arquivos restrita pela chave de API. Tente buscar dentro de uma pasta específica.');
            } else {
                console.error('❌ Google Drive Search Error:', data.error);
            }
            return [];
        }

        return (data.files || []).map((file: any) => ({
            id: file.id,
            name: file.name,
            type: mapMimeToType(file.mimeType),
            mimeType: file.mimeType,
            size: formatBytes(file.size),
            updatedAt: new Date(file.modifiedTime).toLocaleDateString('pt-BR'),
            thumbnailUrl: file.thumbnailLink,
            driveUrl: file.webViewLink,
            downloadUrl: `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`
        }));
    } catch (error) {
        console.error('Error searching drive files:', error);
        return [];
    }
};

const mapMimeToType = (mimeType: string): string => {
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('video')) return 'video';
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return 'zip';
    if (mimeType.includes('json')) return 'json';
    return 'generic';
};

const formatBytes = (bytes: string) => {
    if (!bytes) return 'N/A';
    const b = parseInt(bytes);
    if (b === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
