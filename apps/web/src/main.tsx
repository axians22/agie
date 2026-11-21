import { lazy, StrictMode, Suspense, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { api, ErroApi, EVENTO_SESSAO_EXPIRADA, mensagemErro, type Usuario } from './api.ts';
import { Carregando, Falha, ProvedorAviso } from './comum.tsx';
import { Entrar } from './Entrar.tsx';
import './estilos.css';

// Cada perfil baixa só o próprio código: o devedor não recebe as telas de admin.
const AppAdmin = lazy(() => import('./Admin.tsx').then((m) => ({ default: m.AppAdmin })));
const AppDevedor = lazy(() => import('./Devedor.tsx').then((m) => ({ default: m.AppDevedor })));

interface Sessao {
  usuario: Usuario;
  pixDisponivel: boolean;
}

function App() {
  const [sessao, setSessao] = useState<Sessao | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setErro(null);
    api<Sessao>('GET', '/auth/me')
      .then(setSessao)
      .catch((e) => {
        if (e instanceof ErroApi && e.status === 401) setSessao(null);
        else setErro(mensagemErro(e));
      });
  }, []);

  useEffect(carregar, [carregar]);
  useEffect(() => {
    const f = () => setSessao(null);
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, f);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, f);
  }, []);

  const sair = async () => {
    await api('POST', '/auth/logout').catch(() => {});
    setSessao(null);
  };

  if (erro) return <Falha mensagem={erro} tentar={carregar} />;
  if (sessao === undefined) return <Carregando />;
  if (sessao === null) {
    return (
      <Routes>
        <Route path="/entrar" element={<Entrar aoEntrar={() => carregar()} />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }
  return (
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/entrar" element={<Navigate to="/" replace />} />
        <Route
          path="*"
          element={
            sessao.usuario.papel === 'admin' ? (
              <AppAdmin key={sessao.usuario.email} usuario={sessao.usuario} aoSair={sair} />
            ) : (
              <AppDevedor key={sessao.usuario.email} usuario={sessao.usuario} pixDisponivel={sessao.pixDisponivel} aoSair={sair} />
            )
          }
        />
      </Routes>
    </Suspense>
  );
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <BrowserRouter>
      <ProvedorAviso>
        <App />
      </ProvedorAviso>
    </BrowserRouter>
  </StrictMode>,
);
