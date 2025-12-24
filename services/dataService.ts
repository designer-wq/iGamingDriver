import { supabase } from './supabaseClient';
import { Provider, Game, AssetFolder } from '../types';

export const fetchProviders = async () => {
    // Fetch only providers and game IDs to count them.
    // Avoid fetching full game objects or folders initially.
    const { data, error } = await supabase
        .from('providers')
        .select(`
            *,
            games:games(id)
        `)
        .order('name');

    if (error) {
        console.error('Error fetching providers:', error);
        return [];
    }

    const providersData = data || [];
    return providersData.map((p: any) => ({
        ...p,
        gameCount: p.games?.length || 0,
        games: [] // Initialize empty, will load lazily
    })) as Provider[];
}

export const fetchGamesByProvider = async (providerId: string) => {
    const { data, error } = await supabase
        .from('games')
        .select(`
            *,
            folders:folders(*)
        `)
        .eq('provider_id', providerId);

    if (error) {
        console.error('Error fetching games:', error);
        return [];
    }

    return data.map((g: any) => ({
        id: g.id,
        name: g.name,
        providerId: g.provider_id,
        type: g.type,
        version: g.version,
        size: g.size,
        status: g.status,
        createdAt: g.created_at,
        icon: g.icon,
        colorFrom: g.color_from,
        colorTo: g.color_to,
        driveUrl: g.drive_url,
        folders: (g.folders || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            driveUrl: f.drive_url,
            fileCount: f.file_count || 0
        }))
    })) as Game[];
};

