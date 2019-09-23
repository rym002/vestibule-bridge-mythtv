import 'mocha';
import { frontends, loadFrontends } from '../src/frontends'
import { expect } from 'chai'
import * as nock from 'nock';

describe('frontends', () => {
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
            })

        await loadFrontends();
        nock('http://hostgood:6547/Frontend')
            .get('/GetStatus').once().reply(200, () => {
                return {
                    FrontendStatus: {
                        State: {
                            state: 'WatchingLiveTV'
                        }
                    }
                }
            })
    })

    beforeEach(() => {
        nock('http://hostcache:6547/Frontend')
            .get('/GetStatus').once().reply(200, () => {
                return {
                    FrontendStatus: {
                        Name: 'testfe'
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
        const status = await frontend.isWatchingTv();
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
})