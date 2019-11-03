import { registerModule } from '@vestibule-link/bridge';
import { addRouter } from '@vestibule-link/bridge-http';
import { httpRouter } from 'mythtv-event-emitter';
import { loadFrontends } from './frontends';
import { masterBackendSettings } from 'mythtv-services-api';
import { startModule as httpStartModule } from '@vestibule-link/bridge-http'

const urlConfig = process.env['MYTHTV_BACKEND_URL'];
const mythURL: URL | undefined = urlConfig ? new URL(urlConfig) : undefined

let moduleId: symbol | undefined;
export function startModule() {
    if (!moduleId) {
        moduleId = registerModule({
            name: 'mythtv',
            init: async () => {
                addRouter('/mythtv', httpRouter)
                if (mythURL) {
                    masterBackendSettings(mythURL)
                }
                await loadFrontends();
            },
            depends: [httpStartModule()]
        })
    }
    return moduleId;
}

export { mergeObject } from './mergeObject';
export { frontends, MythEventFrontend } from './frontends'