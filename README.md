<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# iGaming Driver - Sistema de Gestão de Ativos

O **iGaming Driver** é uma plataforma centralizada e moderna desenvolvida para gerenciar, visualizar e distribuir ativos digitais de jogos (slots, cassino ao vivo, table games). Ele atua como uma interface elegante e eficiente sobre uma estrutura de arquivos do Google Drive, mantendo os dados sincronizados com um banco de dados Supabase para performance e controle de acesso.

---

## �️ Stack Tecnológico

*   **Frontend**: React 19, Vite, TailwindCSS
*   **Linguagem**: TypeScript
*   **BaaS (Backend-as-a-Service)**: Supabase (Auth, PostgreSQL, Realtime, RLS)
*   **Integrações**: Google Drive API v3 (Leitura e Sincronização de Arquivos)
*   **Bibliotecas Chave**: `jszip` (Download de pastas), `framer-motion` (Animações - implícito via CSS/Tailwind), `@google/genai` (IA).

---

## 🏗️ Arquitetura e Fluxo de Dados

O sistema funciona com base em uma "Fonte de Verdade" externa (Google Drive) que alimenta o sistema local.

### 1. Hierarquia de Dados
A estrutura organizacional segue o padrão da indústria de iGaming:
1.  **Provedores (Providers)**: As empresas desenvolvedoras (ex: Pragmatic Play, PG Soft).
2.  **Jogos (Games)**: Os títulos individuais dentro de cada provedor.
3.  **Pastas de Ativos (Folders)**: Categorias de arquivos (ex: Marketing, Logos, Screenshots).
4.  **Arquivos (Files)**: Os assets finais (imagens, vídeos, zip).

### 2. Sincronização (Sync Engine)
A mágica acontece no serviço `syncStructureFromDrive` (localizado em `services/dataService.ts`).
*   **Apenas Admin**: A sincronização só pode ser disparada por administradores.
*   **Funcionamento**: O sistema varre recursivamente uma pasta raiz do Google Drive configurada.
*   **Mapeamento**:
    *   Pastas na Raiz -> Tornam-se **Provedores**.
    *   Subpastas do Provedor -> Tornam-se **Jogos**.
    *   Subpastas do Jogo -> Tornam-se grupos de **Ativos**.
*   **Inteligência**: O sync detecta arquivos "soltos" e ignora, foca apenas na estrutura de pastas correta. Ele executa operações de *Upsert* (Atualizar ou Inserir) no banco de dados e limpa itens que não existem mais no Drive.

### 3. Carregamento Preguiçoso (Lazy Loading)
Para garantir alta performance, o aplicativo não baixa tudo de uma vez:
*   **Boot Inicial**: Carrega apenas a lista de Provedores e contadores básicos.
*   **Ao Navegar**: Ao clicar em um provedor, o sistema busca os Jogos daquele provedor específico sob demanda.
*   **Arquivos**: A lista de arquivos dentro das pastas é buscada em tempo real na API do Google Drive (para garantir links de download sempre frescos e válidos), não sendo armazenada permanentemente no banco (apenas a estrutura de pastas é cacheada).

---

## ✨ Funcionalidades Principais

### 🔒 Autenticação e Permissões (RBAC)
O sistema utiliza o Supabase Auth com Row Level Security (RLS) no banco de dados.
*   **Roles**:
    *   **Admin**: Acesso total. Pode sincronizar o Drive, gerenciar usuários, editar configurações globais.
    *   **Common**: Pode navegar, pesquisar e baixar arquivos.
    *   **Guest**: Acesso limitado (se configurado).
*   **Segurança**: Triggers no banco de dados impedem que usuários comuns elevem seus próprios privilégios.

### 🔍 Busca Global e Local
*   **Busca Sidebar**: Pesquisa global que varre Provedores, Jogos e Pastas. Se conectado à API do Drive, pode realizar buscas profundas de arquivos.
*   **Filtros Contextuais**: Dentro de cada visualização (Provedor ou Jogo), barras de busca filtram o conteúdo local instantaneamente.

### 📥 Download e Zip
*   **Download em Lote**: O sistema permite baixar uma pasta inteira de ativos.
*   **Processamento no Cliente**: Utiliza `JSZip` para baixar múltiplos arquivos do Drive simultaneamente, compactá-los no navegador do usuário e entregar um arquivo `.zip` único, sem sobrecarregar o servidor.

### 📊 Dashboard
Visão geral com:
*   Total de Provedores e Jogos.
*   Jogos Adicionados Recentemente (Top 8).
*   Status da Sincronização (Barra de progresso visual durante o sync).

---

## 🚀 Como Rodar o Projeto

### Pré-requisitos
*   Node.js 18+ instalado.
*   Uma conta no Supabase (Projeto criado com as tabelas `providers`, `games`, `folders`, `profiles`, `settings`).
*   Uma chave de API do Google Cloud com permissão para **Google Drive API**.

### Instalação

1.  Clone o repositório.
2.  Instale as dependências:
    ```bash
    npm install
    # ou
    yarn
    ```

3.  Configure as variáveis de ambiente:
    Crie um arquivo `.env.local` na raiz com as chaves:
    ```env
    VITE_SUPABASE_URL=seu_url_supabase
    VITE_SUPABASE_ANON_KEY=sua_chave_anonima
    VITE_GOOGLE_DRIVE_API_KEY=sua_chave_api_google
    VITE_GEMINI_API_KEY=opcional_para_ia
    ```

4.  Execute o servidor de desenvolvimento:
    ```bash
    npm run dev
    ```

### Deploy
O projeto está configurado para deploy fácil via **GitHub Pages** (veja scripts no `package.json`), mas pode ser hospedado em Vercel, Netlify ou qualquer servidor estático.
O workflow de build é: `npm run build` -> pasta `dist`.

---

## 📂 Estrutura de Pastas do Código

*   `/components`: Componentes React reutilizáveis (Sidebar, Cards, Modais).
*   `/services`: Camada de comunicação com APIs.
    *   `supabaseClient.ts`: Instância do cliente Supabase.
    *   `dataService.ts`: Lógica de negócios, CRUDs e Sync Engine.
    *   `googleDriveService.ts`: Abstração da API do Google Drive.
*   `/types`: Definições de tipos TypeScript (Interfaces de Domínio).
*   `App.tsx`: Componente principal, Roteamento (State-based routing) e orquestração de estado global.
