import { defineConfig } from 'wxt';
import { privateWaJsPlugin } from './build/private-wa-js';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [privateWaJsPlugin()] }),
  manifest: {
    name: 'Agendador para WhatsApp Web',
    description: 'Agende mensagens na conversa aberta do WhatsApp Web.',
    version: '0.1.3',
    minimum_chrome_version: '120',
    permissions: ['storage', 'alarms', 'scripting'],
    host_permissions: ['https://web.whatsapp.com/*'],
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
    action: {
      default_title: 'Abrir agendador no WhatsApp Web',
      default_icon: { 16: 'icon-16.png', 32: 'icon-32.png' },
    },
  },
});