export const fetchRecentGames = async (limit: number = 5) => {
    const { data, error } = await supabase
        .from('games')
        .select(`
            *,
            folders:folders(*)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching recent games:', error);
        return [];
    }

    return data.map((g: any) => ({
        id: g.id,
        name: g.name,
        providerId: g.provider_id,
        type: g.type,
        version: g.version,
        size: g.size,
        status: g.status,
        createdAt: g.created_at,
        icon: g.icon,
        colorFrom: g.color_from,
        colorTo: g.color_to,
        driveUrl: g.drive_url,
        folders: (g.folders || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            driveUrl: f.drive_url,
            fileCount: f.file_count || 0
        }))
    })) as Game[];
};

export const fetchFoldersByGame = async (gameId: string) => {
    const { data, error } = await supabase
        .from('folders')
        .select('*')
        .eq('game_id', gameId);

    if (error) {
        console.error('Error fetching folders:', error);
        return [];
    }

    return data.map((f: any) => ({
        id: f.id,
        name: f.name,
        driveUrl: f.drive_url,
        fileCount: f.file_count || 0,
        gameId: f.game_id
    })) as any[];
};

export const fetchUserProfile = async (userId: string) => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching profile:', error);
        return null;
    }

    return data;
};

export const fetchAllProfiles = async () => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error fetching profiles:', error);
        return [];
    }

    return data;
};

export const deleteProfile = async (userId: string) => {
    const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

    if (error) {
        console.error('Error deleting profile:', error);
        return false;
    }
    return true;
};

export const updateProfile = async (userId: string, updates: any) => {
    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

    if (error) {
        console.error('Error updating profile:', error);
        return null;
    }
    return data;
};


export const saveSetting = async (key: string, value: string) => {
    console.log(`💾 Saving setting [${key}]:`, value);
    const { error } = await supabase
        .from('settings')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (error) {
        console.error('❌ Error saving setting:', error);
        return false;
    }
    console.log(`✅ Setting [${key}] saved.`);
    return true;
};

export const fetchSetting = async (key: string): Promise<string | null> => {
    const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

    if (error) {
        console.error(`❌ Error fetching setting [${key}]:`, error);
        return null;
    }
    if (data) {
        console.log(`📖 Fetched setting [${key}]:`, data.value);
    }
    return data?.value || null;
};

export const syncStructureFromDrive = async (rootFolderId: string, onProgress?: (percent: number, message: string) => void) => {
    const { fetchDriveFiles, getFolderMetadata } = await import('./googleDriveService');

    let reportLog = `--- Relatório de Sincronização ---\nInício: ${new Date().toLocaleTimeString()}\nID Raiz: ${rootFolderId}\n`;
    const log = (msg: string) => {
        console.log(msg);
        reportLog += `${msg}\n`;
    };

    onProgress?.(1, 'Validando link do Google Drive...');
    log('🔄 Validando metadados da pasta raiz...');

    // Validate Root Folder
    const rootMeta = await getFolderMetadata(rootFolderId);
    if (!rootMeta) {
        log('❌ ERRO: Pasta raiz não acessível.');
        throw new Error('FOLDER_NOT_ACCESSIBLE');
    }
    log(`✅ Pasta raiz validada: ${rootMeta.name}`);

    const stats = { providers: 0, games: 0, folders: 0, report: '' };

    // 1. Fetch Providers (Root Level Folders)
    onProgress?.(5, 'Buscando provedores na raiz...');
    const allRootItems = await fetchDriveFiles(rootFolderId);
    log(`📂 Itens na raiz: ${allRootItems.length}`);

    // Filter providers (folders)
    const providerFolders = allRootItems.filter(f => f.type === 'folder');
    log(`   -> Pastas de Provedores identificadas: ${providerFolders.length}`);
    allRootItems.forEach(i => {
        if (i.type !== 'folder') log(`   -> Ignorado (Arquivo): ${i.name}`);
    });

    if (providerFolders.length === 0) {
        onProgress?.(100, 'AVISO: Nenhuma pasta de provedor encontrada.');
        stats.report = reportLog;
        return stats;
    }

    // 0. Prepare cleanup tracking
    const foundProviderSlugs: string[] = [];
    const totalProviders = providerFolders.length;

    for (let i = 0; i < totalProviders; i++) {
        const pFolder = providerFolders[i];

        // Calculate progress base: 10% to 90% is for providers
        const baseProgressStart = 10;
        const totalProgressRange = 80;
        const providerChunkSize = totalProgressRange / (totalProviders || 1);

        // Start of this provider's progress
        const currentProviderBaseProgress = baseProgressStart + (i * providerChunkSize);

        onProgress?.(Math.round(currentProviderBaseProgress), `Processando provedor: ${pFolder.name} (${i + 1}/${totalProviders})`);
        log(`\n--- Processando Provedor: ${pFolder.name} (${pFolder.id}) ---`);

        const pSlug = pFolder.name.toLowerCase().replace(/ /g, '-');
        foundProviderSlugs.push(pSlug);

        // Upsert Provider
        const { data: pData, error: pError } = await supabase
            .from('providers')
            .upsert({
                name: pFolder.name,
                slug: pSlug
            }, { onConflict: 'slug' })
            .select()
            .single();

        if (pError) {
            log(`❌ Erro DB Provedor: ${pError.message}`);
            continue;
        }
        stats.providers++;

        // 2. Fetch Games for this Provider
        // USE TARGET ID IF SHORTCUT
        const pFolderId = pFolder.targetId || pFolder.id;
        if (pFolder.targetId) log(`   -> É um atalho! Alvo: ${pFolder.targetId}`);

        const allProviderItems = await fetchDriveFiles(pFolderId);
        log(`   🔎 Itens dentro do provedor: ${allProviderItems.length}`);

        // Filter for folders (Games)
        const gameFolders = allProviderItems.filter(f => f.type === 'folder');
        const providerFiles = allProviderItems.filter(f => f.type !== 'folder');

        log(`   -> Jogos (Pastas) identificados: ${gameFolders.length}`);

        if (providerFiles.length > 0) {
            log(`   ⚠️ ALERTA: ${providerFiles.length} arquivos soltos encontrados na raiz do provedor.`);
            log(`      O sistema espera que cada jogo seja uma PASTA.`);
            log(`      Exemplo: ${pFolder.name} > Nome do Jogo (Pasta) > Arquivos do Jogo`);
            providerFiles.slice(0, 5).forEach(f => log(`      Arquivo ignorado: ${f.name}`));
        }

        const foundGameNames: string[] = gameFolders.map(f => f.name);

        // Cleanup games that no longer exist for this provider
        if (foundGameNames.length > 0) {
            await supabase.from('games')
                .delete()
                .eq('provider_id', pData.id)
                .not('name', 'in', foundGameNames);
        } else {
            await supabase.from('games').delete().eq('provider_id', pData.id);
        }

        const totalGames = gameFolders.length;
        if (totalGames === 0) {
            log(`   ⚠️ ALERTA: 0 Jogos encontrados para ${pFolder.name}`);
            onProgress?.(Math.round(currentProviderBaseProgress + providerChunkSize), `Concluído provedor: ${pFolder.name}`);
        }

        for (let j = 0; j < totalGames; j++) {
            const gFolder = gameFolders[j];

            // Calculate game sub-progress within the provider's chunk
            const gameChunkSize = providerChunkSize / (totalGames || 1);
            const currentGameProgress = currentProviderBaseProgress + (j * gameChunkSize);

            onProgress?.(Math.round(currentGameProgress), `Sincronizando: ${pFolder.name} > ${gFolder.name}`);
            // Don't log every game to avoid huge logs, just count

            // Upsert Game
            const { data: gData, error: gError } = await supabase
                .from('games')
                .upsert({
                    provider_id: pData.id,
                    name: gFolder.name,
                    status: 'active',
                    type: 'Slot Video',
                    version: '1.0',
                    size: 'N/A',
                    icon: 'sports_esports',
                    color_from: 'from-blue-500',
                    color_to: 'to-indigo-600',
                    drive_url: gFolder.driveUrl
                }, { onConflict: 'provider_id, name' })
                .select()
                .single();

            if (gError) {
                log(`   ❌ Erro DB Jogo ${gFolder.name}: ${gError.message}`);
                continue;
            }
            stats.games++;

            // 3. Fetch Asset Folders for this Game
            const gFolderId = gFolder.targetId || gFolder.id;
            const allGameItems = await fetchDriveFiles(gFolderId);

            const assetFolders = allGameItems.filter(f => f.type === 'folder');
            const gameRootFiles = allGameItems.filter(f => f.type !== 'folder');

            // Log structure
            log(`   -> Jogo: ${gFolder.name} | Pastas: ${assetFolders.length} | Arquivos Soltos: ${gameRootFiles.length}`);

            if (assetFolders.length === 0 && gameRootFiles.length > 0) {
                log(`      ⚠️ ALERTA: Arquivos ignorados na raiz do jogo.`);
                // log(`      Mova para subpastas. Ex: ${gameRootFiles[0].name} -> Marketing/${gameRootFiles[0].name}`);
            }

            const foundFolderNames: string[] = assetFolders.map(f => f.name);

            // Cleanup asset folders
            if (foundFolderNames.length > 0) {
                await supabase.from('folders')
                    .delete()
                    .eq('game_id', gData.id)
                    .not('name', 'in', foundFolderNames);
            } else {
                await supabase.from('folders').delete().eq('game_id', gData.id);
            }

            for (const aFolder of assetFolders) {
                const aFolderId = aFolder.targetId || aFolder.id;
                const allAssetItems = await fetchDriveFiles(aFolderId);
                const folderFiles = allAssetItems.filter(f => f.type !== 'folder');
                const fileCount = folderFiles.length;

                const { error: aError } = await supabase
                    .from('folders')
                    .upsert({
                        game_id: gData.id,
                        name: aFolder.name,
                        drive_url: aFolder.driveUrl,
                        file_count: fileCount
                    }, { onConflict: 'game_id,name' });

                if (aError) {
                    log(`      ❌ Erro ao salvar pasta ${aFolder.name}: ${aError.message} (${aError.details || ''} - ${aError.hint || ''})`);
                } else {
                    stats.folders++;
                }
            }
        }
    }

    // 4. Final cleanup
    onProgress?.(95, 'Realizando limpeza final...');
    if (foundProviderSlugs.length > 0) {
        await supabase.from('providers')
            .delete()
            .not('slug', 'in', foundProviderSlugs);
    } else {
        await supabase.from('providers').delete().neq('slug', '____SYSTEM_RESERVED____');
    }

    onProgress?.(100, 'Sincronização finalizada!');
    log('✅ Sincronização finalizada!');
    stats.report = reportLog;
    return stats;
};

// Seed function for initial data (migration from mocks)
export const seedInitialData = async (mockProviders: any[]) => {
    for (const provider of mockProviders) {
        const { data: pData, error: pError } = await supabase
            .from('providers')
            .upsert({
                id: provider.id.length > 20 ? provider.id : undefined, // Check if it's already a UUID or if we should let Supabase gen
                name: provider.name,
                slug: provider.id
            }, { onConflict: 'slug' })
            .select()
            .single();

        if (pError) console.error('Error seeding provider:', pError);

        if (pData && provider.games) {
            for (const game of provider.games) {
                const { data: gData, error: gError } = await supabase
                    .from('games')
                    .upsert({
                        provider_id: pData.id,
                        name: game.name,
                        status: game.status,
                        type: game.type,
                        version: game.version,
                        size: game.size,
                        icon: game.icon,
                        color_from: game.colorFrom,
                        color_to: game.colorTo
                    })
                    .select()
                    .single();

                if (gError) console.error('Error seeding game:', gError);

                if (gData && game.folders) {
                    for (const folder of game.folders) {
                        await supabase
                            .from('folders')
                            .insert({
                                game_id: gData.id,
                                name: folder.name,
                                drive_url: folder.driveUrl
                            });
                    }
                }
            }
        }
    }
};
