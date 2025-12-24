import React from 'react';
import { Provider, ViewState, User } from '../types';

interface SidebarProps {
  providers: Provider[];
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  currentUser: User | null;
  onLogout: () => void;
  onSettingsClick: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  providers,
  currentView,
  onNavigate,
  currentUser,
  onLogout,
  onSettingsClick,
  searchQuery,
  onSearchChange
}) => {
  const isAdmin = currentUser?.role === 'admin';

  const getRoleLabel = (role?: string) => {
    switch (role) {
      case 'admin': return 'Administrador';
      case 'common': return 'Usuário Comum';
      case 'guest': return 'Convidado';
      default: return 'Visitante';
    }
  };

  const getRoleDescription = (role?: string) => {
    switch (role) {
      case 'admin': return 'Acesso Total';
      case 'common': return 'Visualizar e Baixar';
      case 'guest': return 'Apenas Visualização';
      default: return 'Restrito';
    }
  };

  return (
    <aside className="w-72 flex flex-col h-full bg-sidebar-bg border-r border-gray-800 shrink-0 z-20 shadow-xl transition-all duration-300">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-gray-800/50">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]">
          <span className="material-symbols-outlined text-[20px]">cloud_circle</span>
        </div>
        <h1 className="text-xl font-bold tracking-tight text-white cursor-pointer" onClick={() => onNavigate({ type: 'home' })}>
          iGaming Driver
        </h1>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto px-4 py-6 gap-6 custom-scrollbar">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold text-white">Provedores</h2>
            <p className="text-gray-400 text-sm font-normal">Gestão de Arquivos</p>
          </div>
          <div className="relative group">
            <div className="flex w-full items-center rounded-lg bg-[#1F2937] border border-gray-700 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all duration-200">
              <div className="flex items-center justify-center pl-3 text-gray-400">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <input
                className="w-full bg-transparent border-none text-sm text-white placeholder-gray-500 focus:ring-0 px-3 py-2.5 outline-none"
                placeholder="Achar provedores, jogos, assets..."
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {providers.map((provider) => {
            const isActive = currentView.type !== 'home' && currentView.type !== 'settings' && currentView.providerId === provider.id;
            return (
              <button
                key={provider.id}
                onClick={() => onNavigate({ type: 'provider', providerId: provider.id })}
                className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 text-left group relative overflow-hidden ${isActive
                  ? 'bg-[#1F2937] border border-gray-700/50'
                  : 'hover:bg-[#1F2937] border border-transparent'
                  }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-lg"></div>
                )}
                <span className={`material-symbols-outlined transition-colors ${isActive ? 'text-primary' : 'text-gray-400 group-hover:text-primary'}`}>
                  {isActive ? 'folder_open' : 'folder'}
                </span>
                <div className="flex flex-col z-10">
                  <span className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-200 group-hover:text-white'}`}>
                    {provider.name}
                  </span>
                  <span className="text-xs text-gray-500 group-hover:text-gray-400">
                    {provider.gameCount} Jogos
                  </span>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-gray-800 p-4">
        <div className="flex flex-col gap-1">
          {isAdmin && (
            <button
              onClick={onSettingsClick}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1F2937] transition-colors text-left w-full ${currentView.type === 'settings' ? 'text-white bg-[#1F2937]' : 'text-gray-400 hover:text-white'}`}
            >
              <span className="material-symbols-outlined text-[20px]">settings</span>
              <span className="text-sm font-medium">Configurações</span>
            </button>
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1F2937] text-gray-400 hover:text-red-400 transition-colors text-left w-full"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="text-sm font-medium">Sair</span>
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3 px-3 pt-2 border-t border-gray-800/50">
          <div className={`h-8 w-8 rounded-full ring-2 ring-gray-700 flex items-center justify-center ${isAdmin ? 'bg-gradient-to-tr from-primary to-purple-500' : 'bg-gray-600'}`}>
            <span className="material-symbols-outlined text-white text-[16px]">{isAdmin ? 'shield_person' : 'person'}</span>
          </div>
          <div className="flex flex-col overflow-hidden">
            <p className="text-sm font-medium text-white truncate">{currentUser?.name || 'Usuário'}</p>
            <p className="text-xs text-gray-500 truncate">{getRoleLabel(currentUser?.role)}</p>
          </div>
        </div>
      </div>
    </aside>
  );
};