import { memoize, MemoizedFunction } from 'lodash';
import { mythNotifier, MythSenderEventEmitter } from "mythtv-event-emitter";
import { ApiTypes, Frontend, getFrontendServices } from "mythtv-services-api";
import { mergeObject } from "./mergeObject";
import { EventMapping } from 'mythtv-event-emitter/dist/messages';
import { EndpointEmitter } from '@vestibule-link/bridge-assistant'
import { AssistantType } from '@vestibule-link/iot-types'
export const frontends: MythEventFrontend[] = []

const FE_POLLING_INTERVAL = Number(process.env['MYTH_FE_POLLING_INTERVAL'] || 30000)
type Callback = () => void;
export class CachingEventFrontend {
    private readonly memoizeStatus: MemoizedFunction
    private readonly memoizeEventDelta: MemoizedFunction
    private assistantEmitters = new Map<AssistantType, EndpointEmitter<any>>()
    private disconnectCallbacks = new Set<Callback>()
    private connected = true
    private fePollingTimeout?: NodeJS.Timeout
    GetStatus: () => Promise<ApiTypes.FrontendStatus>
    eventDeltaId: () => symbol
    constructor(private readonly fe: Frontend.Service, readonly mythEventEmitter: MythSenderEventEmitter) {
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
    }
    public addConnectionMonitor<T extends AssistantType>(assistantType: T, emitter: EndpointEmitter<T>, disconnectCallback: Callback) {
        this.assistantEmitters.set(assistantType, emitter)
        this.disconnectCallbacks.add(disconnectCallback)
        if (!this.fePollingTimeout) {
            this.pollConnection()
        }
    }
    public removeConnectionMonitor<T extends AssistantType>(assistantType: T, disconnectCallback: Callback) {
        this.assistantEmitters.delete(assistantType)
        this.disconnectCallbacks.delete(disconnectCallback)
        if (this.assistantEmitters.size == 0) {
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
        this.assistantEmitters.forEach(emitter => {
            emitter.refresh(this.eventDeltaId())
        })
    }
    private executeDisconnect() {
        this.disconnectCallbacks.forEach(callback => {
            callback()
        })
    }
    async isWatchingTv(): Promise<boolean> {
        const status: ApiTypes.FrontendStatus = await this.GetStatus();
        const state = status.State.state;
        return state == 'WatchingLiveTV';
    }
    async isWatching(): Promise<boolean> {
        const status: ApiTypes.FrontendStatus = await this.GetStatus();
        const state = status.State.state;
        return state.startsWith('Watching');
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

export async function loadFrontends(): Promise<void> {
    const hosts = await getFrontendServices(false)
    const frontendLookups = hosts.map(host => {
        const fe = initFrontend(host);
        return fe;
    })

    frontends.push(...frontendLookups);
}

export interface MythEventFrontend extends Frontend.Service {
    readonly mythEventEmitter: MythSenderEventEmitter
    isWatchingTv(): Promise<boolean>
    isWatching(): Promise<boolean>
    GetRefreshedStatus(): Promise<ApiTypes.FrontendStatus>
    eventDeltaId(): symbol
    monitorMythEvent<T extends keyof EventMapping, P extends EventMapping[T]>(eventName: T, timeout: number): Promise<P>;
    addConnectionMonitor<T extends AssistantType>(assistantType: T, emitter: EndpointEmitter<T>, disconnectCallback: Callback): void;
    removeConnectionMonitor<T extends AssistantType>(assistantType: T, disconnectCallback: Callback): void;
}

function initFrontend(fe: Frontend.Service): MythEventFrontend {
    const mythEmitter = mythNotifier.hostEmitter(fe.hostname());
    const ret = new CachingEventFrontend(fe, mythEmitter);
    return mergeObject(ret, fe);
}
