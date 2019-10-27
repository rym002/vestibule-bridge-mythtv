import { memoize, MemoizedFunction } from 'lodash';
import { mythNotifier, MythSenderEventEmitter } from "mythtv-event-emitter";
import { ApiTypes, Frontend, getFrontendServices } from "mythtv-services-api";
import { mergeObject } from "./mergeObject";
import { EventMapping } from 'mythtv-event-emitter/dist/messages';

export const frontends: MythEventFrontend[] = []

export class CachingEventFrontend {
    private readonly memoizeStatus: MemoizedFunction
    private readonly memoizeEventDelta: MemoizedFunction

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
}

function initFrontend(fe: Frontend.Service): MythEventFrontend {
    const mythEmitter = mythNotifier.sender(fe.hostname());
    const ret = new CachingEventFrontend(fe, mythEmitter);
    return mergeObject(ret, fe);
}
