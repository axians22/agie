import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, mensagemErro, type Usuario } from './api.ts';
import { appInstalado, Carregando, ehIOS } from './comum.tsx';

interface GoogleId {
  initialize: (o: Record<string, unknown>) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

interface ConfigLogin {
  googleClientId: string | null;
}

const GIS = 'https://accounts.google.com/gsi/client';

function carregarGoogle(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((ok, falha) => {
    const existente = document.querySelector<HTMLScriptElement>(`script[src="${GIS}"]`);
    const s = existente ?? Object.assign(document.createElement('script'), { src: GIS, async: true });
    s.addEventListener('load', () => ok(), { once: true });
    s.addEventListener('error', () => falha(new Error('google')), { once: true });
    if (!existente) document.head.append(s);
  });
}

const ERROS: Record<string, string> = {
  login: 'Não foi possível entrar com o Google. Tente de novo.',
};

export function Entrar({ aoEntrar }: { aoEntrar: (u: Usuario) => void }) {
  const [params] = useSearchParams();
  const [config, setConfig] = useState<ConfigLogin | null>(null);
  const [erro, setErro] = useState<string | null>(ERROS[params.get('erro') ?? ''] ?? null);
  const [ocupado, setOcupado] = useState(false);
  const botao = useRef<HTMLDivElement>(null);
  const callback = useRef(aoEntrar);
  callback.current = aoEntrar;

  useEffect(() => {
    document.title = 'Entrar · Empréstimos';
    api<ConfigLogin>('GET', '/auth/config').then(setConfig).catch((e) => setErro(mensagemErro(e)));
  }, []);

  useEffect(() => {
    const clientId = config?.googleClientId;
    if (!clientId) return;
    let ativo = true;
    // No app instalado do iPhone o popup pode não abrir; lá o login usa redirecionamento.
    const redirecionar = ehIOS() && appInstalado();
    carregarGoogle()
      .then(() => {
        if (!ativo || !botao.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          ...(redirecionar
            ? { ux_mode: 'redirect', login_uri: `${location.origin}/api/auth/google/redirect` }
            : {
                callback: ({ credential }: { credential: string }) => {
                  setErro(null);
                  setOcupado(true);
                  api<{ usuario: Usuario }>('POST', '/auth/google', { credential })
                    .then((r) => callback.current(r.usuario))
                    .catch((e) => setErro(mensagemErro(e)))
                    .finally(() => setOcupado(false));
                },
              }),
        });
        const largura = Math.max(200, Math.min(320, Math.floor(botao.current.clientWidth)));
        window.google.accounts.id.renderButton(botao.current, {
          type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width: largura, locale: 'pt-BR',
        });
      })
      .catch(() => ativo && setErro('Não foi possível carregar o login do Google. Verifique sua conexão.'));
    return () => {
      ativo = false;
    };
  }, [config?.googleClientId]);

  return (
    <main className="entrar">
      <img src="/icons/icone.svg" alt="" width="72" height="72" />
      <h1>Empréstimos</h1>
      <p className="suave">Acompanhe parcelas, atrasos e pagamentos pelo celular.</p>
      {!config && !erro && <Carregando />}
      {config?.googleClientId && <div ref={botao} className="google" />}
      {config && !config.googleClientId && (
        <p role="alert">O login com Google ainda não foi configurado.</p>
      )}
      {ocupado && <p role="status">Entrando...</p>}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </main>
  );
}
