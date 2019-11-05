import 'mocha';
import { frontends, loadFrontends, MythEventFrontend } from '../src/frontends'
import { expect } from 'chai'
import * as nock from 'nock';
import { createSandbox } from 'sinon';
import { EndpointEmitter } from '@vestibule-link/bridge-assistant';
import { EventEmitter } from 'events';
import { AlexaEndpoint, SubType } from '@vestibule-link/iot-types';
import { mythNotifier } from 'mythtv-event-emitter';

type DoneHolder = {
    done: Mocha.Done
    eventType: 'CLIENT_CONNECTED' | 'CLIENT_DISCONNECTED'
}
class RefreshEmitter extends EventEmitter implements EndpointEmitter<'alexa'> {
    endpoint: AlexaEndpoint = {}
    readonly doneTrackers = new Map<symbol, DoneHolder>()
    private markDone(deltaId: symbol, eventType: SubType<DoneHolder, 'eventType'>) {
        const done = this.doneTrackers.get(deltaId)
        if (done) {
            this.doneTrackers.delete(deltaId)
            if (done.eventType == eventType) {
                done.done()
            } else {
                done.done('Unexpected Event Type: ' + eventType)
            }
        }
    }
    async refresh(deltaId: symbol) {
        this.markDone(deltaId, 'CLIENT_CONNECTED')
    }
    disconnect(fe: MythEventFrontend) {
        return () => {
            this.markDone(fe.eventDeltaId(), 'CLIENT_DISCONNECTED')
        }
    }
}
describe('frontends', () => {
    const refreshEmitter = new RefreshEmitter()
    const sandbox = createSandbox({
        useFakeTimers: true
    })
    before(async () => {
        nock("http://localhost:6544/Myth")
            .get('/GetFrontends')
            .query({
                OnLine: false
            })
            .reply(200, {
                FrontendList: {
                    Frontends: [
                        {
                            Name: "hostgood",
                            IP: "hostgood",
                            Port: "6547"
                        }, {
                            Name: "hostcache",
                            IP: "hostcache",
                            Port: "6547"
                        }]
                }
            }).get('/GetHostName')
            .reply(200, {
                String: 'hostgood'
            })

        nock('http://hostgood:6547/Frontend')
            .get('/GetStatus')
            .once()
            .reply(200, () => {
                return {
                    FrontendStatus: {
                        State: {
                            state: 'WatchingLiveTV'
                        }
                    }
                }
            })
        nock('http://hostcache:6547/Frontend')
            .get('/GetStatus')
            .once()
            .reply(200, () => {
                return {
                    FrontendStatus: {
                        Name: 'testfe'
                    }
                }
            })
        await loadFrontends();
    })

    beforeEach(() => {
        nock('http://hostcache:6547/Frontend')
            .get('/GetStatus').once().reply(200, () => {
                return {
                    FrontendStatus: {
                        Name: 'testfe1'
                    }
                }
            }).get('/GetStatus').once().reply(200, () => {
                return {
                    FrontendStatus: {
                        Name: 'testfe2'
                    }
                }
            }).post('/SendAction').query({
                Action: 123
            }).once().reply(200, () => {
                return {
                    bool: 'true'
                }
            }).post('/SendKey').query({
                Key: 123
            }).once().reply(200, () => {
                return {
                    bool: 'true'
                }
            })
    })
    it('should load frontends', async () => {
        expect(frontends).to.have.length(2);
    })
    it('should cache getStatus', async () => {
        const frontend = frontends[0];
        const status = await frontend.GetStatus();
        const status2 = await frontend.GetStatus();
        expect(status).eql(status2);
    })
    it('should check watching tv', async () => {
        const frontend = frontends[0];
        const status = frontend.isWatchingTv();
        expect(status).to.be.true;
    })
    it('should reset cache on SendAction', async () => {
        const frontend = frontends[1];
        const status = await frontend.GetStatus();
        await frontend.SendAction({
            Action: '123'
        }, false)
        const status2 = await frontend.GetStatus();
        expect(status).not.eql(status2);
    })
    it('should reset cache on SendKey', async () => {
        const frontend = frontends[1];
        const status = await frontend.GetStatus();
        await frontend.SendKey({
            Key: '123'
        })
        const status2 = await frontend.GetStatus();
        expect(status).not.eql(status2);
    })
    it('should reset cache on GetRefreshedStatus', async () => {
        const frontend = frontends[1];
        const status = await frontend.GetRefreshedStatus();
        const status2 = await frontend.GetRefreshedStatus();
        expect(status).not.eql(status2);
    })
    it('should cache event delta', async () => {
        const frontend = frontends[0];
        const eventDelta1 = frontend.eventDeltaId();
        const eventDelta2 = frontend.eventDeltaId();
        expect(eventDelta1).eql(eventDelta2);
    })
    context('Monitor Event', () => {
        before(() => {
            const frontend = frontends[0];
            frontend.addConnectionMonitor('alexa', refreshEmitter, refreshEmitter.disconnect(frontend))
        })
        after(() => {
            const frontend = frontends[0];
            frontend.removeConnectionMonitor('alexa', refreshEmitter.disconnect(frontend))
        })
        it('should refreshEmitter on CLIENT_CONNECTED', function (done) {
            const frontend = frontends[0];
            frontend.mythEventEmitter.once('pre', (eventType, message) => {
                if (eventType == 'CLIENT_CONNECTED') {
                    refreshEmitter.doneTrackers.set(frontend.eventDeltaId(), {
                        done: done,
                        eventType: 'CLIENT_CONNECTED'
                    })
                }
            })
            mythNotifier.emit('MythEvent', frontend.hostname(), 'CLIENT_CONNECTED', {
                SENDER: ''
            })
        })
        it('should refreshEmitter on CLIENT_DISCONNECTED', function (done) {
            const frontend = frontends[0];
            frontend.mythEventEmitter.once('pre', (eventType, message) => {
                if (eventType == 'CLIENT_DISCONNECTED') {
                    refreshEmitter.doneTrackers.set(frontend.eventDeltaId(), {
                        done: done,
                        eventType: 'CLIENT_DISCONNECTED'
                    })
                }
            })
            mythNotifier.emit('MythEvent', frontend.hostname(), 'CLIENT_DISCONNECTED', {
                SENDER: ''
            })
        })
        it('should return watching = false PLAY_STOPPED', async () => {
            const frontend = frontends[0];
            const monitor = frontend.monitorMythEvent('PLAY_STOPPED', 2000)
            frontend.mythEventEmitter.emit('PLAY_STOPPED', {
                SENDER: ''
            })
            await monitor
            expect(frontend.isWatching()).to.be.false
        })
        it('should return watching = true PLAY_CHANGED', async () => {
            const frontend = frontends[0];
            const monitor = frontend.monitorMythEvent('PLAY_CHANGED', 2000)
            frontend.mythEventEmitter.emit('PLAY_CHANGED', {
                SENDER: ''
            })
            await monitor
            expect(frontend.isWatching()).to.be.true
        })
        it('should return watching = true PLAY_STARTED', async () => {
            const frontend = frontends[0];
            const monitor = frontend.monitorMythEvent('PLAY_STARTED', 2000)
            frontend.mythEventEmitter.emit('PLAY_STARTED', {
                SENDER: ''
            })
            await monitor
            expect(frontend.isWatching()).to.be.true
        })
        it('should return watchingTv = true LIVETV_STARTED', async () => {
            const frontend = frontends[0];
            const monitor = frontend.monitorMythEvent('LIVETV_STARTED', 2000)
            frontend.mythEventEmitter.emit('LIVETV_STARTED', {
                SENDER: ''
            })
            await monitor
            expect(frontend.isWatchingTv()).to.be.true
        })
        it('should return watchingTv = false LIVETV_ENDED', async () => {
            const frontend = frontends[0];
            const monitor = frontend.monitorMythEvent('LIVETV_ENDED', 2000)
            frontend.mythEventEmitter.emit('LIVETV_ENDED', {
                SENDER: ''
            })
            await monitor
            expect(frontend.isWatchingTv()).to.be.false
        })
    })
})
