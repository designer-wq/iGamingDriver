import React, { useState, useMemo, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { fetchProviders, seedInitialData, fetchUserProfile, fetchAllProfiles, updateProfile, syncStructureFromDrive, saveSetting, fetchSetting, fetchGamesByProvider, fetchRecentGames } from './services/dataService';
import { fetchDriveFiles, extractFolderId, searchAllDriveFiles } from './services/googleDriveService';
import { FileAsset, ViewState, User, UserRole, Provider, Game, AssetFolder } from './types';
import { supabase } from './services/supabaseClient';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';



function App() {
    // --- Estado do Usuário Autenticado ---
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [users, setUsers] = useState<User[]>([]);

    // --- Estado do Formulário de Autenticação (Login/Registro) ---
    const [emailInput, setEmailInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [nameInput, setNameInput] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [authError, setAuthError] = useState('');


    // --- Estado Principal da Aplicação ---
    const [view, setView] = useState<ViewState>({ type: 'home' });
    const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
    const [providerSearchQuery, setProviderSearchQuery] = useState('');
    const [gameSearchQuery, setGameSearchQuery] = useState('');
    const [folderSearchQuery, setFolderSearchQuery] = useState('');
    const [globalSearchFiles, setGlobalSearchFiles] = useState<FileAsset[]>([]);
    const [isGlobalSearchFilesLoading, setIsGlobalSearchFilesLoading] = useState(false);

    // --- Estado das Configurações ---
    const [driveLink, setDriveLink] = useState('https://drive.google.com/drive/u/0/folders/root');
    const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'users'>('general');
    const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'guest' as UserRole });
    const [editingUser, setEditingUser] = useState<User | null>(null);

    // --- Estado de Dados do Supabase ---
    const [providers, setProviders] = useState<Provider[]>([]);
    const [dbLoading, setDbLoading] = useState(false);
    const [isAppReady, setIsAppReady] = useState(false);
    const [currentFolderFiles, setCurrentFolderFiles] = useState<FileAsset[]>([]);
    const [currentGameFiles, setCurrentGameFiles] = useState<FileAsset[]>([]);
    const [isFilesLoading, setIsFilesLoading] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncMessage, setSyncMessage] = useState('');
    const [isDownloading, setIsDownloading] = useState(false);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [recentGames, setRecentGames] = useState<Game[]>([]);

    // --- Estado de Favoritos ---
    const [favorites, setFavorites] = useState<Set<string>>(new Set());

    // --- Carregamento Inicial de Dados ---
    useEffect(() => {
        const loadData = async () => {
            try {
                // Sequência inicial de boot

                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    const profile = await fetchUserProfile(session.user.id);
                    if (profile) setCurrentUser(profile);
                }

                const data = await fetchProviders();
                setProviders(data);

                // Load recent games (top 8)
                const recents = await fetchRecentGames(8);
                setRecentGames(recents);

                // Load persisted Drive Link
                const savedLink = await fetchSetting('drive_root_link');
                if (savedLink) {
                    setDriveLink(savedLink);

                    // MOVED TO BACKGROUND: Don't await this here to avoid blocking the initial render
                    const folderId = extractFolderId(savedLink);
                    if (folderId) {
                        console.log('⚡ Agendando sincronização em segundo plano pós-refresh...');
                        // No await here
                        syncStructureFromDrive(folderId).then(async () => {
                            const freshData = await fetchProviders();
                            setProviders(freshData);
                            console.log('⚡ Sincronização de fundo concluída.');
                        }).catch(err => console.error('Erro na sincronização de fundo:', err));
                    }
                }

                if (session?.user) {
                    const allUsers = await fetchAllProfiles();
                    setUsers(allUsers);
                }
            } catch (error) {
                console.error("Boot error:", error);
            } finally {
                // Priority: Show the app as soon as basic providers are loaded
                setIsAppReady(true);
            }
        };
        loadData();

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
                const profile = await fetchUserProfile(session.user.id);
                setCurrentUser(profile);
                const allUsers = await fetchAllProfiles();
                setUsers(allUsers);
            } else if (event === 'SIGNED_OUT') {
                setCurrentUser(null);
                setUsers([]);
                setView({ type: 'home' });
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);


    // --- Lógica de Sincronização Automática em Segundo Plano ---
    useEffect(() => {
        if (!isAppReady || !driveLink || driveLink.includes('root')) return;

        const silentSync = async () => {
            const folderId = extractFolderId(driveLink);
            if (!folderId || dbLoading) return;

            console.log('🔄 Sincronização automática em segundo plano...');
            try {
                await syncStructureFromDrive(folderId);
                const data = await fetchProviders();
                setProviders(data);
            } catch (error) {
                console.error('Erro na sincronização automática:', error);
            }
        };

        const interval = setInterval(silentSync, 1000 * 30); // Sincroniza a cada 30 segundos
        return () => clearInterval(interval);
    }, [isAppReady, driveLink, dbLoading]);

    // --- Auxiliares de Permissão do Usuário ---
    const isAdmin = currentUser?.role === 'admin';
    const canDownload = currentUser?.role === 'admin' || currentUser?.role === 'common';
    const canUpload = currentUser?.role === 'admin';

    // --- Cálculos do Dashboard ---
    const allGames = useMemo(() => providers.flatMap(p => p.games || []), [providers]);
    const totalGamesCount = useMemo(() => providers.reduce((acc, p) => acc + (p.gameCount || 0), 0), [providers]);
    const totalProvidersCount = providers.length;

    // Remove old memoized recentGames, we will use state now
    // const recentGames = useMemo(() => { ... }, [allGames]);

    const currentProvider = useMemo(() => {
        if (view.type === 'home' || view.type === 'settings') return null;
        return providers.find(p => p.id === view.providerId);
    }, [view, providers]);

    const currentGame = useMemo(() => {
        if (view.type === 'home' || view.type === 'provider' || view.type === 'settings') return null;
        return currentProvider?.games.find(g => g.id === view.gameId);
    }, [view, currentProvider]);

    const currentFolder = useMemo(() => {
        if (view.type !== 'folder') return null;
        return currentGame?.folders?.find(f => f.id === view.folderId);
    }, [view, currentGame]);

    const filteredProvidersForSidebar = useMemo(() => {
        if (!sidebarSearchQuery.trim()) return providers;
        return providers.filter(p =>
            p.name.toLowerCase().includes(sidebarSearchQuery.toLowerCase()) ||
            p.games?.some(g => g.name.toLowerCase().includes(sidebarSearchQuery.toLowerCase()))
        );
    }, [providers, sidebarSearchQuery]);

    const filteredGamesForProvider = useMemo(() => {
        if (!currentProvider?.games) return [];
        if (!providerSearchQuery.trim()) return currentProvider.games;
        return currentProvider.games.filter(g =>
            g.name.toLowerCase().includes(providerSearchQuery.toLowerCase())
        );
    }, [currentProvider, providerSearchQuery]);

    const filteredFoldersForGame = useMemo(() => {
        if (!currentGame?.folders) return [];
        if (!gameSearchQuery.trim()) return currentGame.folders;
        return currentGame.folders.filter(f =>
            f.name.toLowerCase().includes(gameSearchQuery.toLowerCase())
        );
    }, [currentGame, gameSearchQuery]);

    const globalSearchResults = useMemo(() => {
        if (!sidebarSearchQuery.trim()) return null;
        const query = sidebarSearchQuery.toLowerCase();

        const matchedProviders = providers.filter(p => p.name.toLowerCase().includes(query));
        const matchedGames = allGames.filter(g => g.name.toLowerCase().includes(query));
        const matchedFolders = allGames.flatMap(g => g.folders || []).filter(f => f.name.toLowerCase().includes(query));

        return { matchedProviders, matchedGames, matchedFolders };
    }, [providers, allGames, sidebarSearchQuery]);

    // --- Efeito de Pesquisa Global de Arquivos (API do Drive) ---
    useEffect(() => {
        if (view.type !== 'home' || !sidebarSearchQuery.trim()) {
            setGlobalSearchFiles([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            setIsGlobalSearchFilesLoading(true);
            try {
                // Para contornar restrições de pesquisa global (403), pesquisamos dentro de pastas conhecidas
                // 1. Obter IDs de pastas que corresponderam ao nome da pesquisa
                const matchedFolderIds = (globalSearchResults?.matchedFolders || [])
                    .map(f => extractFolderId(f.driveUrl))
                    .filter(Boolean) as string[];

                // 2. Obter IDs de outras pastas na hierarquia para expandir a pesquisa
                const otherFolderIds = allGames
                    .flatMap(g => g.folders || [])
                    .map(f => extractFolderId(f.driveUrl))
                    .filter(id => id && !matchedFolderIds.includes(id as string))
                    .slice(0, 20) as string[]; // Limite para evitar URL muito longa

                const folderContext = [...matchedFolderIds, ...otherFolderIds];

                // Se não tivermos contexto de pasta, tentar pelo menos com a raiz
                if (folderContext.length === 0) {
                    const rootId = extractFolderId(driveLink);
                    if (rootId) folderContext.push(rootId);
                }

                const files = await searchAllDriveFiles(sidebarSearchQuery, folderContext);
                setGlobalSearchFiles(files);
            } catch (error) {
                console.error('Error global searching files:', error);
            } finally {
                setIsGlobalSearchFilesLoading(false);
            }
        }, 800);

        return () => clearTimeout(delayDebounceFn);
    }, [sidebarSearchQuery, view.type]);

    // --- Reseta as pesquisas ao mudar de visualização ---
    useEffect(() => {
        setFolderSearchQuery('');
        setGameSearchQuery('');
        setProviderSearchQuery('');
    }, [view]);

    // --- Carregamento Lazy ("preguiçoso") de Jogos ---
    // Carrega jogos ao entrar no provedor, jogo ou pasta, se ainda não tiverem sido carregados
    useEffect(() => {
        if (['provider', 'game', 'folder'].includes(view.type) && 'providerId' in view) {
            const pid = (view as any).providerId;
            const providerToLoad = providers.find(p => p.id === pid);

            // Se o provedor existe e não tem jogos carregados (array vazio), busca do banco
            if (providerToLoad && (!providerToLoad.games || providerToLoad.games.length === 0)) {
                setDbLoading(true);
                fetchGamesByProvider(pid)
                    .then(games => {
                        setProviders(prev => prev.map(p =>
                            p.id === pid ? { ...p, games } : p
                        ));
                    })
                    .catch(err => console.error("Erro ao carregar jogos lazy:", err))
                    .finally(() => setDbLoading(false));
            }
        }
    }, [view, providers]);

    // --- Carrega arquivos quando a pasta ou jogo muda ---
    useEffect(() => {
        const loadFiles = async () => {
            // Caso 1: Visualização de Pasta
            if (view.type === 'folder' && currentFolder?.driveUrl) {
                const folderId = extractFolderId(currentFolder.driveUrl);
                if (folderId) {
                    setIsFilesLoading(true);
                    try {
                        const files = await fetchDriveFiles(folderId, 'file');
                        setCurrentFolderFiles(files);
                    } catch (error) {
                        console.error('Error fetching folder files:', error);
                    } finally {
                        setIsFilesLoading(false);
                    }
                }
            } else {
                setCurrentFolderFiles([]);
            }

            // Caso 2: Visualização de Jogo (busca arquivos na raiz do jogo)
            if (view.type === 'game' && currentGame?.driveUrl) {
                const gameFolderId = extractFolderId(currentGame.driveUrl);
                if (gameFolderId) {
                    try {
                        const files = await fetchDriveFiles(gameFolderId, 'file');
                        setCurrentGameFiles(files);
                    } catch (error) {
                        console.error('Error fetching game root files:', error);
                    }
                }
            } else {
                setCurrentGameFiles([]);
            }
        };

        loadFiles();
    }, [view, currentFolder, currentGame, providers]);

    const filteredFolderFiles = useMemo(() => {
        const sourceFiles = currentFolderFiles.length > 0 ? currentFolderFiles : (currentFolder?.files || []);

        // Atualiza a contagem interna da pasta se acabamos de buscar do Drive
        if (currentFolder && currentFolderFiles.length > 0) {
            currentFolder.fileCount = currentFolderFiles.length;
        }

        if (!folderSearchQuery.trim()) return sourceFiles;
        return sourceFiles.filter(file =>
            file.name.toLowerCase().includes(folderSearchQuery.toLowerCase())
        );
    }, [currentFolder, currentFolderFiles, folderSearchQuery]);

    const handleNavigate = (newView: ViewState) => {
        setView(newView);
    };

    const handleSettingsClick = () => {
        if (isAdmin) {
            setView({ type: 'settings' });
        }
    };

    const handleSystemLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError('');
        setDbLoading(true);

        if (isRegistering) {
            const { error } = await supabase.auth.signUp({
                email: emailInput,
                password: passwordInput,
                options: {
                    data: {
                        name: nameInput
                    }
                }
            });

            if (error) {
                setAuthError(error.message);
                setDbLoading(false);
            } else {
                alert('Cadastro realizado com sucesso! Verifique seu e-mail para confirmar (se ativado) ou acesse o sistema.');
                setIsRegistering(false);
                setDbLoading(false);
            }
        } else {
            const { error } = await supabase.auth.signInWithPassword({
                email: emailInput,
                password: passwordInput,
            });

            if (error) {
                setAuthError(error.message === 'Invalid login credentials'
                    ? 'Credenciais inválidas. Verifique seu e-mail e senha.'
                    : error.message);
                setDbLoading(false);
            } else {
                setView({ type: 'home' });
                setDbLoading(false);
            }
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setPasswordInput('');
        setEmailInput('');
    };

    const handleDownloadFolder = async (folder: { id: string, name: string }) => {
        if (isDownloading) return;
        setIsDownloading(true);
        console.log(`⬇️ Iniciando download da pasta: ${folder.name}`);

        try {
            const items = await fetchDriveFiles(folder.id);
            const files = items.filter((f: any) => f.type !== 'folder');

            if (files.length === 0) {
                alert('Esta pasta está vazia ou contém apenas subpastas.');
                setIsDownloading(false);
                return;
            }

            const zip = new JSZip();
            let processed = 0;

            await Promise.all(files.map(async (file: any) => {
                if (!file.downloadUrl) return;
                try {
                    const response = await fetch(file.downloadUrl);
                    if (!response.ok) throw new Error('Falha no download');
                    const blob = await response.blob();
                    zip.file(file.name, blob);
                    processed++;
                } catch (err) {
                    console.error(`Erro ao baixar ${file.name}:`, err);
                }
            }));

            if (processed === 0) {
                alert('Não foi possível baixar os arquivos (Possível bloqueio de CORS).');
                return;
            }

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, `${folder.name}.zip`);
            console.log('✅ Download ZIP concluído!');

        } catch (error) {
            console.error('Erro no processo de download:', error);
            alert('Erro ao gerar o ZIP.');
        } finally {
            setIsDownloading(false);
            setActiveMenuId(null);
        }
    };

    const handleSyncDrive = async () => {
        const folderId = extractFolderId(driveLink);
        if (!folderId) {
            alert('Por favor, insira um link válido de pasta do Google Drive.');
            return;
        }

        try {
            setDbLoading(true);

            // Salva o link no banco primeiro
            await saveSetting('drive_root_link', driveLink);

            setSyncProgress(0);
            setSyncMessage('Iniciando sincronização...');

            const stats = await syncStructureFromDrive(folderId, (progress, message) => {
                setSyncProgress(progress);
                setSyncMessage(message);
            });
            const data = await fetchProviders();
            setProviders(data);

            if (stats && typeof stats === 'object') {
                const report = (stats as any).report;

                if (stats.providers === 0) {
                    alert('Nenhuma pasta encontrada. Verifique se a pasta do Drive é "Pública" (Qualquer pessoa com o link).\n\n' + report);
                } else if (stats.games === 0) {
                    // Alerta com informações de diagnóstico se NENHUM jogo for encontrado, apesar de encontrar provedores
                    if (confirm('Sincronização concluída, mas NENHUM JOGO foi encontrado. Deseja ver o relatório técnico para diagnóstico?')) {
                        alert(report);
                    }
                }

                // Se o provedor/jogo atual não estiver mais na nova estrutura, volte para o início
                const freshProviders = data;
                if (view.type === 'provider' && !freshProviders.some(p => p.id === view.providerId)) {
                    setView({ type: 'home' });
                } else if (view.type === 'game') {
                    const provider = freshProviders.find(p => p.id === view.providerId);
                    if (!provider || !provider.games?.some(g => g.id === view.gameId)) {
                        setView({ type: 'home' });
                    }
                }

                alert(`Sincronização concluída com sucesso!\n\nProvedores: ${stats.providers}\nJogos: ${stats.games}\nPastas de ativos: ${stats.folders}\n\nO sistema foi atualizado com a nova estrutura.`);
            } else {
                alert('Estrutura sincronizada e link salvo com sucesso!');
            }
        } catch (error) {
            console.error('Sync error:', error);
            alert('Erro ao sincronizar estrutura do Drive.');
        } finally {
            setDbLoading(false);
        }
    };

    const handleCreateUser = (e: React.FormEvent) => {
        e.preventDefault();
        alert('Para criar novos usuários com acesso ao sistema, utilize o painel do Supabase -> Authentication ou peça para o usuário se cadastrar na tela inicial.');
    };

    const handleEditUser = (user: User) => {
        setEditingUser(user);
    };

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUser) return;

        setDbLoading(true);
        const updated = await updateProfile(editingUser.id, {
            name: editingUser.name,
            role: editingUser.role
        });

        if (updated) {
            const allUsers = await fetchAllProfiles();
            setUsers(allUsers);
            setEditingUser(null);
            alert('Usuário atualizado com sucesso!');
        } else {
            alert('Erro ao atualizar usuário.');
        }
        setDbLoading(false);
    };

    const handleDeleteUser = async (id: string) => {
        if (id === currentUser?.id) {
            alert("Você não pode excluir a si mesmo.");
            return;
        }
        if (confirm('Tem certeza que deseja excluir o perfil deste usuário? (Isso não remove o acesso do Supabase Auth, apenas o perfil interno)')) {
            const { deleteProfile, fetchAllProfiles } = await import('./services/dataService');
            const success = await deleteProfile(id);
            if (success) {
                const allUsers = await fetchAllProfiles();
                setUsers(allUsers);
            }
        }
    };

    const toggleFavorite = (fileId: string) => {
        setFavorites(prev => {
            const newFavs = new Set(prev);
            if (newFavs.has(fileId)) {
                newFavs.delete(fileId);
            } else {
                newFavs.add(fileId);
            }
            return newFavs;
        });
    };



    // --- Splash / Loading Screen ---
    if (!isAppReady) {
        return (
            <div className="min-h-screen bg-[#111827] flex flex-col items-center justify-center font-display">
                <div className="w-16 h-16 rounded-2xl bg-primary text-white shadow-lg flex items-center justify-center mb-6 animate-bounce">
                    <span className="material-symbols-outlined text-[32px]">cloud_circle</span>
                </div>
                <h1 className="text-xl font-bold text-white mb-2">iGaming Driver</h1>
                <div className="flex gap-1.5 items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.2s]"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.4s]"></div>
                </div>
            </div>
        );
    }

    // --- Login Screen Render ---
    if (!currentUser) {
        return (
            <div className="flex min-h-screen w-full bg-[#111827] items-center justify-center relative overflow-hidden font-display">
                {/* Background Effects */}
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] pointer-events-none translate-x-1/4 -translate-y-1/4"></div>
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none -translate-x-1/4 translate-y-1/4"></div>

                <div className="w-full max-w-md p-8 relative z-10 animate-slide-up">
                    <div className="flex flex-col items-center mb-10">
                        <div className="w-16 h-16 rounded-2xl bg-primary text-white shadow-[0_0_30px_rgba(59,130,246,0.5)] flex items-center justify-center mb-6">
                            <span className="material-symbols-outlined text-[32px]">cloud_circle</span>
                        </div>
                        <h1 className="text-3xl font-bold text-white tracking-tight text-center">iGaming Driver</h1>
                        <p className="text-gray-400 mt-2 text-center">Faça login para acessar o painel</p>
                    </div>

                    <form onSubmit={handleSystemLogin} className="space-y-5 bg-[#1F2937] p-8 rounded-2xl border border-gray-700/50 shadow-2xl">
                        {isRegistering && (
                            <div>
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 ml-1">Nome Completo</label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 material-symbols-outlined text-[20px]">person</span>
                                    <input
                                        type="text"
                                        value={nameInput}
                                        onChange={(e) => setNameInput(e.target.value)}
                                        className="w-full bg-[#111827] border border-gray-700 rounded-xl pl-12 pr-4 py-3.5 text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all placeholder-gray-600"
                                        placeholder="Digite seu nome..."
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 ml-1">E-mail</label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 material-symbols-outlined text-[20px]">mail</span>
                                <input
                                    type="email"
                                    value={emailInput}
                                    onChange={(e) => setEmailInput(e.target.value)}
                                    className="w-full bg-[#111827] border border-gray-700 rounded-xl pl-12 pr-4 py-3.5 text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all placeholder-gray-600"
                                    placeholder="Digite seu e-mail..."
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 ml-1">Senha</label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 material-symbols-outlined text-[20px]">lock</span>
                                <input
                                    type="password"
                                    value={passwordInput}
                                    onChange={(e) => setPasswordInput(e.target.value)}
                                    className="w-full bg-[#111827] border border-gray-700 rounded-xl pl-12 pr-4 py-3.5 text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all placeholder-gray-600"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                        </div>

                        {authError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                                <span className="material-symbols-outlined text-[18px]">error</span>
                                {authError}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={dbLoading}
                            className="w-full py-3.5 bg-primary hover:bg-primary-dark text-white rounded-xl font-semibold transition-all shadow-lg shadow-blue-500/20 mt-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {dbLoading && <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>}
                            {isRegistering ? 'Criar Conta' : 'Acessar Sistema'}
                        </button>

                        <div className="text-center pt-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsRegistering(!isRegistering);
                                    setAuthError('');
                                }}
                                className="text-sm text-gray-400 hover:text-primary transition-colors"
                            >
                                {isRegistering ? 'Já tem uma conta? Faça login' : 'Não tem conta? Solicite acesso'}
                            </button>
                        </div>
                    </form>

                    <p className="text-center text-gray-600 text-xs mt-8">
                        &copy; 2024 iGaming Driver. Todos os direitos reservados.
                    </p>
                </div>
            </div>
        );
    }

    // --- Main App Render (Authenticated) ---
    return (
        <div className="flex h-screen w-full bg-content-bg text-white font-display overflow-hidden relative">
            <Sidebar
                providers={filteredProvidersForSidebar}
                currentView={view}
                onNavigate={handleNavigate}
                currentUser={currentUser}
                onLogout={handleLogout}
                onSettingsClick={handleSettingsClick}
                searchQuery={sidebarSearchQuery}
                onSearchChange={setSidebarSearchQuery}
            />

            <main className="flex-1 flex flex-col relative bg-content-bg overflow-hidden transition-all">
                {/* Header - changes based on view */}
                <header className="h-16 border-b border-gray-700/50 flex items-center justify-between px-8 bg-[#1E293B] shrink-0 z-10">
                    <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <button onClick={() => setView({ type: 'home' })} className="hover:text-white transition-colors flex items-center">
                            <span className="material-symbols-outlined text-[18px] mr-1">dashboard</span>
                            Dashboard
                        </button>
                        {view.type === 'settings' && (
                            <>
                                <span>/</span>
                                <span className="text-white font-medium">Configurações</span>
                            </>
                        )}
                        {currentProvider && (
                            <>
                                <span>/</span>
                                <button
                                    onClick={() => setView({ type: 'provider', providerId: currentProvider.id })}
                                    className={`hover:text-white transition-colors ${view.type === 'provider' ? 'text-white font-medium' : ''}`}
                                >
                                    {currentProvider.name}
                                </button>
                            </>
                        )}
                        {currentGame && (
                            <>
                                <span>/</span>
                                <button
                                    onClick={() => setView({ type: 'game', providerId: currentProvider!.id, gameId: currentGame.id })}
                                    className={`hover:text-white transition-colors ${view.type === 'game' ? 'text-white font-medium' : ''}`}
                                >
                                    {currentGame.name}
                                </button>
                            </>
                        )}
                        {currentFolder && (
                            <>
                                <span>/</span>
                                <span className="text-white font-medium">{currentFolder.name}</span>
                            </>
                        )}
                    </div>

                    <div className="flex gap-4 items-center">
                        <button className="text-gray-400 hover:text-white transition-colors relative p-1 rounded hover:bg-gray-800">
                            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border border-[#1E293B]"></span>
                            <span className="material-symbols-outlined">notifications</span>
                        </button>
                        <div className="flex items-center gap-3 pl-4 border-l border-gray-700">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-medium text-white">{currentUser.name}</p>
                                <p className="text-xs text-gray-500 uppercase">{currentUser.role === 'admin' ? 'Administrador' : currentUser.role === 'common' ? 'Usuário' : 'Convidado'}</p>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-300">
                                <span className="material-symbols-outlined text-[20px]">person</span>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Views */}
                <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                    {/* Decorative Backgrounds */}
                    {(view.type === 'home' || view.type === 'settings') && (
                        <>
                            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none translate-x-1/4 -translate-y-1/4"></div>
                            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none -translate-x-1/4 translate-y-1/4"></div>
                        </>
                    )}

                    {/* Dashboard View (Home) or Global Search */}
                    {view.type === 'home' && (
                        <div className="p-8 z-10 relative animate-fade-in max-w-7xl mx-auto w-full">
                            {!sidebarSearchQuery.trim() ? (
                                <>
                                    <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Dashboard</h1>
                                    <p className="text-gray-400 mb-8">Visão geral dos ativos e atualizações recentes.</p>

                                    {dbLoading && (
                                        <div className="flex flex-col gap-2 p-4 bg-[#1e293b] border border-blue-500/30 rounded-xl text-blue-400 mb-8 shadow-lg relative overflow-hidden">
                                            {/* Background Progress Bar (Subtle) */}
                                            <div
                                                className="absolute left-0 top-0 bottom-0 bg-blue-500/5 transition-all duration-300 ease-out z-0"
                                                style={{ width: `${syncProgress}%` }}
                                            ></div>

                                            <div className="flex items-center gap-3 z-10 relative">
                                                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                                                    <span className="material-symbols-outlined animate-spin text-[24px]">sync</span>
                                                </div>
                                                <div className="flex flex-col flex-1 min-w-0">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="text-sm font-bold uppercase tracking-wider text-blue-300">Sincronização em andamento</span>
                                                        <span className="text-sm font-mono font-bold">{syncProgress}%</span>
                                                    </div>

                                                    {/* Main Progress Bar */}
                                                    <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden mb-1.5 border border-white/5">
                                                        <div
                                                            className="bg-gradient-to-r from-blue-600 to-blue-400 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                                                            style={{ width: `${syncProgress}%` }}
                                                        ></div>
                                                    </div>

                                                    <span className="text-xs text-blue-300/70 truncate font-medium">
                                                        {syncMessage || 'Mapeando estrutura do Google Drive...'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                                        <div className="bg-[#1F2937] p-6 rounded-2xl border border-gray-700/50 shadow-lg relative overflow-hidden group hover:border-primary/50 transition-colors">
                                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                                <span className="material-symbols-outlined text-[80px] text-blue-500">casino</span>
                                            </div>
                                            <div className="relative z-10">
                                                <p className="text-gray-400 text-sm font-medium uppercase tracking-wider mb-2">Total de Jogos</p>
                                                <h2 className="text-4xl font-bold text-white">{totalGamesCount}</h2>
                                                <p className="text-green-400 text-xs mt-2 flex items-center gap-1">
                                                    <span className="material-symbols-outlined text-[14px]">trending_up</span>
                                                    Ativos na biblioteca
                                                </p>
                                            </div>
                                        </div>

                                        <div className="bg-[#1F2937] p-6 rounded-2xl border border-gray-700/50 shadow-lg relative overflow-hidden group hover:border-purple-500/50 transition-colors">
                                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                                <span className="material-symbols-outlined text-[80px] text-purple-500">dns</span>
                                            </div>
                                            <div className="relative z-10">
                                                <p className="text-gray-400 text-sm font-medium uppercase tracking-wider mb-2">Provedores</p>
                                                <h2 className="text-4xl font-bold text-white">{totalProvidersCount}</h2>
                                                <p className="text-purple-400 text-xs mt-2 flex items-center gap-1">
                                                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                                    Integrados
                                                </p>
                                            </div>
                                        </div>

                                        <div className="bg-[#1F2937] p-6 rounded-2xl border border-gray-700/50 shadow-lg relative overflow-hidden group hover:border-green-500/50 transition-colors">
                                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                                <span className="material-symbols-outlined text-[80px] text-green-500">folder_shared</span>
                                            </div>
                                            <div className="relative z-10">
                                                <p className="text-gray-400 text-sm font-medium uppercase tracking-wider mb-2">Drive Conectado</p>
                                                <h2 className="text-xl font-bold text-white truncate max-w-[200px]">{driveLink.includes('drive.google') ? 'Ativo' : 'Pendente'}</h2>

                                            </div>
                                        </div>
                                    </div>

                                    {/* Recent Games Section */}
                                    <div className="flex items-center gap-2 mb-6">
                                        <span className="material-symbols-outlined text-primary text-[24px]">new_releases</span>
                                        <h2 className="text-xl font-bold text-white">Novos Jogos Adicionados</h2>
                                    </div>

                                    {recentGames.length > 0 ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                            {recentGames.map(game => {
                                                const provider = providers.find(p => p.id === game.providerId);
                                                const isRecentlyAdded = game.createdAt && (new Date().getTime() - new Date(game.createdAt).getTime()) < (7 * 24 * 60 * 60 * 1000);

                                                return (
                                                    <div key={game.id} className="group relative bg-card-bg rounded-2xl p-5 border border-gray-700/50 hover:border-gray-600 shadow-md hover:shadow-xl transition-all duration-300">
                                                        <div className="flex items-start justify-between mb-4">
                                                            <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${game.colorFrom} ${game.colorTo} flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform duration-300`}>
                                                                <span className="material-symbols-outlined text-[28px]">{game.icon}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {isRecentlyAdded && (
                                                                    <span className="flex items-center px-2 py-0.5 bg-gradient-to-r from-blue-600 to-primary text-white text-[9px] font-black uppercase tracking-tighter rounded border border-white/10 shadow-sm animate-fade-in line-height-none">
                                                                        Novo
                                                                    </span>
                                                                )}
                                                                <span className="px-2 py-1 rounded bg-black/20 border border-white/5 text-[10px] text-gray-400 uppercase font-bold tracking-wide">
                                                                    {provider?.name}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="mb-4">
                                                            <h3 className="text-lg font-bold text-white mb-1 group-hover:text-primary transition-colors truncate">{game.name}</h3>
                                                            <p className="text-xs text-gray-400 flex items-center gap-1.5">
                                                                <span className="material-symbols-outlined text-[14px] text-gray-500">calendar_today</span>
                                                                Adicionado em: {game.createdAt ? new Date(game.createdAt).toLocaleDateString('pt-BR') : 'Recente'}
                                                            </p>
                                                        </div>

                                                        <button
                                                            onClick={() => setView({ type: 'game', providerId: game.providerId, gameId: game.id })}
                                                            className="w-full py-2.5 rounded-lg bg-[#111827] hover:bg-primary text-gray-300 hover:text-white text-sm font-medium transition-all flex items-center justify-center gap-2 group-hover:shadow-lg"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">folder_open</span>
                                                            Acessar Assets
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-20 bg-[#1F2937]/50 rounded-2xl border border-gray-700/30 border-dashed">
                                            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4 text-gray-500">
                                                <span className="material-symbols-outlined text-[32px]">folder_off</span>
                                            </div>
                                            <h3 className="text-lg font-medium text-white mb-2">Sistema Pronto</h3>
                                            <p className="text-gray-400 text-center max-w-md text-sm">
                                                O sistema está limpo e pronto para a integração. Configure o link do Google Drive para que os jogos comecem a aparecer aqui.
                                            </p>
                                            {isAdmin && (
                                                <button
                                                    onClick={() => setView({ type: 'settings' })}
                                                    className="mt-6 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors text-sm flex items-center gap-2"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">settings</span>
                                                    Configurar Agora
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="animate-fade-in">
                                    <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Resultados da Busca</h1>
                                    <p className="text-gray-400 mb-8">Mostrando resultados para "{sidebarSearchQuery}"</p>

                                    {globalSearchResults && (
                                        <div className="space-y-12">
                                            {/* Matches: Provedores */}
                                            {globalSearchResults.matchedProviders.length > 0 && (
                                                <section>
                                                    <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                        <span className="material-symbols-outlined text-[18px]">dns</span>
                                                        Provedores ({globalSearchResults.matchedProviders.length})
                                                    </h2>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                        {globalSearchResults.matchedProviders.map(p => (
                                                            <div
                                                                key={p.id}
                                                                onClick={() => { setView({ type: 'provider', providerId: p.id }); setSidebarSearchQuery(''); }}
                                                                className="bg-card-bg border border-gray-700 p-4 rounded-xl flex items-center gap-4 hover:border-primary transition-all cursor-pointer group"
                                                            >
                                                                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                                                    <span className="material-symbols-outlined">folder</span>
                                                                </div>
                                                                <div>
                                                                    <h3 className="font-bold text-white">{p.name}</h3>
                                                                    <p className="text-xs text-gray-500 lowercase">Abrir Provedor</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}

                                            {/* Matches: Jogos */}
                                            {globalSearchResults.matchedGames.length > 0 && (
                                                <section>
                                                    <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                        <span className="material-symbols-outlined text-[18px]">sports_esports</span>
                                                        Jogos ({globalSearchResults.matchedGames.length})
                                                    </h2>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                        {globalSearchResults.matchedGames.map(g => (
                                                            <div
                                                                key={g.id}
                                                                onClick={() => { setView({ type: 'game', providerId: g.providerId, gameId: g.id }); setSidebarSearchQuery(''); }}
                                                                className="bg-card-bg border border-gray-700 p-4 rounded-xl flex items-center gap-4 hover:border-primary transition-all cursor-pointer group"
                                                            >
                                                                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${g.colorFrom} ${g.colorTo} flex items-center justify-center text-white group-hover:scale-110 transition-transform`}>
                                                                    <span className="material-symbols-outlined">{g.icon}</span>
                                                                </div>
                                                                <div>
                                                                    <h3 className="font-bold text-white tracking-tight">{g.name}</h3>
                                                                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">{g.type}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}

                                            {/* Matches: Pastas */}
                                            {globalSearchResults.matchedFolders.length > 0 && (
                                                <section>
                                                    <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                        <span className="material-symbols-outlined text-[18px]">folder_special</span>
                                                        Pastas de Assets ({globalSearchResults.matchedFolders.length})
                                                    </h2>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                        {globalSearchResults.matchedFolders.map(f => {
                                                            const game = allGames.find(g => g.id === f.gameId);
                                                            return (
                                                                <div
                                                                    key={f.id}
                                                                    onClick={() => { setView({ type: 'folder', providerId: game?.providerId || '', gameId: f.gameId, folderId: f.id }); setSidebarSearchQuery(''); }}
                                                                    className="bg-card-bg border border-gray-700 p-4 rounded-xl flex items-center gap-4 hover:border-primary transition-all cursor-pointer group"
                                                                >
                                                                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                                                                        <span className="material-symbols-outlined">folder</span>
                                                                    </div>
                                                                    <div className="overflow-hidden">
                                                                        <h3 className="font-bold text-white truncate">{f.name}</h3>
                                                                        <p className="text-xs text-gray-500 truncate">{game?.name}</p>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </section>
                                            )}

                                            {/* Matches: Arquivos (Drive API) */}
                                            {(isGlobalSearchFilesLoading || globalSearchFiles.length > 0) && (
                                                <section>
                                                    <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                        <span className="material-symbols-outlined text-[18px]">description</span>
                                                        Arquivos no Google Drive {isGlobalSearchFilesLoading && <span className="material-symbols-outlined animate-spin text-[16px] text-primary">sync</span>}
                                                    </h2>

                                                    {globalSearchFiles.length > 0 ? (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                                            {globalSearchFiles.map(file => (
                                                                <div
                                                                    key={file.id}
                                                                    onClick={() => window.open(file.downloadUrl, '_blank')}
                                                                    className="bg-card-bg border border-gray-700 p-4 rounded-xl flex items-center gap-4 hover:border-primary transition-all cursor-pointer group"
                                                                >
                                                                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 group-hover:scale-110 transition-transform relative overflow-hidden">
                                                                        {file.thumbnailUrl ? (
                                                                            <img src={file.thumbnailUrl} className="w-full h-full object-cover opacity-50 group-hover:opacity-100 transition-opacity" />
                                                                        ) : (
                                                                            <span className="material-symbols-outlined">description</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="overflow-hidden">
                                                                        <h3 className="font-bold text-white text-sm truncate">{file.name}</h3>
                                                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">{file.type} • {file.size}</p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : !isGlobalSearchFilesLoading && (
                                                        <p className="text-sm text-gray-500 italic px-4">Nenhum arquivo correspondente encontrado no Drive.</p>
                                                    )}
                                                </section>
                                            )}

                                            {globalSearchResults.matchedProviders.length === 0 &&
                                                globalSearchResults.matchedGames.length === 0 &&
                                                globalSearchResults.matchedFolders.length === 0 &&
                                                globalSearchFiles.length === 0 &&
                                                !isGlobalSearchFilesLoading && (
                                                    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                                                        <span className="material-symbols-outlined text-[64px] mb-4 opacity-50">search_off</span>
                                                        <p className="text-xl font-medium">Nenhum resultado encontrado para "{sidebarSearchQuery}"</p>
                                                        <p className="text-sm mt-2 font-normal">Tente buscar por outro termo ou verifique se o Drive está sincronizado.</p>
                                                    </div>
                                                )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Settings View */}
                    {view.type === 'settings' && isAdmin && (
                        <div className="max-w-5xl mx-auto p-8 animate-fade-in z-10 relative">
                            <h1 className="text-3xl font-bold text-white mb-2">Configurações do Sistema</h1>
                            <p className="text-gray-400 mb-8">Gerencie a conexão com o Google Drive e permissões de usuários.</p>

                            {/* Settings Tabs */}
                            <div className="flex items-center gap-1 mb-6 border-b border-gray-700/50">
                                <button
                                    onClick={() => setActiveSettingsTab('general')}
                                    className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeSettingsTab === 'general' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-white'}`}
                                >
                                    Geral
                                </button>
                                <button
                                    onClick={() => setActiveSettingsTab('users')}
                                    className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeSettingsTab === 'users' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-white'}`}
                                >
                                    Usuários
                                </button>
                            </div>

                            <div className="bg-[#1F2937] border border-gray-700/50 rounded-2xl p-8 shadow-xl">

                                {/* Tab: General */}
                                {activeSettingsTab === 'general' && (
                                    <div className="animate-fade-in">
                                        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-700/50">
                                            <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center text-green-500">
                                                <span className="material-symbols-outlined text-[28px]">add_to_drive</span>
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-semibold text-white">Integração Google Drive</h2>
                                                <p className="text-sm text-gray-400">Configure a pasta raiz onde os arquivos estão armazenados.</p>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-300 mb-2">Link da Pasta Raiz do Drive</label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={driveLink}
                                                        onChange={(e) => setDriveLink(e.target.value)}
                                                        className="flex-1 bg-[#111827] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                                                        placeholder="https://drive.google.com/drive/..."
                                                    />
                                                    <button
                                                        onClick={handleSyncDrive}
                                                        disabled={dbLoading}
                                                        className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                                                    >
                                                        {dbLoading && <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>}
                                                        Sincronizar Estrutura
                                                    </button>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-2">Os usuários terão acesso de leitura aos arquivos contidos neste diretório e subpastas.</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Tab: Users */}
                                {activeSettingsTab === 'users' && (
                                    <div className="animate-fade-in">
                                        <div className="flex items-center gap-4 mb-8 pb-6 border-b border-gray-700/50">
                                            <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center text-purple-500">
                                                <span className="material-symbols-outlined text-[28px]">group</span>
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-semibold text-white">Gestão de Usuários</h2>
                                                <p className="text-sm text-gray-400">Adicione ou remova acesso ao sistema.</p>
                                            </div>
                                        </div>

                                        {/* Create User Form */}
                                        <div className="bg-[#111827] rounded-xl p-6 border border-gray-700/50 mb-8">
                                            <h3 className="text-white font-medium mb-4 flex items-center gap-2">
                                                <span className="material-symbols-outlined text-primary">person_add</span>
                                                Novo Usuário
                                            </h3>
                                            <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                                <input
                                                    placeholder="Nome Completo"
                                                    className="bg-[#1F2937] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-primary outline-none"
                                                    value={newUser.name}
                                                    onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                                                    required
                                                />
                                                <input
                                                    placeholder="Email de Acesso"
                                                    className="bg-[#1F2937] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-primary outline-none"
                                                    value={newUser.email}
                                                    onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                                                    required
                                                />
                                                <input
                                                    placeholder="Senha"
                                                    type="password"
                                                    className="bg-[#1F2937] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-primary outline-none"
                                                    value={newUser.password}
                                                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                                    required
                                                />
                                                <div className="flex gap-2">
                                                    <select
                                                        className="bg-[#1F2937] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-primary outline-none flex-1"
                                                        value={newUser.role}
                                                        onChange={e => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                                                    >
                                                        <option value="common">Comum (Ver/Baixar)</option>
                                                        <option value="guest">Convidado (Ver)</option>
                                                        <option value="admin">Admin (Total)</option>
                                                    </select>
                                                    <button type="submit" className="bg-primary hover:bg-blue-600 text-white rounded-lg px-4 transition-colors">
                                                        <span className="material-symbols-outlined">add</span>
                                                    </button>
                                                </div>
                                            </form>
                                        </div>

                                        {/* Users List */}
                                        <div className="overflow-hidden rounded-xl border border-gray-700/50">
                                            <table className="w-full text-left text-sm">
                                                <thead className="bg-[#111827] text-gray-400 font-medium border-b border-gray-700/50">
                                                    <tr>
                                                        <th className="px-6 py-3">Nome</th>
                                                        <th className="px-6 py-3">Email/Login</th>
                                                        <th className="px-6 py-3">Função</th>
                                                        <th className="px-6 py-3 text-right">Ações</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-700/50 bg-[#1F2937]">
                                                    {users.map(user => (
                                                        <tr key={user.id} className="hover:bg-gray-700/30 transition-colors">
                                                            <td className="px-6 py-3 text-white">{user.name}</td>
                                                            <td className="px-6 py-3 text-gray-400">{user.email}</td>
                                                            <td className="px-6 py-3">
                                                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${user.role === 'admin' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                                                                    user.role === 'guest' ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20' :
                                                                        'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                                    }`}>
                                                                    {user.role === 'admin' ? 'Administrador' : user.role === 'guest' ? 'Convidado' : 'Comum'}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-3 text-right">
                                                                <div className="flex justify-end gap-2">
                                                                    <button
                                                                        onClick={() => handleEditUser(user)}
                                                                        className="text-gray-500 hover:text-primary transition-colors"
                                                                        title="Editar Usuário"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[18px]">edit</span>
                                                                    </button>
                                                                    {user.id !== currentUser.id && (
                                                                        <button
                                                                            onClick={() => handleDeleteUser(user.id)}
                                                                            className="text-gray-500 hover:text-red-400 transition-colors"
                                                                            title="Remover Usuário"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {/* Edit User Modal */}
                                {editingUser && (
                                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                                        <div className="bg-[#1F2937] border border-gray-700 w-full max-w-md rounded-2xl shadow-2xl animate-slide-up overflow-hidden">
                                            <div className="p-6 border-b border-gray-700/50 flex items-center justify-between">
                                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-primary">edit</span>
                                                    Editar Usuário
                                                </h3>
                                                <button
                                                    onClick={() => setEditingUser(null)}
                                                    className="text-gray-400 hover:text-white transition-colors"
                                                >
                                                    <span className="material-symbols-outlined">close</span>
                                                </button>
                                            </div>
                                            <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
                                                <div>
                                                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Nome Completo</label>
                                                    <input
                                                        type="text"
                                                        value={editingUser.name}
                                                        onChange={e => setEditingUser({ ...editingUser, name: e.target.value })}
                                                        className="w-full bg-[#111827] border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:ring-1 focus:ring-primary outline-none"
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Email (Apenas Visualização)</label>
                                                    <input
                                                        type="text"
                                                        value={editingUser.email}
                                                        disabled
                                                        className="w-full bg-[#111827]/50 border border-gray-700 rounded-xl px-4 py-2.5 text-gray-500 cursor-not-allowed outline-none"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Função / Nível de Acesso</label>
                                                    <select
                                                        className="w-full bg-[#111827] border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:ring-1 focus:ring-primary outline-none"
                                                        value={editingUser.role}
                                                        onChange={e => setEditingUser({ ...editingUser, role: e.target.value as UserRole })}
                                                    >
                                                        <option value="common">Comum (Ver/Baixar)</option>
                                                        <option value="guest">Convidado (Ver)</option>
                                                        <option value="admin">Administrador (Total)</option>
                                                    </select>
                                                </div>
                                                <div className="pt-4 flex gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingUser(null)}
                                                        className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors"
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        disabled={dbLoading}
                                                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                                                    >
                                                        {dbLoading && <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>}
                                                        Salvar Alterações
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Provider View (Games Grid) */}
                    {view.type === 'provider' && currentProvider && (
                        <div className="p-8 animate-fade-in">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                                <div>
                                    <h1 className="text-3xl font-bold text-white tracking-tight">Jogos da {currentProvider.name}</h1>
                                    <p className="text-gray-400 mt-1">Gerencie os arquivos e ativos da biblioteca de jogos.</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center h-10 bg-gray-800/50 border border-gray-700 rounded-xl px-3 w-64 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
                                        <span className="material-symbols-outlined text-gray-500 text-[20px]">search</span>
                                        <input
                                            className="bg-transparent border-none text-sm text-white placeholder-gray-500 focus:ring-0 w-full h-full p-0 pl-2 outline-none"
                                            placeholder="Buscar jogo..."
                                            type="text"
                                            value={providerSearchQuery}
                                            onChange={(e) => setProviderSearchQuery(e.target.value)}
                                        />
                                    </div>

                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 pb-12">
                                {filteredGamesForProvider.length > 0 ? filteredGamesForProvider.map(game => {
                                    const isRecentlyAdded = game.createdAt && (new Date().getTime() - new Date(game.createdAt).getTime()) < (7 * 24 * 60 * 60 * 1000);

                                    return (
                                        <div key={game.id} className="group relative bg-card-bg rounded-2xl p-5 border border-gray-700/50 hover:border-gray-600 shadow-md hover:shadow-xl transition-all duration-300">
                                            <div className="flex items-start justify-between mb-4">
                                                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${game.colorFrom} ${game.colorTo} flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform duration-300`}>
                                                    <span className="material-symbols-outlined text-[28px]">{game.icon}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {isRecentlyAdded && (
                                                        <span className="flex items-center px-2 py-0.5 bg-gradient-to-r from-blue-600 to-primary text-white text-[9px] font-black uppercase tracking-tighter rounded border border-white/10 shadow-sm animate-fade-in line-height-none">
                                                            Novo
                                                        </span>
                                                    )}
                                                    <button className="text-gray-500 hover:text-white p-1 rounded-full hover:bg-white/5 transition-colors">
                                                        <span className="material-symbols-outlined">more_horiz</span>
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="mb-5">
                                                <h3 className="text-lg font-bold text-white mb-1 group-hover:text-primary transition-colors truncate">{game.name}</h3>
                                                <div className="flex flex-col gap-1">
                                                    <p className="text-xs text-gray-400 flex items-center gap-1.5">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${game.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                        {game.type}
                                                    </p>
                                                    <p className="text-[10px] text-gray-500 flex items-center gap-1">
                                                        <span className="material-symbols-outlined text-[12px]">calendar_today</span>
                                                        {game.createdAt ? new Date(game.createdAt).toLocaleDateString('pt-BR') : 'Recent'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between pt-4 border-t border-gray-700/50">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Versão</span>
                                                    <span className="text-xs text-gray-300 font-mono">{game.version}</span>
                                                </div>
                                                <div className="flex flex-col gap-0.5 items-end">
                                                    <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Tamanho</span>
                                                    <span className="text-xs text-gray-300 font-mono">{game.size}</span>
                                                </div>
                                            </div>
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center backdrop-blur-[2px]">
                                                <button
                                                    onClick={() => setView({ type: 'game', providerId: currentProvider.id, gameId: game.id })}
                                                    className="bg-white text-gray-900 px-4 py-2 rounded-full font-semibold text-sm shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300 flex items-center gap-2 hover:bg-gray-100"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">folder_open</span>
                                                    Abrir
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-500">
                                        <span className="material-symbols-outlined text-[48px] mb-4 opacity-50">
                                            {providerSearchQuery ? 'search_off' : 'folder_off'}
                                        </span>
                                        <p>{providerSearchQuery ? `Nenhum jogo corresponde a "${providerSearchQuery}"` : 'Nenhum jogo encontrado para este provedor.'}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Game View (Folder Grid) */}
                    {view.type === 'game' && currentGame && (
                        <div className="p-8 animate-fade-in">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                                        <span className={`w-3 h-3 rounded-full bg-gradient-to-br ${currentGame.colorFrom} ${currentGame.colorTo}`}></span>
                                        {currentGame.name}
                                    </h1>
                                    <p className="text-gray-400 mt-1 text-sm">Pastas do Google Drive</p>
                                </div>
                                <div className="hidden md:flex items-center h-9 bg-gray-800/50 border border-gray-700 rounded-lg px-3 w-64 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
                                    <span className="material-symbols-outlined text-gray-500 text-[18px]">search</span>
                                    <input
                                        className="bg-transparent border-none text-sm text-white placeholder-gray-500 focus:ring-0 w-full h-full p-0 pl-2 outline-none"
                                        placeholder="Buscar pasta..."
                                        type="text"
                                        value={gameSearchQuery}
                                        onChange={(e) => setGameSearchQuery(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-8">
                                {filteredFoldersForGame.length > 0 ? filteredFoldersForGame.map(folder => (
                                    <div
                                        key={folder.id}
                                        onClick={() => setView({ type: 'folder', providerId: view.providerId, gameId: view.gameId, folderId: folder.id })}
                                        className="group bg-card-bg border border-gray-700/50 hover:border-primary/50 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] rounded-xl p-5 flex flex-col gap-4 cursor-pointer transition-all duration-300 relative overflow-hidden"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                        <div className="flex items-start justify-between">
                                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform duration-300 relative">
                                                <span className="material-symbols-outlined">folder</span>
                                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow-sm">
                                                    <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-2.5 h-2.5" />
                                                </div>
                                            </div>
                                            <div className="relative">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActiveMenuId(activeMenuId === folder.id ? null : folder.id);
                                                    }}
                                                    className="text-gray-600 hover:text-gray-400 p-1 rounded-full hover:bg-gray-700/50 transition-colors"
                                                >
                                                    <span className="material-symbols-outlined text-[20px]">more_vert</span>
                                                </button>
                                                {activeMenuId === folder.id && (
                                                    <div className="absolute right-0 top-full mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDownloadFolder(folder);
                                                            }}
                                                            className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 hover:text-white flex items-center gap-2"
                                                            disabled={isDownloading}
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">download</span>
                                                            {isDownloading ? 'Baixando...' : 'Baixar todos arquivos'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); window.open(folder.driveUrl, '_blank') }}
                                                            className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 hover:text-white flex items-center gap-2 border-t border-gray-700"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                                            Abrir no Drive
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <h3 className="text-white font-medium text-sm mb-1 group-hover:text-blue-200 transition-colors uppercase">{folder.name}</h3>
                                            <p className="text-gray-500 text-[11px] font-medium flex items-center gap-1">
                                                <span className="text-primary font-bold">{folder.fileCount || 0}</span>
                                                {folder.fileCount === 1 ? 'Arquivo' : 'Arquivos'}
                                            </p>
                                        </div>
                                    </div>
                                )) : (
                                    <div className="col-span-full flex flex-col items-center justify-center py-24 text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/30">
                                        <span className="material-symbols-outlined text-[56px] mb-4 text-gray-600">
                                            {gameSearchQuery ? 'search_off' : 'cloud_off'}
                                        </span>
                                        <h3 className="text-lg font-medium text-gray-400 mb-2">
                                            {gameSearchQuery ? 'Nenhum resultado' : 'Nenhuma pasta encontrada'}
                                        </h3>
                                        <p className="text-sm text-gray-500 max-w-sm text-center mb-6">
                                            {gameSearchQuery
                                                ? `Não encontramos nenhuma pasta que corresponda a "${gameSearchQuery}".`
                                                : 'Configure o link do Google Drive no painel de Configurações para sincronizar os arquivos.'}
                                        </p>
                                        {!gameSearchQuery && isAdmin && (
                                            <button onClick={() => setView({ type: 'settings' })} className="px-5 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors">
                                                Ir para Configurações
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>


                        </div>
                    )}

                    {/* Folder Modal / Overlay */}
                    {view.type === 'folder' && currentFolder && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-12 animate-fade-in">
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setView({ type: 'game', providerId: view.providerId, gameId: view.gameId })}></div>
                            <div className="relative w-full h-full max-w-7xl bg-[#1E293B] rounded-2xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden animate-slide-up ring-1 ring-white/10">
                                <div className="flex items-center justify-between px-6 py-5 bg-[#111827] border-b border-gray-700 shrink-0">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 text-blue-400">
                                            <span className="material-symbols-outlined">folder_open</span>
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-semibold text-white leading-tight flex items-center gap-2">
                                                {currentFolder.name}
                                                <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                                    {filteredFolderFiles.length} {filteredFolderFiles.length === 1 ? 'Arquivo' : 'Arquivos'}
                                                </span>
                                            </h2>
                                            <p className="text-sm text-gray-400">{currentProvider?.name} / {currentGame?.name}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">


                                        <button
                                            onClick={() => setView({ type: 'game', providerId: view.providerId, gameId: view.gameId })}
                                            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                        >
                                            <span className="material-symbols-outlined">close</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="px-6 py-4 border-b border-gray-700/50 flex flex-col sm:flex-row gap-4 justify-between items-center bg-[#1E293B] shrink-0 z-10">
                                    <div className="flex items-center gap-3 w-full sm:w-auto">
                                        <div className="relative group w-full sm:w-64">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary transition-colors">
                                                <span className="material-symbols-outlined text-[20px]">search</span>
                                            </span>
                                            <input
                                                className="w-full bg-[#111827] border border-gray-700 text-sm rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-500 focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                                                placeholder="Filtrar arquivos do Drive..."
                                                type="text"
                                                value={folderSearchQuery}
                                                onChange={(e) => setFolderSearchQuery(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                </div>

                                <div className="flex-1 overflow-y-auto p-6 bg-[#1E293B] custom-scrollbar">
                                    {isFilesLoading ? (
                                        <div className="flex flex-col items-center justify-center py-24 text-primary animate-pulse">
                                            <span className="material-symbols-outlined text-[56px] animate-spin mb-4">sync</span>
                                            <h3 className="text-xl font-bold mb-2">Conectando ao Google Drive...</h3>
                                            <p className="text-gray-400">Isso pode levar alguns segundos dependendo da quantidade de arquivos.</p>
                                        </div>
                                    ) : filteredFolderFiles.length > 0 ? (
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                                            {filteredFolderFiles.map(file => (
                                                <div key={file.id} className="group relative flex flex-col gap-2">
                                                    <div className="relative aspect-[4/3] bg-[#111827] rounded-xl border border-gray-700/50 group-hover:border-primary/50 overflow-hidden transition-all duration-300 shadow-sm cursor-pointer">

                                                        {/* Favorites Button */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleFavorite(file.id);
                                                            }}
                                                            className={`absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full backdrop-blur-md border transition-all duration-200 z-30 ${favorites.has(file.id)
                                                                ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.3)]'
                                                                : 'bg-black/40 border-white/10 text-gray-400 hover:text-white hover:bg-black/60'
                                                                }`}
                                                            title={favorites.has(file.id) ? "Remover dos favoritos" : "Marcar como favorito"}
                                                        >
                                                            <span
                                                                className="material-symbols-outlined text-[16px]"
                                                                style={{ fontVariationSettings: favorites.has(file.id) ? "'FILL' 1" : "'FILL' 0" }}
                                                            >
                                                                star
                                                            </span>
                                                        </button>

                                                        {file.thumbnailUrl ? (
                                                            <img src={file.thumbnailUrl} alt={file.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                                        ) : (
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <span className={`material-symbols-outlined text-[48px] ${file.type === 'pdf' ? 'text-red-400/80' :
                                                                    file.type === 'zip' ? 'text-yellow-400/80' :
                                                                        file.type === 'video' ? 'text-blue-400/80' :
                                                                            file.type === 'json' ? 'text-green-400/80' : 'text-gray-600'
                                                                    }`}>
                                                                    {file.type === 'pdf' ? 'picture_as_pdf' :
                                                                        file.type === 'zip' ? 'folder_zip' :
                                                                            file.type === 'video' ? 'movie' :
                                                                                file.type === 'json' ? 'code' : 'image'}
                                                                </span>
                                                            </div>
                                                        )}

                                                        <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 z-10">
                                                            <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">{file.type}</span>
                                                        </div>

                                                        <div className="absolute inset-0 bg-[#1E293B]/80 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-3 z-20">
                                                            {canDownload && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); window.open(file.downloadUrl, '_blank'); }}
                                                                    className="p-2 rounded-full bg-white/10 hover:bg-primary text-white transition-all duration-200 hover:scale-110"
                                                                    title="Baixar"
                                                                >
                                                                    <span className="material-symbols-outlined text-[20px]">download</span>
                                                                </button>
                                                            )}

                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col px-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-3 h-3 opacity-60" />
                                                            <span className="text-sm font-medium text-gray-200 truncate group-hover:text-primary transition-colors">{file.name}</span>
                                                        </div>
                                                        <span className="text-xs text-gray-500 pl-4.5">{file.size} • {file.updatedAt}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                                            <span className="material-symbols-outlined text-[48px] mb-2 opacity-50">search_off</span>
                                            <p>Nenhum arquivo encontrado para "{folderSearchQuery}"</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

            </main>
        </div>
    );
}

export default App;