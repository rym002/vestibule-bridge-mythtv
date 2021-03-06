import { memoize, MemoizedFunction } from 'lodash';
import { mythNotifier, MythSenderEventEmitter, monitorEvents, EventMapping } from "mythtv-event-emitter";
import { ApiTypes, Frontend, getFrontendServices, masterBackend } from "mythtv-services-api";
import { mergeObject } from "./mergeObject";
import { ServiceProviderType, EndpointConnector, ServiceProviderConnectors } from '@vestibule-link/bridge-service-provider'
export const frontends: MythEventFrontend[] = []

const FE_POLLING_INTERVAL = Number(process.env['MYTH_FE_POLLING_INTERVAL'] || 30000)
const MONITOR_HOSTNAME = process.env['MYTH_MONITOR_HOSTNAME'] || 'vestibule'
type Callback = () => void;
export class CachingEventFrontend {
    private readonly memoizeStatus: MemoizedFunction
    private readonly memoizeEventDelta: MemoizedFunction
    private providerConnectors = new Map<ServiceProviderType, EndpointConnector>()
    private disconnectCallbacks = new Set<Callback>()
    private connected = false
    private fePollingTimeout?: NodeJS.Timeout
    private watchingTv = false
    private watching = false
    GetStatus: () => Promise<ApiTypes.FrontendStatus>
    eventDeltaId: () => symbol
    constructor(private readonly fe: Frontend.Service, readonly mythEventEmitter: MythSenderEventEmitter, readonly masterBackendEmitter: MythSenderEventEmitter) {
        const memoizeStatus = memoize(fe.GetStatus.bind(fe))
        this.GetStatus = memoizeStatus;
        this.memoizeStatus = memoizeStatus
        const memoizeEventDelta = memoize(() => {
            return Symbol();
        })
        this.eventDeltaId = memoizeEventDelta;
        this.memoizeEventDelta = memoizeEventDelta
        mythEventEmitter.prependListener('pre', (eventType, message) => {
            this.clearStatusCache()
            this.clearEventDeltaCache()
        });
        mythEventEmitter.on('CLIENT_CONNECTED', message => {
            this.connected = true
            this.pollConnection()
            this.refreshEmitters()
        })
        mythEventEmitter.on('CLIENT_DISCONNECTED', message => {
            this.connected = false
            this.clearPollConnection()
            this.executeDisconnect()
        })
        mythEventEmitter.on('LIVETV_STARTED', message => {
            this.watchingTv = true
        })
        mythEventEmitter.on('LIVETV_ENDED', message => {
            this.watchingTv = false
        })
        mythEventEmitter.on('PLAY_STOPPED', message => {
            this.watching = false
        })
        mythEventEmitter.on('PLAY_STARTED', message => {
            this.watching = true
        })
        mythEventEmitter.on('PLAY_CHANGED', message => {
            this.watching = true
        })
    }
    public addConnectionMonitor<T extends ServiceProviderType>(providerName: T, connector: Required<ServiceProviderConnectors>[T], disconnectCallback: Callback) {
        this.providerConnectors.set(providerName, <EndpointConnector>connector)
        this.disconnectCallbacks.add(disconnectCallback)
        if (!this.fePollingTimeout) {
            this.pollConnection()
        }
    }
    public removeConnectionMonitor<T extends ServiceProviderType>(providerName: T, disconnectCallback: Callback) {
        this.providerConnectors.delete(providerName)
        this.disconnectCallbacks.delete(disconnectCallback)
        if (this.providerConnectors.size == 0) {
            this.clearPollConnection()
        }
    }
    private pollConnection() {
        if (this.connected
            && FE_POLLING_INTERVAL > 0
            && !this.fePollingTimeout) {
            this.fePollingTimeout = setInterval(() => {
                this.fe.GetStatus()
                    .then(() => {
                        this.connected = true
                    }).catch(err => {
                        console.log(err)
                        this.connected = false
                        this.clearPollConnection()
                        this.executeDisconnect()
                    })
            }, FE_POLLING_INTERVAL);
        }
    }

