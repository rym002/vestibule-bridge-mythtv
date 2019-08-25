import { listenInit, registerModule } from '@vestibule-link/bridge';
import { addRouter } from '@vestibule-link/bridge-http';
import { httpRouter } from 'mythtv-event-emitter';
import { loadFrontends } from './frontends';
import { backendSettings } from 'mythtv-services-api';

const urlConfig = process.env['MYTHTV_BACKEND_URL'];
const mythURL: URL | undefined = urlConfig ? new URL(urlConfig) : undefined


listenInit('http', async () => {
    addRouter('/mythtv', httpRouter)
    registerModule({
        name: 'mythtv',
        init: async () => {
            if (mythURL) {
                backendSettings({
                    protocol: mythURL.protocol,
                    hostname: mythURL.hostname,
                    port: Number(mythURL.port)
                })
            }
            await loadFrontends();
        }
    })
})

export { mergeObject } from './mergeObject';
export { frontends, MythEventFrontend } from './frontends'