import { FrontendStatus, Frontend, SendActionRequest, SendKeyRequest, backend, frontend } from "mythtv-services-api";
import { MythSenderEventEmitter, mythNotifier } from "mythtv-event-emitter";
import { compact, memoize,MemoizedFunction } from 'lodash'
import { mergeObject } from "./mergeObject";

export const frontends: MythEventFrontend[] = []

class CachingEventFrontend {
    private readonly memoizeStatus: MemoizedFunction
    private readonly memoizeEventDelta: MemoizedFunction

    GetStatus: () => Promise<FrontendStatus>
    eventDeltaId: () => symbol
    constructor(private readonly fe: Frontend, readonly mythEventEmitter: MythSenderEventEmitter) {
        const memoizeStatus = memoize(fe.GetStatus.bind(fe))
        this.GetStatus = memoizeStatus;
        this.memoizeStatus = memoizeStatus
        const memoizeEventDelta = memoize(()=>{
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
        const status: FrontendStatus = await this.GetStatus();
        const state = status.State.state;
        return state == 'WatchingLiveTV';
    }
    async SendAction(req: SendActionRequest, ignoreError?: boolean): Promise<void> {
        this.clearStatusCache();
        return this.fe.SendAction(req, ignoreError);
    }
    async SendKey(req: SendKeyRequest): Promise<void> {
        this.clearStatusCache();
        return this.fe.SendKey(req);
    }
    async GetRefreshedStatus(): Promise<FrontendStatus> {
        this.clearStatusCache();
        return this.GetStatus();
    }

    private clearCache(funct:MemoizedFunction){
        funct.cache.clear && funct.cache.clear();
    }

    private clearStatusCache() {
        this.clearCache(this.memoizeStatus);
    }
    private clearEventDeltaCache() {
        this.clearCache(this.memoizeEventDelta);
    }
}

export async function loadFrontends(): Promise<void> {
    const hosts = await backend.mythService.GetHosts();
    const promises = hosts.map(host => {
        const fe = initFrontend(host);
        return fe;
    })
    const frontendLookups = await Promise.all(promises);

    const foundFes = compact(frontendLookups);
    frontends.push(...foundFes);
}

export interface MythEventFrontend extends Frontend {
    readonly mythEventEmitter: MythSenderEventEmitter
    isWatchingTv(): Promise<boolean>
    GetRefreshedStatus(): Promise<FrontendStatus>
    eventDeltaId(): symbol
}

async function initFrontend(host: string): Promise<MythEventFrontend | undefined> {
    try {
        const fe = await frontend(host);
        const mythEmitter = mythNotifier.sender(host);
        const ret = new CachingEventFrontend(fe, mythEmitter);
        return mergeObject(ret, fe);
    } catch (e) {
        console.log(e);
    }
}