    private clearPollConnection() {
        if (this.fePollingTimeout) {
            clearInterval(this.fePollingTimeout)
            this.fePollingTimeout = undefined
        }
    }
    private refreshEmitters() {
        this.providerConnectors.forEach(connector => {
            connector.refresh(this.eventDeltaId())
        })
    }
    private executeDisconnect() {
        this.disconnectCallbacks.forEach(callback => {
            callback()
        })
    }
    isWatchingTv(): boolean {
        return this.watchingTv
    }
    isWatching(): boolean {
        return this.watching
    }
    public async initFromState() {
        try {
            const status: ApiTypes.FrontendStatus = await this.GetStatus();
            const state = status.State.state;
            this.connected = true
            this.watching = state.startsWith('Watching');
            this.watchingTv = state == 'WatchingLiveTV';
        } catch (err) {
            console.log(err)
        }

    }
    isConnected(): boolean {
        return this.connected
    }
    async SendAction(req: Frontend.Request.SendAction, ignoreError?: boolean): Promise<void> {
        this.clearStatusCache();
        return this.fe.SendAction(req, ignoreError);
    }
    async SendKey(req: Frontend.Request.SendKey): Promise<void> {
        this.clearStatusCache();
        return this.fe.SendKey(req);
    }
    async GetRefreshedStatus(): Promise<ApiTypes.FrontendStatus> {
        this.clearStatusCache();
        return this.GetStatus();
    }

    private clearCache(funct: MemoizedFunction) {
        funct.cache.clear && funct.cache.clear();
    }

    private clearStatusCache() {
        this.clearCache(this.memoizeStatus);
    }
    private clearEventDeltaCache() {
        this.clearCache(this.memoizeEventDelta);
    }
    monitorMythEvent<T extends keyof EventMapping, P extends EventMapping[T]>(eventName: T, timeout: number): Promise<P> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.mythEventEmitter.removeListener(eventName, listener)
                const error = new Error('Event Timeout ' + eventName)
                reject(error)
            }, timeout);
            const listener: (message: P) => void = (message) => {
                clearTimeout(timeoutId);
                resolve(message)
            }
            this.mythEventEmitter.once(eventName, listener)
        })
    }
}

export async function getMasterBackendEmitter(): Promise<MythSenderEventEmitter> {
    const masterHostname = await masterBackend.mythService.GetHostName()
    return mythNotifier.hostEmitter(masterHostname)
}

export async function monitorMythSocket() {
    const masterHostname = await masterBackend.mythService.GetHostName()
    const port = Number(await masterBackend.mythService.GetSetting({
        Key: 'BackendServerPort',
        Default: '6543'
    }))
    const address = await masterBackend.mythService.GetSetting({
        Key: 'BackendServerAddr',
        Default: 'localhost'
    })
    await monitorEvents(MONITOR_HOSTNAME, masterHostname, address, port)
}
export async function loadFrontends(): Promise<void> {
    const hosts = await getFrontendServices(false)
    const masterBackendEmitter = await getMasterBackendEmitter()
    const frontendLookups = hosts.map(async (host) => {
        const fe = await initFrontend(host, masterBackendEmitter);
        return fe;
    })
    const frontendResolved = await Promise.all(frontendLookups)
    frontends.push(...frontendResolved);
}

export interface MythEventFrontend extends Frontend.Service {
    readonly mythEventEmitter: MythSenderEventEmitter
    readonly masterBackendEmitter: MythSenderEventEmitter
    isWatchingTv(): boolean
    isWatching(): boolean
    isConnected(): boolean
    GetRefreshedStatus(): Promise<ApiTypes.FrontendStatus>
    eventDeltaId(): symbol
    monitorMythEvent<T extends keyof EventMapping, P extends EventMapping[T]>(eventName: T, timeout: number): Promise<P>;
    addConnectionMonitor<T extends ServiceProviderType>(providerName: T, connector: Required<ServiceProviderConnectors>[T], disconnectCallback: Callback): void;
    removeConnectionMonitor<T extends ServiceProviderType>(providerName: T, disconnectCallback: Callback): void;
}

async function initFrontend(fe: Frontend.Service, masterBackendEmitter: MythSenderEventEmitter): Promise<MythEventFrontend> {
    const mythEmitter = mythNotifier.hostEmitter(fe.hostname());
    const ret = new CachingEventFrontend(fe, mythEmitter, masterBackendEmitter);
    await ret.initFromState()
    return mergeObject(ret, fe);
}
