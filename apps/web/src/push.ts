import { api } from './api.ts';

export type EstadoPush = 'carregando' | 'indisponivel' | 'instalar-ios' | 'negada' | 'desligada' | 'ligada';

const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const suporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function bytesDaChave(chave: string): Uint8Array<ArrayBuffer> {
  const b64 = chave.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(chave.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registro(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function enviarInscricao(i: PushSubscription): Promise<void> {
  const j = i.toJSON();
  await api('POST', '/push/inscricao', { endpoint: i.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth } });
}

function mesmaChave(i: PushSubscription, chave: Uint8Array): boolean {
  const atual = i.options.applicationServerKey;
  if (!atual) return false;
  const bytes = new Uint8Array(atual);
  return bytes.length === chave.length && bytes.every((b, n) => b === chave[n]);
}

export async function lerEstadoPush(): Promise<EstadoPush> {
  if (ehIOS() && !instalado()) return 'instalar-ios';
  if (!suporta()) return 'indisponivel';
  const { disponivel } = await api<{ disponivel: boolean }>('GET', '/push/config');
  if (!disponivel) return 'indisponivel';
  if (Notification.permission === 'denied') return 'negada';
  if (Notification.permission !== 'granted') return 'desligada';
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? 'ligada' : 'desligada';
}

/** Precisa ser chamada a partir de um toque: o navegador exige isso para pedir a permissão. */
export async function ativarPush(): Promise<EstadoPush> {
  const permissao = await Notification.requestPermission();
  if (permissao === 'denied') return 'negada';
  if (permissao !== 'granted') return 'desligada';
  const { chavePublica } = await api<{ chavePublica: string | null }>('GET', '/push/config');
  if (!chavePublica) return 'indisponivel';
  const chave = bytesDaChave(chavePublica);
  const reg = await registro();
  let inscricao = await reg.pushManager.getSubscription();
  if (inscricao && !mesmaChave(inscricao, chave)) {
    await inscricao.unsubscribe();
    inscricao = null;
  }
  inscricao ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
  await enviarInscricao(inscricao);
  return 'ligada';
}

export async function desativarPush(): Promise<void> {
  if (!suporta()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const inscricao = await reg?.pushManager.getSubscription();
  if (!inscricao) return;
  await api('DELETE', '/push/inscricao', { endpoint: inscricao.endpoint }).catch(() => {});
  await inscricao.unsubscribe();
}

/** Liga a inscrição deste aparelho à conta aberta, inclusive quando o navegador renovou o endereço. */
export async function sincronizarPush(): Promise<void> {
  if (!suporta() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const inscricao = await reg?.pushManager.getSubscription();
  if (inscricao) await enviarInscricao(inscricao);
}
